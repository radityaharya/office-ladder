import { describe, expect, it } from "vitest";

import { createStableId, type LegalAction } from "@office-ladder/engine";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { ActiveStoredRoom, StoredRoom } from "../../src/rooms/service/types";
import { decideTurnTimeoutAction } from "../../src/rooms/turn-timer/turn-timeout-policy";
import {
  DEFAULT_TURN_TIMEOUT_MS,
  MINIMUM_TURN_TIMEOUT_MS,
  isTurnTimerCurrent,
  isTurnTimerExpired,
  nextTurnTimer,
  parseTurnTimeoutSeconds,
  playerOnTheClock,
  remainingTurnTimerMs,
} from "../../src/rooms/turn-timer/turn-timer";

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
  third: createStableId("PlayerId", "user-third"),
} as const;

const roomId = "room-turn-timer-test";
const START = "2026-07-26T12:00:00.000Z";
const TIMEOUT_MS = 30_000;

const gameId = createStableId("GameId", "game-turn-timer-test");

/** A real started match, so the timer rules are exercised against real state. */
async function startedRoom(turnTimeoutMs: number): Promise<ActiveStoredRoom> {
  const repository = new InMemoryRoomRepository();
  const service = createRoomService({
    repository,
    now: () => START,
    ids: {
      roomId: () => roomId,
      roomCode: () => "TMR123",
      gameId: () => gameId,
      commandId: () => createStableId("CommandId", "command-turn-timer-test"),
    },
    gameSeed: () => "turn-timer-seed",
    turnTimeoutMs,
  });

  await service.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
  await service.join({ roomId, actorId: players.second, playerName: "Second" });
  await service.join({ roomId, actorId: players.third, playerName: "Third" });
  const started = await service.start({
    roomId,
    actorId: players.host,
    actorKind: "human",
  });
  if (!started.ok) throw new Error(`start failed: ${started.error.code}`);
  return started.value;
}

function withBotSeat(room: StoredRoom, playerId: string): StoredRoom {
  return {
    ...room,
    bots: [{ playerId: createStableId("PlayerId", playerId), difficulty: "standard" }],
  };
}

describe("TURN_TIMEOUT_SECONDS parsing", () => {
  it("Given no configuration, When resolving the timeout, Then the documented default applies", () => {
    expect(parseTurnTimeoutSeconds(undefined)).toEqual({
      ok: true,
      timeoutMs: DEFAULT_TURN_TIMEOUT_MS,
    });
    expect(parseTurnTimeoutSeconds("   ")).toEqual({
      ok: true,
      timeoutMs: DEFAULT_TURN_TIMEOUT_MS,
    });
  });

  it("Given zero, When resolving the timeout, Then the clock is switched off rather than defaulted", () => {
    // The whole point of the knob: a turn timer is hostile in a casual game and
    // "off" must not require a code change.
    expect(parseTurnTimeoutSeconds("0")).toEqual({ ok: true, timeoutMs: 0 });
  });

  it("Given a sane duration, When resolving the timeout, Then it is used verbatim", () => {
    expect(parseTurnTimeoutSeconds("45")).toEqual({ ok: true, timeoutMs: 45_000 });
  });

  it.each([
    ["a negative duration", "-30"],
    ["a non-number", "soon"],
    ["a fractional duration", "12.5"],
  ])(
    "Given %s, When resolving the timeout, Then it is reported and the default is used",
    (_label, configured) => {
      expect(parseTurnTimeoutSeconds(configured)).toEqual({
        ok: false,
        error: { code: "INVALID_TURN_TIMEOUT" },
        fallbackMs: DEFAULT_TURN_TIMEOUT_MS,
      });
    },
  );

  it("Given a duration below the floor, When resolving the timeout, Then it is raised to the floor and reported", () => {
    // A one-second turn is not a timer, it is a way to lose your turn.
    expect(parseTurnTimeoutSeconds("1")).toEqual({
      ok: false,
      error: { code: "INVALID_TURN_TIMEOUT" },
      fallbackMs: MINIMUM_TURN_TIMEOUT_MS,
    });
  });
});

describe("turn clock arming", () => {
  it("Given a started match, When it commits, Then the active human's deadline is already armed", async () => {
    const room = await startedRoom(TIMEOUT_MS);

    expect(room.turnTimer).toEqual({
      deadlineAt: "2026-07-26T12:00:30.000Z",
      durationMs: TIMEOUT_MS,
      gameRevision: room.game.revision,
      playerId: players.host,
    });
  });

  it("Given the clock is switched off, When a match starts, Then no deadline is armed at all", async () => {
    const room = await startedRoom(0);

    expect(room.turnTimer).toBeNull();
    expect(nextTurnTimer({ room, nowIso: START, timeoutMs: 0 })).toBeNull();
  });

  it("Given a room whose deadline is already armed for this turn, When re-derived, Then the same deadline is returned", async () => {
    const room = await startedRoom(TIMEOUT_MS);

    // Idempotence is the property that makes this a clock rather than a
    // suggestion: a write that does not advance the turn must not push the
    // deadline back.
    const later = nextTurnTimer({
      room,
      nowIso: "2026-07-26T12:00:20.000Z",
      timeoutMs: TIMEOUT_MS,
    });

    expect(later).toBe(room.turnTimer);
  });

  it("Given the turn belongs to a bot, When deriving the clock, Then nobody is on it", async () => {
    const room = withBotSeat(await startedRoom(TIMEOUT_MS), players.host);

    expect(playerOnTheClock(room)).toBeNull();
    expect(nextTurnTimer({ room, nowIso: START, timeoutMs: TIMEOUT_MS })).toBeNull();
  });

  it.each([
    ["a lobby", (room: ActiveStoredRoom): StoredRoom => ({ ...room, status: "open" })],
    [
      "a completed match",
      (room: ActiveStoredRoom): StoredRoom => ({
        ...room,
        game: { ...room.game, status: "ended" },
      }),
    ],
    [
      "a quarantined match",
      (room: ActiveStoredRoom): StoredRoom => ({
        ...room,
        game: { ...room.game, status: "quarantined" },
      }),
    ],
    [
      "a turn with no active player",
      (room: ActiveStoredRoom): StoredRoom => ({
        ...room,
        game: { ...room.game, turn: { ...room.game.turn, activePlayerId: null } },
      }),
    ],
  ])(
    "Given %s, When deriving the clock, Then no deadline is armed",
    async (_label, mutate) => {
      const room = mutate(await startedRoom(TIMEOUT_MS));

      expect(nextTurnTimer({ room, nowIso: START, timeoutMs: TIMEOUT_MS })).toBeNull();
    },
  );

  it("Given a deadline armed for an earlier turn, When checked against the room, Then it is not current", async () => {
    const room = await startedRoom(TIMEOUT_MS);
    const timer = room.turnTimer;
    if (timer === null) throw new Error("expected an armed timer");

    expect(isTurnTimerCurrent(room, timer)).toBe(true);
    // Both halves of the pair matter: a timer for the right player at the wrong
    // revision is a timer for a turn that has already been taken.
    expect(isTurnTimerCurrent(room, { ...timer, gameRevision: timer.gameRevision + 1 })).toBe(
      false,
    );
    expect(isTurnTimerCurrent(room, { ...timer, playerId: players.second })).toBe(false);
  });
});

describe("turn clock expiry", () => {
  const timer = {
    deadlineAt: "2026-07-26T12:00:30.000Z",
    durationMs: TIMEOUT_MS,
    gameRevision: 1,
    playerId: players.host,
  };

  it("Given time remaining, When checking expiry, Then the turn is not taken and the remainder is reported", () => {
    expect(remainingTurnTimerMs(timer, "2026-07-26T12:00:20.000Z")).toBe(10_000);
    expect(isTurnTimerExpired(timer, "2026-07-26T12:00:20.000Z")).toBe(false);
  });

  it("Given the deadline exactly reached, When checking expiry, Then it has expired", () => {
    expect(isTurnTimerExpired(timer, "2026-07-26T12:00:30.000Z")).toBe(true);
  });

  it("Given an unreadable deadline, When checking expiry, Then the turn is never taken", () => {
    // Fail-safe direction: a corrupt deadline must not be able to take somebody's
    // turn away from them.
    expect(isTurnTimerExpired({ ...timer, deadlineAt: "whenever" }, START)).toBe(false);
    expect(remainingTurnTimerMs({ ...timer, deadlineAt: "whenever" }, START)).toBeNull();
  });
});

describe("turn timeout policy", () => {
  const base = {
    gameId,
    actorId: players.host,
    expectedRevision: 4,
  } as const;

  const rollAction: LegalAction = { ...base, type: "turn.roll", payload: {} };

  function promptAction(kind: string, options: readonly string[]): LegalAction {
    return {
      ...base,
      type: "prompt.respond",
      decisionPointId: createStableId("DecisionPointId", "decision-1"),
      kind,
      options: options.map((option) => createStableId("PromptOptionId", option)),
    };
  }

  it("Given a roll is legal, When the clock runs out, Then the roll is taken for the player", () => {
    // Rolling is forced whenever it is legal, so this takes no decision away.
    expect(decideTurnTimeoutAction([rollAction])).toEqual({ kind: "roll" });
  });

  it("Given an audit-release prompt, When the clock runs out, Then the free attempt is chosen and never the fine", () => {
    const decision = decideTurnTimeoutAction([
      promptAction("audit-release", ["pay-fine", "attempt-roll"]),
    ]);

    // pay-fine takes 500 money — a quarter of a promotion — permanently, from a
    // player who is not there. attempt-roll costs nothing, still consumes the
    // turn, and leaves the real decision open if it fails.
    expect(decision).toEqual({
      kind: "respond",
      decisionPointId: "decision-1",
      optionId: "attempt-roll",
      promptKind: "audit-release",
      unclassified: false,
    });
  });

  it("Given a tile decision, When the clock runs out, Then the branch that cannot cost anything is chosen", () => {
    const decision = decideTurnTimeoutAction([
      promptAction("training-course", ["enroll", "decline"]),
    ]);

    expect(decision).toMatchObject({ optionId: "decline", unclassified: false });
  });

  it("Given a prompt kind with no classified safe option, When the clock runs out, Then an offered option is taken and flagged", () => {
    // Deadlock is worse than an imperfect auto-choice — there is no command that
    // can pass a prompt — so the choice is made and reported loudly instead.
    const decision = decideTurnTimeoutAction([
      promptAction("board-election", ["nominate-self", "abstain-with-fee"]),
    ]);

    expect(decision).toEqual({
      kind: "respond",
      decisionPointId: "decision-1",
      optionId: "nominate-self",
      promptKind: "board-election",
      unclassified: true,
    });
  });

  it("Given a prompt is open, When both actions are somehow offered, Then the prompt wins", () => {
    expect(
      decideTurnTimeoutAction([rollAction, promptAction("audit-release", ["attempt-roll"])]),
    ).toMatchObject({ kind: "respond" });
  });

  it.each([
    ["no legal actions at all", [] as readonly LegalAction[]],
    ["a prompt offering nothing", [promptAction("audit-release", [])]],
    ["only a game.start action", [{ ...base, type: "game.start", payload: {} } as LegalAction]],
  ])(
    "Given %s, When the clock runs out, Then nothing is done on the player's behalf",
    (_label, legalActions) => {
      expect(decideTurnTimeoutAction(legalActions)).toEqual({ kind: "none" });
    },
  );
});
