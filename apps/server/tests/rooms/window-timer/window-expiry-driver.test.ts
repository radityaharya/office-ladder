import { describe, expect, it } from "vitest";

import { parseCommandId, TURN_TIMEOUT_COMMAND_ID_PREFIX } from "@office-ladder/contracts";
import type { GameState } from "@office-ladder/engine";
import type { RoomService } from "../../../src/rooms/service/types";
import { expirySubmissionFor } from "../../../src/rooms/window-timer/expiry-command";
import { shouldSweepWindows } from "../../../src/rooms/window-timer/should-sweep";
import {
  createWindowExpiryDriver,
  isWindowExpiryDefect,
  type WindowExpiryDriver,
  type WindowExpiryDriverEvent,
  type WindowExpiryStop,
} from "../../../src/rooms/window-timer/window-expiry-driver";
import {
  ballot,
  isoAt,
  players,
  QUICK_TURN_CLOCK_MS,
  reactionWindow,
  ROOM_ID,
  startMatch,
  WINDOW_ID,
  type MatchFixture,
} from "./fixtures";

/**
 * The driver: the server half of spec §7.1, against a real room service, a real
 * repository and a real engine. Nothing here uses a real timer — the wakeup and
 * the clock are both injected, so every assertion is about the rule rather than
 * about how fast the machine ran.
 */

type PendingWakeup = {
  readonly delayMs: number;
  readonly fire: () => void;
  cancelled: boolean;
};

type Harness = {
  readonly fixture: MatchFixture;
  readonly driver: WindowExpiryDriver;
  readonly events: WindowExpiryDriverEvent[];
  readonly published: { revision: number; messageId: string }[];
  readonly wakeups: PendingWakeup[];
  readonly committedKicks: string[];
};

type DriverOptions = {
  readonly turnClockEnabled?: boolean;
  readonly roomService?: Pick<RoomService, "submitServerCommand">;
  readonly onEvent?: (event: WindowExpiryDriverEvent) => void;
};

function attachDriver(fixture: MatchFixture, options: DriverOptions = {}): Harness {
  const events: WindowExpiryDriverEvent[] = [];
  const published: { revision: number; messageId: string }[] = [];
  const wakeups: PendingWakeup[] = [];
  const committedKicks: string[] = [];

  const driver = createWindowExpiryDriver({
    repository: fixture.repository,
    roomService: options.roomService ?? fixture.service,
    now: fixture.now,
    turnClockEnabled: options.turnClockEnabled ?? false,
    publish: async (_roomId, revision, messageId) => {
      published.push({ revision, messageId });
    },
    setTimer: (callback, delayMs) => {
      const wakeup: PendingWakeup = { delayMs, fire: callback, cancelled: false };
      wakeups.push(wakeup);
      return () => {
        wakeup.cancelled = true;
      };
    },
    onCommitted: (roomId) => {
      committedKicks.push(roomId);
    },
    onEvent: (event) => {
      events.push(event);
      options.onEvent?.(event);
    },
  });

  return { fixture, driver, events, published, wakeups, committedKicks };
}

async function withOpenWindow(options: DriverOptions = {}): Promise<Harness> {
  const fixture = await startMatch();
  await fixture.patchGame((game) => ({
    ...game,
    reactionWindows: [reactionWindow(isoAt(10_000))],
  }));
  return attachDriver(fixture, options);
}

function stops(events: readonly WindowExpiryDriverEvent[]): readonly WindowExpiryStop[] {
  return events
    .filter((event) => event.type === "window-expiry.pass.finished")
    .map((event) => event.stop);
}

function lastStop(events: readonly WindowExpiryDriverEvent[]): WindowExpiryStop {
  const all = stops(events);
  const stop = all[all.length - 1];
  if (stop === undefined) throw new Error("no pass finished");
  return stop;
}

function fired(
  events: readonly WindowExpiryDriverEvent[],
): readonly Extract<WindowExpiryDriverEvent, { type: "window-expiry.fired" }>[] {
  return events.filter((event) => event.type === "window-expiry.fired");
}

function refusals(
  events: readonly WindowExpiryDriverEvent[],
): readonly Extract<WindowExpiryDriverEvent, { type: "window-expiry.refused" }>[] {
  return events.filter((event) => event.type === "window-expiry.refused");
}

function defects(events: readonly WindowExpiryDriverEvent[]): readonly WindowExpiryDriverEvent[] {
  return events.filter((event) => {
    if (event.type === "window-expiry.pass.finished") return isWindowExpiryDefect(event.stop);
    return (
      event.type === "window-expiry.publish.failed" || event.type === "window-expiry.pass.crashed"
    );
  });
}

describe("the happy path", () => {
  it("Given a reaction window whose deadline has arrived, When a pass runs, Then window.expire commits through the ordinary path", async () => {
    const harness = await withOpenWindow();
    const before = await harness.fixture.game();
    harness.fixture.advanceMs(10_000);

    await harness.driver.drive(ROOM_ID);

    const after = await harness.fixture.game();
    expect(after.reactionWindows).toEqual([]);
    // Same revision check, same receipt, same event log as a player's own
    // command: the revision advanced by exactly one and the command id is on it.
    expect(after.revision).toBe(before.revision + 1);
    expect(after.lastCommandId).toBe(
      expirySubmissionFor(ROOM_ID, before, {
        kind: "reaction-window",
        id: WINDOW_ID,
        deadlineAt: isoAt(10_000),
        deadlineMs: 0,
        derived: false,
      }).commandId,
    );
    expect(fired(harness.events)).toMatchObject([
      { targetKind: "reaction-window", targetId: WINDOW_ID, lateMs: 0, derivedDeadline: false },
    ]);
    expect(harness.published).toHaveLength(1);
    expect(harness.committedKicks).toEqual([ROOM_ID]);
    expect(defects(harness.events)).toEqual([]);
  });

  it("Given an open ballot past its deadline, When a pass runs, Then it is resolved and never offered again", async () => {
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({ ...game, ballots: [ballot(isoAt(5_000))] }));
    const harness = attachDriver(fixture);
    fixture.advanceMs(5_000);

    await harness.driver.drive(ROOM_ID);
    const afterFirst = await fixture.game();
    await harness.driver.drive(ROOM_ID);

    expect(afterFirst.ballots[0]?.resolution).not.toBeNull();
    expect(fired(harness.events)).toHaveLength(1);
    // The resolved row keeps its past deadline; a scan that re-offered it would
    // burn a command on every pass forever.
    expect((await fixture.game()).revision).toBe(afterFirst.revision);
    expect(lastStop(harness.events)).toMatchObject({ kind: "idle" });
  });

  it("Given the turn clock is on and a turn is over its budget, When a pass runs, Then turn.timeout commits", async () => {
    const fixture = await startMatch();
    const harness = attachDriver(fixture, { turnClockEnabled: true });
    const before = await fixture.game();
    fixture.advanceMs(QUICK_TURN_CLOCK_MS);

    await harness.driver.drive(ROOM_ID);

    const after = await fixture.game();
    expect(fired(harness.events)).toMatchObject([
      { targetKind: "turn", derivedDeadline: true, lateMs: 0 },
    ]);
    expect(after.turn.number).toBe(before.turn.number + 1);
    expect(after.turn.activePlayerId).not.toBe(before.turn.activePlayerId);
    expect(defects(harness.events)).toEqual([]);
  });
});

describe("not authoritative about time", () => {
  it("Given a deadline that has not arrived, When a pass runs, Then nothing is committed and a wakeup is armed for the remainder", async () => {
    const harness = await withOpenWindow();
    harness.fixture.advanceMs(4_000);
    const before = await harness.fixture.game();

    await harness.driver.drive(ROOM_ID);

    expect(fired(harness.events)).toEqual([]);
    expect((await harness.fixture.game()).revision).toBe(before.revision);
    expect(lastStop(harness.events)).toMatchObject({
      kind: "pending",
      remainingMs: 6_000,
      target: { kind: "reaction-window", id: WINDOW_ID },
    });
    expect(harness.wakeups).toHaveLength(1);
    expect(harness.wakeups[0]?.delayMs).toBeGreaterThanOrEqual(6_000);
    expect(harness.wakeups[0]?.delayMs).toBeLessThan(7_000);
  });

  it("Given a wakeup that fires early, When it drives, Then the command is not submitted", async () => {
    // The engine cannot reject an early expiry — `expireWindow` never looks at
    // the deadline — so refusing to fire early has to happen here.
    const harness = await withOpenWindow();
    await harness.driver.drive(ROOM_ID);
    const armed = harness.wakeups[0];
    expect(armed).toBeDefined();

    harness.fixture.advanceMs(9_999);
    armed?.fire();
    await harness.driver.drive(ROOM_ID);

    expect(fired(harness.events)).toEqual([]);
    expect((await harness.fixture.game()).reactionWindows).toHaveLength(1);
  });

  it("Given a deadline missed by an hour, When a pass finally runs, Then it still resolves and reports how late it was", async () => {
    const harness = await withOpenWindow();
    harness.fixture.advanceMs(3_610_000);

    await harness.driver.drive(ROOM_ID);

    expect(fired(harness.events)).toMatchObject([{ lateMs: 3_600_000 }]);
    expect((await harness.fixture.game()).reactionWindows).toEqual([]);
  });
});

describe("recoverable", () => {
  it("Given a process that died mid-window, When a fresh driver takes over, Then the overdue window resolves on its first pass", async () => {
    // The wakeup lives in memory and dies with the process. Nothing else about
    // this driver is stateful, which is exactly what makes a restart cost one
    // pass rather than the match.
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      reactionWindows: [reactionWindow(isoAt(10_000))],
    }));
    const doomed = attachDriver(fixture);
    await doomed.driver.drive(ROOM_ID);
    expect(doomed.wakeups).toHaveLength(1);
    doomed.driver.stop();
    expect(doomed.wakeups[0]?.cancelled).toBe(true);

    fixture.advanceMs(60_000);
    const restarted = attachDriver(fixture);
    await restarted.driver.drive(ROOM_ID);

    expect(fired(restarted.events)).toHaveLength(1);
    expect((await fixture.game()).reactionWindows).toEqual([]);
  });

  it("Given several deadlines already overdue, When one pass runs, Then all of them resolve in that pass", async () => {
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      reactionWindows: [reactionWindow(isoAt(1_000))],
      ballots: [ballot(isoAt(2_000))],
    }));
    const harness = attachDriver(fixture);
    fixture.advanceMs(600_000);

    await harness.driver.drive(ROOM_ID);

    // Earliest deadline first, deterministically: the window was due at +1s and
    // the ballot at +2s, and two processes must agree on that order.
    expect(fired(harness.events).map((event) => event.targetKind)).toEqual([
      "reaction-window",
      "ballot",
    ]);
    const game = await fixture.game();
    expect(game.reactionWindows).toEqual([]);
    expect(game.ballots[0]?.resolution).not.toBeNull();
    expect(defects(harness.events)).toEqual([]);
  });
});

describe("idempotent", () => {
  it("Given a window that has already been expired, When a pass runs again, Then nothing is resolved twice", async () => {
    const harness = await withOpenWindow();
    harness.fixture.advanceMs(10_000);

    await harness.driver.drive(ROOM_ID);
    const afterFirst = await harness.fixture.game();
    await harness.driver.drive(ROOM_ID);

    expect(fired(harness.events)).toHaveLength(1);
    expect((await harness.fixture.game()).revision).toBe(afterFirst.revision);
    expect(defects(harness.events)).toEqual([]);
  });

  it("Given two drivers over one room, When both fire at once, Then exactly one command lands", async () => {
    // Two timers, a retry and a restart all produce duplicate fires in practice.
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      reactionWindows: [reactionWindow(isoAt(10_000))],
    }));
    const left = attachDriver(fixture);
    const right = attachDriver(fixture);
    fixture.advanceMs(10_000);

    await Promise.all([left.driver.drive(ROOM_ID), right.driver.drive(ROOM_ID)]);

    expect(fired(left.events).length + fired(right.events).length).toBe(1);
    expect((await fixture.game()).reactionWindows).toEqual([]);
  });

  it("Given the same command id submitted twice, When the second arrives, Then the engine refuses it as already applied", async () => {
    // The structural half of idempotency: the id is a pure function of (game,
    // revision, target), so a duplicate cannot be mistaken for new work.
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      reactionWindows: [reactionWindow(isoAt(10_000))],
    }));
    const game = await fixture.game();
    const submission = expirySubmissionFor(ROOM_ID, game, {
      kind: "reaction-window",
      id: WINDOW_ID,
      deadlineAt: isoAt(10_000),
      deadlineMs: 0,
      derived: false,
    });

    const first = await fixture.service.submitServerCommand(submission);
    const replayed = await fixture.service.submitServerCommand(submission);

    expect(first).toMatchObject({ ok: true });
    // `commandId === lastCommandId` is checked before the revision, so a replay
    // is refused as already-applied rather than merely as stale — the engine
    // knows it is the *same* command, not a different one arriving late.
    expect(replayed).toMatchObject({ ok: false, error: { code: "INVALID_COMMAND" } });
    expect((await fixture.game()).reactionWindows).toEqual([]);
  });
});

describe("authorisation", () => {
  it("Given the submission the scheduler builds, When it is inspected, Then it names no actor at all", async () => {
    // `SubmitServerCommandInput` has no actorId field: the service derives a
    // synthetic non-seated actor itself. A scheduler that cannot name an actor
    // cannot name a player, so "a player expired the window" is unrepresentable
    // from here rather than merely refused.
    const fixture = await startMatch();
    const submission = expirySubmissionFor(ROOM_ID, await fixture.game(), {
      kind: "reaction-window",
      id: WINDOW_ID,
      deadlineAt: isoAt(0),
      deadlineMs: 0,
      derived: false,
    });

    expect(Object.keys(submission).sort()).toEqual([
      "commandId",
      "decisionPointId",
      "expectedRevision",
      "roomId",
      "type",
    ]);
  });

  it("Given the command id the scheduler mints, When a client tries to send it, Then contracts refuses it", async () => {
    // These ids are computable from published state. Without the reservation a
    // player could pre-claim the next one and permanently disable expiry for
    // that window — and an unexpirable window blocks every other command.
    const fixture = await startMatch();
    const submission = expirySubmissionFor(ROOM_ID, await fixture.game(), {
      kind: "reaction-window",
      id: WINDOW_ID,
      deadlineAt: isoAt(0),
      deadlineMs: 0,
      derived: false,
    });

    expect(submission.commandId.startsWith(TURN_TIMEOUT_COMMAND_ID_PREFIX)).toBe(true);
    expect(() => parseCommandId(submission.commandId)).toThrow(/reserved/i);
  });

  it("Given an expiry submitted under a client-shaped command id, When it reaches the service, Then it is refused", async () => {
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      reactionWindows: [reactionWindow(isoAt(10_000))],
    }));
    const game = await fixture.game();

    const forged = await fixture.service.submitServerCommand({
      roomId: ROOM_ID,
      type: "window.expire",
      expectedRevision: game.revision,
      decisionPointId: WINDOW_ID,
      commandId: crypto.randomUUID(),
    });

    expect(forged).toMatchObject({ ok: false, error: { code: "ACTOR_NOT_AUTHORIZED" } });
    expect((await fixture.game()).reactionWindows).toHaveLength(1);
  });

  it("Given a committed expiry, When the room is read back, Then the scheduler never became a member or a player", async () => {
    const harness = await withOpenWindow();
    const membersBefore = (await harness.fixture.room()).memberIds;
    harness.fixture.advanceMs(10_000);

    await harness.driver.drive(ROOM_ID);

    const room = await harness.fixture.room();
    const game = await harness.fixture.game();
    expect(room.memberIds).toEqual(membersBefore);
    expect(Object.keys(game.players).sort()).toEqual(
      [players.host, players.second, players.third].sort(),
    );
  });
});

describe("mode-disabled and switched-off cases", () => {
  it("Given the turn clock is off for this deployment, When a turn runs long past its budget, Then nothing is committed", async () => {
    const fixture = await startMatch();
    const harness = attachDriver(fixture, { turnClockEnabled: false });
    const before = await fixture.game();
    fixture.advanceMs(600_000);

    await harness.driver.drive(ROOM_ID);

    expect(fired(harness.events)).toEqual([]);
    expect((await fixture.game()).revision).toBe(before.revision);
    expect(lastStop(harness.events)).toMatchObject({ kind: "idle", gameStatus: "active" });
    expect(harness.wakeups).toHaveLength(0);
  });

  it("Given the turn clock is off, When a reaction window is also due, Then the window still expires", async () => {
    // The two are independent: a window is a mechanic the mode enabled, a turn
    // clock is an operator preference, and a window nobody can close wedges the
    // whole match.
    const harness = await withOpenWindow({ turnClockEnabled: false });
    harness.fixture.advanceMs(600_000);

    await harness.driver.drive(ROOM_ID);

    expect(fired(harness.events)).toMatchObject([{ targetKind: "reaction-window" }]);
  });

  it("Given a game with no wall-clock boundary at all, When a pass runs, Then it settles idle without arming anything", async () => {
    const fixture = await startMatch();
    const harness = attachDriver(fixture, { turnClockEnabled: false });

    await harness.driver.drive(ROOM_ID);

    expect(lastStop(harness.events)).toMatchObject({ kind: "idle" });
    expect(harness.wakeups).toHaveLength(0);
    expect(harness.published).toEqual([]);
  });
});

describe("hostile and broken input", () => {
  it("Given an unparseable deadline in stored state, When a pass runs, Then nothing fires and nothing crashes", async () => {
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      reactionWindows: [reactionWindow("<script>alert(1)</script>")],
    }));
    const harness = attachDriver(fixture);
    fixture.advanceMs(600_000);

    await harness.driver.drive(ROOM_ID);

    expect(fired(harness.events)).toEqual([]);
    expect(lastStop(harness.events)).toMatchObject({ kind: "idle" });
    expect((await fixture.game()).reactionWindows).toHaveLength(1);
  });

  it("Given a submit that keeps failing, When a pass runs, Then it stops without arming a wakeup to retry into", async () => {
    // A rejected target keeps its past deadline, so re-arming would be a busy
    // loop against a command that cannot land.
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      reactionWindows: [reactionWindow(isoAt(1_000))],
    }));
    const harness = attachDriver(fixture, {
      roomService: {
        submitServerCommand: async () => ({ ok: false, error: { code: "ILLEGAL_ACTION" } }),
      },
    });
    fixture.advanceMs(10_000);

    await harness.driver.drive(ROOM_ID);

    expect(harness.wakeups).toHaveLength(0);
    expect(lastStop(harness.events)).toMatchObject({
      kind: "command-rejected",
      code: "ILLEGAL_ACTION",
      expected: false,
    });
    // Loud on purpose: nothing in the engine should refuse a window the scan
    // just read out of state.
    expect(defects(harness.events)).toHaveLength(1);
  });

  it("Given one resolvable the engine will never close, When other deadlines are also due, Then the doomed one does not starve them", async () => {
    // The earliest deadline is picked first on every pass. Without skipping it,
    // an un-expirable window would mean the ballot behind it — and the turn
    // behind that — were never even attempted, for the rest of the match.
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      reactionWindows: [reactionWindow(isoAt(1_000))],
      ballots: [ballot(isoAt(2_000))],
    }));
    const harness = attachDriver(fixture, {
      roomService: {
        submitServerCommand: async (input) =>
          input.type === "window.expire" && input.decisionPointId === WINDOW_ID
            ? { ok: false, error: { code: "INVARIANT_VIOLATION" } }
            : fixture.service.submitServerCommand(input),
      },
    });
    fixture.advanceMs(10_000);

    await harness.driver.drive(ROOM_ID);

    expect(refusals(harness.events)).toMatchObject([
      { targetKind: "reaction-window", code: "INVARIANT_VIOLATION", expected: false },
    ]);
    expect(fired(harness.events)).toMatchObject([{ targetKind: "ballot" }]);
    expect((await fixture.game()).ballots[0]?.resolution).not.toBeNull();
    // Still loud: a window the scan read out of state and the engine refused is
    // a deadline nothing will ever resolve.
    expect(defects(harness.events)).toHaveLength(1);
  });

  it("Given a doomed target and a later deadline, When the pass ends, Then the later one is still armed for", async () => {
    // Letting one broken resolvable stop the room's turn clock from ever firing
    // again is the worse failure. The refused target is skipped, and the wakeup
    // is for the deadline that can still land. A ballot rather than a window,
    // because an open window deliberately holds the turn clock off anyway — it
    // is the thing the turn is waiting on.
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      ballots: [ballot(isoAt(1_000))],
    }));
    const harness = attachDriver(fixture, {
      turnClockEnabled: true,
      roomService: {
        submitServerCommand: async () => ({ ok: false, error: { code: "INVARIANT_VIOLATION" } }),
      },
    });
    fixture.advanceMs(2_000);

    await harness.driver.drive(ROOM_ID);

    expect(lastStop(harness.events)).toMatchObject({
      kind: "command-rejected",
      expected: false,
    });
    // The turn's own deadline is +20s and has not arrived, so it is waited for
    // rather than abandoned along with the window.
    expect(harness.wakeups).toHaveLength(1);
    expect(harness.wakeups[0]?.delayMs).toBeGreaterThanOrEqual(
      QUICK_TURN_CLOCK_MS - 2_000,
    );
  });

  it("Given somebody answered the window first, When the expiry lands, Then losing the race is a quiet stop", async () => {
    const fixture = await startMatch();
    await fixture.patchGame((game) => ({
      ...game,
      reactionWindows: [reactionWindow(isoAt(1_000))],
    }));
    const harness = attachDriver(fixture, {
      roomService: {
        submitServerCommand: async () => ({
          ok: false,
          error: { code: "DECISION_POINT_NOT_FOUND" },
        }),
      },
    });
    fixture.advanceMs(10_000);

    await harness.driver.drive(ROOM_ID);

    expect(lastStop(harness.events)).toMatchObject({ expected: true });
    expect(refusals(harness.events)).toMatchObject([{ expected: true }]);
    expect(defects(harness.events)).toEqual([]);
  });

  it("Given a room that does not exist, When a pass runs, Then it stops without touching anything", async () => {
    const fixture = await startMatch();
    const harness = attachDriver(fixture);

    await harness.driver.drive("room-that-was-never-created");

    expect(lastStop(harness.events)).toEqual({ kind: "room-not-found" });
    expect(harness.wakeups).toHaveLength(0);
  });

  it("Given a reporter that throws, When an expiry commits, Then the commit is unaffected", async () => {
    const harness = await withOpenWindow({
      onEvent: () => {
        throw new Error("the log is on fire");
      },
    });
    harness.fixture.advanceMs(10_000);

    await harness.driver.drive(ROOM_ID);

    expect((await harness.fixture.game()).reactionWindows).toEqual([]);
  });
});

describe("reviving the schedule from a read", () => {
  it("Given a live match, When a bootstrap is read, Then the schedule should be revived", () => {
    expect(
      shouldSweepWindows({
        room: {} as never,
        publicProjection: { status: "active" } as never,
        self: {} as never,
        prompts: [],
        reactions: [],
        legalActions: [],
        serverTime: isoAt(0),
      } as never),
    ).toBe(true);
  });

  it("Given a lobby bootstrap or a finished match, When it is read, Then nothing is swept", () => {
    expect(
      shouldSweepWindows({ room: {} as never, selfMemberId: "x", characterOptions: [] }),
    ).toBe(false);
    expect(
      shouldSweepWindows({
        room: {} as never,
        publicProjection: { status: "ended" } as never,
        self: {} as never,
        prompts: [],
        reactions: [],
        legalActions: [],
        serverTime: isoAt(0),
      } as never),
    ).toBe(false);
  });
});

describe("the wakeup is only ever a hint", () => {
  it("Given a pass that settles, When stop() is called, Then every pending wakeup is dropped", async () => {
    const harness = await withOpenWindow();
    await harness.driver.drive(ROOM_ID);
    expect(harness.wakeups).toHaveLength(1);

    harness.driver.stop();

    expect(harness.wakeups.every((wakeup) => wakeup.cancelled)).toBe(true);
  });

  it("Given a room whose window closed while a wakeup was pending, When the wakeup fires, Then the stale timer is cancelled", async () => {
    const harness = await withOpenWindow();
    await harness.driver.drive(ROOM_ID);
    await harness.fixture.patchGame((game: GameState) => ({ ...game, reactionWindows: [] }));

    await harness.driver.drive(ROOM_ID);

    expect(harness.wakeups[0]?.cancelled).toBe(true);
    expect(lastStop(harness.events)).toMatchObject({ kind: "idle" });
  });
});
