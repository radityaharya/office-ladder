import { describe, expect, it } from "vitest";

import { createStableId, type GameState, type PromptState } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type {
  RoomRepository,
  RoomService,
  RoomWriteResult,
  StoredRoom,
} from "../../src/rooms/service/types";
import {
  createTurnTimeoutDriver,
  isTurnTimeoutDefect,
  type TurnTimeoutDriver,
  type TurnTimeoutDriverEvent,
  type TurnTimeoutStop,
} from "../../src/rooms/turn-timer/turn-timeout-driver";

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
  third: createStableId("PlayerId", "user-third"),
} as const;

const roomId = "room-timeout-driver-test";
const START_MS = Date.parse("2026-07-26T12:00:00.000Z");
const TIMEOUT_MS = 30_000;

type PendingWakeup = {
  readonly delayMs: number;
  readonly fire: () => void;
  cancelled: boolean;
};

type Harness = {
  readonly repository: InMemoryRoomRepository;
  readonly service: RoomService;
  readonly driver: TurnTimeoutDriver;
  readonly events: TurnTimeoutDriverEvent[];
  readonly published: { revision: number; messageId: string }[];
  readonly botDrives: string[];
  readonly wakeups: PendingWakeup[];
  /** Moves the shared clock the service and the driver both read. */
  readonly advanceMs: (ms: number) => void;
  readonly now: () => string;
  readonly room: () => Promise<StoredRoom>;
  readonly game: () => Promise<GameState>;
};

type HarnessOptions = {
  readonly timeoutMs?: number;
  /** What the injected bot driver does when the timeout driver hands off. */
  readonly onDriveBots?: (roomId: string) => Promise<void>;
  readonly onEvent?: (event: TurnTimeoutDriverEvent) => void;
  readonly repository?: RoomRepository;
  readonly service?: RoomService;
};

function createService(
  repository: RoomRepository,
  now: () => string,
  turnTimeoutMs: number,
): RoomService {
  return createRoomService({
    repository,
    now,
    ids: {
      roomId: () => roomId,
      roomCode: () => "TMO123",
      gameId: () => createStableId("GameId", "game-timeout-driver-test"),
      commandId: () => createStableId("CommandId", "command-timeout-driver-test"),
    },
    gameSeed: () => "timeout-driver-seed",
    turnTimeoutMs,
  });
}

/**
 * A started three-human match with the clock running, plus a driver whose wakeups
 * and bot handoff the test controls. No real timers are involved anywhere.
 */
async function startMatch(options: HarnessOptions = {}): Promise<Harness> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const repository =
    options.repository instanceof InMemoryRoomRepository
      ? options.repository
      : new InMemoryRoomRepository();
  const events: TurnTimeoutDriverEvent[] = [];
  const published: { revision: number; messageId: string }[] = [];
  const botDrives: string[] = [];
  const wakeups: PendingWakeup[] = [];
  let nowMs = START_MS;
  const now = (): string => new Date(nowMs).toISOString();

  const service = options.service ?? createService(options.repository ?? repository, now, timeoutMs);

  const driver = createTurnTimeoutDriver({
    roomService: service,
    repository: options.repository ?? repository,
    now,
    timeoutMs,
    publish: async (_roomId, revision, messageId) => {
      published.push({ revision, messageId });
    },
    driveBots: async (kickedRoomId) => {
      botDrives.push(kickedRoomId);
      await options.onDriveBots?.(kickedRoomId);
    },
    setTimer: (callback, delayMs) => {
      const wakeup: PendingWakeup = { delayMs, fire: callback, cancelled: false };
      wakeups.push(wakeup);
      return () => {
        wakeup.cancelled = true;
      };
    },
    onEvent: (event) => {
      events.push(event);
      options.onEvent?.(event);
    },
  });

  await service.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
  await service.join({ roomId, actorId: players.second, playerName: "Second" });
  await service.join({ roomId, actorId: players.third, playerName: "Third" });
  const started = await service.start({ roomId, actorId: players.host, actorKind: "human" });
  expect(started).toMatchObject({ ok: true });

  const readRoom = async (): Promise<StoredRoom> => {
    const room = await (options.repository ?? repository).get(roomId);
    if (room === null) throw new Error("room vanished");
    return room;
  };

  return {
    repository,
    service,
    driver,
    events,
    published,
    botDrives,
    wakeups,
    advanceMs: (ms) => {
      nowMs += ms;
    },
    now,
    room: readRoom,
    game: async () => {
      const game = (await readRoom()).game;
      if (game === null) throw new Error("game vanished");
      return game;
    },
  };
}

function stops(events: readonly TurnTimeoutDriverEvent[]): readonly TurnTimeoutStop[] {
  return events
    .filter((event) => event.type === "turn-timeout.pass.finished")
    .map((event) => event.stop);
}

function lastStop(events: readonly TurnTimeoutDriverEvent[]): TurnTimeoutStop {
  const all = stops(events);
  const stop = all[all.length - 1];
  if (stop === undefined) throw new Error("no pass finished");
  return stop;
}

function applied(
  events: readonly TurnTimeoutDriverEvent[],
): readonly Extract<TurnTimeoutDriverEvent, { type: "turn-timeout.applied" }>[] {
  return events.filter((event) => event.type === "turn-timeout.applied");
}

function defects(events: readonly TurnTimeoutDriverEvent[]): readonly TurnTimeoutDriverEvent[] {
  return events.filter((event) => {
    if (event.type === "turn-timeout.pass.finished") return isTurnTimeoutDefect(event.stop);
    return (
      event.type === "turn-timeout.publish.failed" || event.type === "turn-timeout.pass.crashed"
    );
  });
}

/** An audit-release prompt addressed to the active player, injected into stored state. */
function withAuditPrompt(game: GameState, playerId: string): GameState {
  const prompt: PromptState = {
    id: createStableId("DecisionPointId", "decision-audit-release"),
    frameId: createStableId("FrameId", "frame-audit-release"),
    kind: "audit-release",
    audience: [createStableId("PlayerId", playerId)],
    legalResponses: [
      { id: createStableId("PromptOptionId", "pay-fine"), value: null },
      { id: createStableId("PromptOptionId", "attempt-roll"), value: null },
    ],
    deadlineAt: null,
    defaultResponse: {
      optionId: createStableId("PromptOptionId", "attempt-roll"),
      value: null,
    },
    visibility: "private",
    responses: {},
  };
  return { ...game, prompts: [prompt] };
}

describe("turn timeout driver: arming", () => {
  it("Given a live turn with time left, When a pass runs, Then nothing is committed and a wakeup is armed for the remainder", async () => {
    const harness = await startMatch();
    harness.advanceMs(10_000);
    const before = await harness.game();

    await harness.driver.drive(roomId);

    expect(applied(harness.events)).toHaveLength(0);
    expect((await harness.game()).revision).toBe(before.revision);
    expect(lastStop(harness.events)).toMatchObject({
      kind: "timer-pending",
      playerId: players.host,
      remainingMs: 20_000,
    });
    // The wakeup is what makes the clock fire on time instead of waiting for a
    // client to poll; the grace only decides when we bother to look.
    expect(harness.wakeups).toHaveLength(1);
    expect(harness.wakeups[0]?.delayMs).toBeGreaterThanOrEqual(20_000);
    expect(harness.wakeups[0]?.delayMs).toBeLessThan(21_000);
  });

  it("Given a live turn whose deadline was lost with the process, When a pass runs, Then it is re-armed and published", async () => {
    // This is the restart case: the room survives in Postgres, the in-memory
    // wakeup does not, and a room written by a build without the clock has no
    // deadline at all.
    const harness = await startMatch();
    const room = await harness.room();
    expect(
      await harness.repository.save({ ...room, turnTimer: null, revision: room.revision + 1 }, room.revision),
    ).toEqual({ ok: true });

    await harness.driver.drive(roomId);

    const rearmed = await harness.room();
    expect(rearmed.turnTimer).toMatchObject({
      playerId: players.host,
      durationMs: TIMEOUT_MS,
      gameRevision: rearmed.game?.revision,
    });
    expect(lastStop(harness.events)).toMatchObject({ kind: "timer-armed" });
    expect(harness.published).toHaveLength(1);
    expect(applied(harness.events)).toHaveLength(0);
  });

  it("Given a deadline left over from an earlier turn, When a pass runs, Then it is replaced rather than enforced", async () => {
    const harness = await startMatch();
    const room = await harness.room();
    const timer = room.turnTimer;
    if (timer === null) throw new Error("expected an armed timer");
    // A deadline in the past, for a turn that has already been taken. Enforcing it
    // would take a turn from a player who still has their full time.
    expect(
      await harness.repository.save(
        {
          ...room,
          revision: room.revision + 1,
          turnTimer: {
            ...timer,
            gameRevision: timer.gameRevision - 1,
            deadlineAt: new Date(START_MS - 1_000).toISOString(),
          },
        },
        room.revision,
      ),
    ).toEqual({ ok: true });

    await harness.driver.drive(roomId);

    expect(applied(harness.events)).toHaveLength(0);
    expect(lastStop(harness.events)).toMatchObject({ kind: "timer-armed" });
    expect((await harness.room()).turnTimer).toMatchObject({
      gameRevision: timer.gameRevision,
      deadlineAt: new Date(START_MS + TIMEOUT_MS).toISOString(),
    });
  });

  it("Given the clock is switched off, When a pass runs, Then it does nothing at all", async () => {
    const harness = await startMatch({ timeoutMs: 0 });
    harness.advanceMs(600_000);

    await harness.driver.drive(roomId);

    expect(lastStop(harness.events)).toEqual({ kind: "no-clock" });
    expect(applied(harness.events)).toHaveLength(0);
    expect(harness.wakeups).toHaveLength(0);
    expect(harness.published).toHaveLength(0);
  });

  it("Given the clock is switched off while a turn is already on it, When a pass runs, Then the orphaned deadline is dropped rather than counted down to nothing", async () => {
    // Turning TURN_TIMEOUT_SECONDS off and restarting leaves a deadline in storage
    // that still matches the current (game revision, player) pair, so it is
    // "current" and gets projected as a live countdown — while nothing will ever
    // enforce it, because this process has no clock. A countdown that reaches zero
    // and then does nothing is worse than no countdown at all.
    const harness = await startMatch();
    const armed = await harness.room();
    expect(armed.turnTimer).not.toBeNull();

    const events: TurnTimeoutDriverEvent[] = [];
    const disabled = createTurnTimeoutDriver({
      roomService: harness.service,
      repository: harness.repository,
      now: harness.now,
      timeoutMs: 0,
      publish: async () => undefined,
      driveBots: async () => undefined,
      setTimer: () => () => undefined,
      onEvent: (event) => events.push(event),
    });

    await disabled.drive(roomId);

    expect((await harness.room()).turnTimer).toBeNull();
    expect(lastStop(events)).toEqual({ kind: "no-clock" });
    expect(applied(events)).toHaveLength(0);
    expect(defects(events)).toHaveLength(0);
  });
});

describe("turn timeout driver: enforcement", () => {
  it("Given an expired turn, When a pass runs, Then the roll is committed for the absent player and the next clock starts", async () => {
    const harness = await startMatch();
    const before = await harness.game();
    harness.advanceMs(TIMEOUT_MS);

    await harness.driver.drive(roomId);

    const after = await harness.game();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.turn.activePlayerId).toBe(players.second);
    expect(applied(harness.events)).toMatchObject([
      { playerId: players.host, decision: "roll", promptKind: null, unclassified: false },
    ]);
    // Committing armed the next player's deadline in the same write, so the pass
    // settles on it rather than needing another kick.
    expect((await harness.room()).turnTimer).toMatchObject({
      playerId: players.second,
      gameRevision: after.revision,
    });
    expect(lastStop(harness.events)).toMatchObject({ kind: "timer-pending" });
    expect(harness.published).toMatchObject([{ revision: (await harness.room()).revision }]);
    expect(defects(harness.events)).toHaveLength(0);
  });

  it("Given an expired turn holding an audit prompt, When a pass runs, Then the free attempt is taken and no money is spent", async () => {
    const harness = await startMatch();
    const room = await harness.room();
    const game = room.game;
    if (game === null) throw new Error("game vanished");
    expect(
      await harness.repository.save(
        {
          ...room,
          revision: room.revision + 1,
          game: withAuditPrompt(game, players.host),
        },
        room.revision,
      ),
    ).toEqual({ ok: true });
    const moneyBefore = (await harness.game()).players[players.host]?.resources["money"]?.value;
    harness.advanceMs(TIMEOUT_MS);

    await harness.driver.drive(roomId);

    const after = await harness.game();
    expect(applied(harness.events)).toMatchObject([
      { decision: "respond", promptKind: "audit-release", unclassified: false },
    ]);
    // pay-fine would have taken 500. The attempt costs nothing, and the turn moves
    // on either way, so the table is never blocked.
    expect(after.players[players.host]?.resources["money"]?.value).toBe(moneyBefore);
    expect(after.turn.activePlayerId).toBe(players.second);
    expect(defects(harness.events)).toHaveLength(0);
  });

  it("Given an expired turn the player cannot act on, When a pass runs, Then the stall is reported as a defect", async () => {
    const harness = await startMatch();
    const room = await harness.room();
    const game = room.game;
    if (game === null) throw new Error("game vanished");
    // A phase with no legal action: nobody can move this match on, which is the
    // loudest thing this driver has to say.
    expect(
      await harness.repository.save(
        {
          ...room,
          revision: room.revision + 1,
          game: { ...game, turn: { ...game.turn, phase: "tile-resolution" } },
        },
        room.revision,
      ),
    ).toEqual({ ok: true });
    harness.advanceMs(TIMEOUT_MS);

    await harness.driver.drive(roomId);

    expect(lastStop(harness.events)).toMatchObject({
      kind: "cannot-act",
      playerId: players.host,
    });
    expect(defects(harness.events)).toHaveLength(1);
    expect(applied(harness.events)).toHaveLength(0);
  });

  it("Given a fresh process, When a bootstrap read revives the driver, Then an already-expired turn is enforced", async () => {
    const harness = await startMatch();
    harness.advanceMs(TIMEOUT_MS * 4);
    // A second driver over the same repository stands in for a restarted process:
    // it has no wakeup for this room and has never seen it before.
    const restarted = createTurnTimeoutDriver({
      roomService: harness.service,
      repository: harness.repository,
      now: harness.now,
      timeoutMs: TIMEOUT_MS,
      publish: async () => undefined,
      driveBots: async () => undefined,
      setTimer: () => () => undefined,
      onEvent: () => undefined,
    });
    const before = await harness.game();

    await restarted.drive(roomId);

    expect((await harness.game()).revision).toBe(before.revision + 1);
  });

  it("Given a throwing event sink, When a turn is taken, Then the commit still stands", async () => {
    const harness = await startMatch({
      onEvent: () => {
        throw new Error("sink is broken");
      },
    });
    const before = await harness.game();
    harness.advanceMs(TIMEOUT_MS);

    await harness.driver.drive(roomId);

    expect((await harness.game()).revision).toBe(before.revision + 1);
  });
});

describe("turn timeout driver: handing off to bots", () => {
  it("Given a bot on turn, When a pass runs, Then the bot driver is given exactly one chance and no clock is armed", async () => {
    const harness = await startMatch();
    const room = await harness.room();
    // The host's seat becomes a bot seat, so the clock no longer applies to it.
    expect(
      await harness.repository.save(
        {
          ...room,
          revision: room.revision + 1,
          bots: [{ playerId: players.host, difficulty: "standard" }],
        },
        room.revision,
      ),
    ).toEqual({ ok: true });

    await harness.driver.drive(roomId);

    // Handing off once and then stopping is what keeps a bot the bot driver cannot
    // move from becoming a read loop.
    expect(harness.botDrives).toEqual([roomId]);
    expect(lastStop(harness.events)).toMatchObject({ kind: "bot-turn" });
    expect(defects(harness.events)).toHaveLength(0);
  });

  it("Given a bot on turn that the bot driver moves along, When a pass runs, Then the next human's clock is armed without waiting for a poll", async () => {
    const harness = await startMatch({
      onDriveBots: async (kickedRoomId) => {
        // Stand-in for the real bot driver: commit the bot's roll.
        const room = await harness.repository.get(kickedRoomId);
        const game = room?.game;
        if (room === null || game === undefined || game === null) return;
        await harness.service.roll({
          roomId: kickedRoomId,
          actorId: players.host,
          actorKind: "bot",
          expectedRevision: game.revision,
        });
      },
    });
    const room = await harness.room();
    expect(
      await harness.repository.save(
        {
          ...room,
          revision: room.revision + 1,
          turnTimer: null,
          bots: [{ playerId: players.host, difficulty: "standard" }],
        },
        room.revision,
      ),
    ).toEqual({ ok: true });

    await harness.driver.drive(roomId);

    expect(harness.botDrives).toEqual([roomId]);
    expect((await harness.room()).turnTimer).toMatchObject({ playerId: players.second });
    expect(lastStop(harness.events)).toMatchObject({ kind: "timer-pending" });
  });
});

describe("turn timeout driver: a timer and a player cannot both commit", () => {
  it("Given the player rolls as their clock expires, When both reach the service, Then exactly one turn is taken", async () => {
    const harness = await startMatch();
    const before = await harness.game();
    harness.advanceMs(TIMEOUT_MS);

    const [, humanResult] = await Promise.all([
      harness.driver.drive(roomId),
      harness.service.roll({
        roomId,
        actorId: players.host,
        actorKind: "human",
        expectedRevision: before.revision,
      }),
    ]);

    const after = await harness.game();
    expect(after.revision).toBe(before.revision + 1);
    const timeoutCommits = applied(harness.events).length;
    const humanCommits = humanResult.ok ? 1 : 0;
    expect(timeoutCommits + humanCommits).toBe(1);
    // Whoever lost was told so, rather than being told 200 over a turn that was
    // never taken.
    if (humanCommits === 0) {
      expect(humanResult).toEqual({ ok: false, error: { code: "STALE_REVISION" } });
    } else {
      expect(lastStop(harness.events)).toMatchObject({
        kind: "command-rejected",
        expected: true,
      });
    }
  });

  it("Given two processes racing the same expiry, When only the write predicate stands between them, Then the loser's turn is refused", async () => {
    // Two RoomService instances over one repository are two server processes over
    // one database: each has its own per-room lock, so the engine's
    // expectedRevision check passes for *both* — they read the same game — and only
    // the repository's revision predicate can stop the second write.
    const repository = new InMemoryRoomRepository();
    const attempts: { expectedRevision: number; ok: boolean }[] = [];
    let held: Promise<void> | null = null;
    let release: () => void = () => undefined;
    const gated: RoomRepository = {
      create: (room) => repository.create(room),
      get: (id) => repository.get(id),
      getByCode: (code) => repository.getByCode(code),
      async save(room, expectedRevision) {
        const gate = held;
        held = null;
        if (gate !== null) await gate;
        const result = await repository.save(room, expectedRevision);
        attempts.push({ expectedRevision, ok: result.ok });
        return result;
      },
    };

    let nowMs = START_MS;
    const now = (): string => new Date(nowMs).toISOString();
    const driverService = createService(gated, now, TIMEOUT_MS);
    const playerService = createService(gated, now, TIMEOUT_MS);
    const events: TurnTimeoutDriverEvent[] = [];
    const driver = createTurnTimeoutDriver({
      roomService: driverService,
      repository: gated,
      now,
      timeoutMs: TIMEOUT_MS,
      publish: async () => undefined,
      driveBots: async () => undefined,
      setTimer: () => () => undefined,
      onEvent: (event) => events.push(event),
    });

    await driverService.create({
      hostId: players.host,
      playerName: "Host",
      modeId: "mode.quick",
    });
    await driverService.join({ roomId, actorId: players.second, playerName: "Second" });
    await driverService.join({ roomId, actorId: players.third, playerName: "Third" });
    const started = await driverService.start({
      roomId,
      actorId: players.host,
      actorKind: "human",
    });
    if (!started.ok) throw new Error(`start failed: ${started.error.code}`);
    const gameRevision = started.value.game.revision;
    nowMs += TIMEOUT_MS;

    // Park the timeout driver's write mid-flight, let the player's roll commit,
    // then release it: the driver is now holding a snapshot older than the truth.
    held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const timeoutRun = driver.drive(roomId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const humanResult = await playerService.roll({
      roomId,
      actorId: players.host,
      actorKind: "human",
      expectedRevision: gameRevision,
    });
    release();
    await timeoutRun;

    expect(humanResult).toMatchObject({ ok: true });
    const room = await repository.get(roomId);
    expect(room?.game?.revision).toBe(gameRevision + 1);
    // The driver's write reached the repository and was refused there — proof the
    // predicate is what stopped it, not luck in the ordering.
    expect(attempts.filter((attempt) => !attempt.ok)).toHaveLength(1);
    expect(lastStop(events)).toMatchObject({ expected: true });
  });
});

describe("turn timeout driver: scheduling", () => {
  it("Given overlapping kicks, When passes are requested at once, Then they are serialized per room", async () => {
    const harness = await startMatch();
    harness.advanceMs(TIMEOUT_MS);

    await Promise.all([
      harness.driver.drive(roomId),
      harness.driver.drive(roomId),
      harness.driver.drive(roomId),
    ]);

    // Only one turn can be taken from one expiry, however many kicks arrive.
    expect(applied(harness.events)).toHaveLength(1);
  });

  it("Given a wakeup fires after the deadline, When it runs, Then the turn is taken without any client involvement", async () => {
    const harness = await startMatch();
    const before = await harness.game();

    await harness.driver.drive(roomId);
    const wakeup = harness.wakeups[0];
    if (wakeup === undefined) throw new Error("expected a wakeup");
    harness.advanceMs(wakeup.delayMs);
    wakeup.fire();
    // schedule() is fire-and-forget, so join the pass it started.
    await harness.driver.drive(roomId);

    expect((await harness.game()).revision).toBe(before.revision + 1);
    expect(applied(harness.events)).toHaveLength(1);
  });

  it("Given a pending wakeup, When stop() is called, Then it is cancelled", async () => {
    const harness = await startMatch();

    await harness.driver.drive(roomId);
    expect(harness.wakeups[0]?.cancelled).toBe(false);
    harness.driver.stop();

    expect(harness.wakeups[0]?.cancelled).toBe(true);
  });
});

describe("turn timeout driver: nothing to enforce", () => {
  it.each([
    [
      "a lobby",
      async (harness: Harness): Promise<void> => {
        const room = await harness.room();
        await harness.repository.save(
          { ...room, status: "open", revision: room.revision + 1 },
          room.revision,
        );
      },
      { kind: "room-not-active", roomStatus: "open" },
    ],
    [
      "a finished match",
      async (harness: Harness): Promise<void> => {
        const room = await harness.room();
        const game = room.game;
        if (game === null) throw new Error("game vanished");
        await harness.repository.save(
          { ...room, revision: room.revision + 1, game: { ...game, status: "ended" } },
          room.revision,
        );
      },
      { kind: "match-not-active", gameStatus: "ended" },
    ],
  ])(
    "Given %s, When a pass runs, Then it stops without committing anything",
    async (_label, mutate, expected) => {
      const harness = await startMatch();
      await mutate(harness);
      harness.advanceMs(TIMEOUT_MS * 2);

      await harness.driver.drive(roomId);

      expect(lastStop(harness.events)).toMatchObject(expected);
      expect(applied(harness.events)).toHaveLength(0);
      expect(defects(harness.events)).toHaveLength(0);
    },
  );

  it("Given no such room, When a pass runs, Then it reports the room rather than throwing", async () => {
    const harness = await startMatch();

    await harness.driver.drive("room-that-never-existed");

    expect(lastStop(harness.events)).toEqual({ kind: "room-not-found" });
  });

  it("Given a write that loses a race while arming, When the pass runs, Then it is reported as expected and retried later", async () => {
    const repository = new InMemoryRoomRepository();
    let refuseWrites = false;
    const stale: RoomRepository = {
      create: (room) => repository.create(room),
      get: (id) => repository.get(id),
      getByCode: (code) => repository.getByCode(code),
      async save(room, expectedRevision): Promise<RoomWriteResult> {
        // Stands in for another instance having committed first: the write reaches
        // the repository and the revision predicate refuses it.
        if (refuseWrites) return { ok: false, error: { code: "STALE_REVISION" } };
        return repository.save(room, expectedRevision);
      },
    };
    const harness = await startMatch({ repository: stale });
    const room = await harness.room();
    await repository.save({ ...room, turnTimer: null, revision: room.revision + 1 }, room.revision);
    refuseWrites = true;

    await harness.driver.drive(roomId);

    expect(lastStop(harness.events)).toEqual({
      kind: "timer-write-rejected",
      code: "STALE_REVISION",
      expected: true,
    });
    expect(defects(harness.events)).toHaveLength(0);
  });
});
