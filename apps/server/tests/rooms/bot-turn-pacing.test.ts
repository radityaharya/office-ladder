import { describe, expect, it } from "vitest";

import { createStableId, enumerateLegalActions, type PlayerId } from "@office-ladder/engine";
import { createBotDriver, type BotDriver } from "../../src/rooms/bots/bot-driver";
import { botSeatFor } from "../../src/rooms/bots/bot-seats";
import {
  DEFAULT_BOT_TURN_DELAY_MS,
  MAXIMUM_BOT_TURN_DELAY_MS,
  parseBotTurnDelayMs,
} from "../../src/rooms/bots/turn-delay";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import type { BotCommandSubmitter } from "../../src/rooms/bots/bot-command-submitter";
import { botSubmitterFor } from "./bot-submitter";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService, StoredRoom } from "../../src/rooms/service/types";
import {
  createTurnTimeoutDriver,
  type TurnTimeoutDriver,
  type TurnTimeoutDriverEvent,
  type TurnTimeoutStop,
} from "../../src/rooms/turn-timer/turn-timeout-driver";

/**
 * Whether a bot's pacing pause is actually *spent*, and what it costs.
 *
 * The delay being configured is not the same as the delay being honoured, and the
 * thing that has to be honoured is not the sleep call — it is the timestamp a
 * client receives. A committed `turn.roll` is atomic: the roll, the move, every
 * resource change, any card draw and the hand-off are one batch of event
 * summaries stamped with a single `occurredAt` (the room service's `now()` at
 * commit time). So "the bots are followable" reduces to a property of the
 * projection: *consecutive turns must not share an instant*, and the gap between
 * them must be the configured pause. That is what these tests assert, from the
 * stored room rather than from the driver's own bookkeeping.
 *
 * Everything runs on a virtual clock: the injected `sleep` advances `now()` by the
 * pause instead of spending it, so the spacing assertions are exact to the
 * millisecond and the suite stays instant. The counterpart test with the pause
 * switched off is what proves those assertions bite rather than measuring the
 * harness.
 *
 * The clock half is here too, because the two interact in a way that is easy to
 * get wrong: raising the bot pause must not eat into a human's turn budget.
 */

const host = createStableId("PlayerId", "user-host");
const roomId = "room-bot-pacing-test";
const START_MS = Date.parse("2026-07-26T12:00:00.000Z");

/** Who committed, when (on the virtual clock), and against which game revision. */
type Commit = {
  readonly source: "bot-driver" | "timeout-driver" | "human";
  readonly actorId: PlayerId;
  readonly atMs: number;
  readonly expectedRevision: number | undefined;
};

type Hooks = {
  /** Runs while a bot is paused, before the command it is waiting to commit. */
  onBotPause: ((pausedMs: number) => Promise<void>) | null;
};

type Harness = {
  readonly botDriver: BotDriver;
  readonly timeoutDriver: TurnTimeoutDriver;
  /** A real player request, distinct from either driver's service instance. */
  readonly humanService: RoomService;
  readonly commits: readonly Commit[];
  /** Refusal codes, tagged with their source. */
  readonly refusals: readonly string[];
  /** Every pause the driver actually took, in order. */
  readonly sleeps: readonly number[];
  readonly timeoutEvents: readonly TurnTimeoutDriverEvent[];
  readonly hooks: Hooks;
  readonly nowMs: () => number;
  readonly advanceMs: (ms: number) => void;
  readonly room: () => Promise<StoredRoom>;
  /** Rolls (or answers a prompt) for the host, as a real player request would. */
  readonly humanTurn: () => Promise<void>;
};

type StartOptions = {
  readonly delayMs: number;
  /** `0` (the default here) leaves the turn clock switched off. */
  readonly turnTimeoutMs?: number;
  /** Production wiring is `true`: a timeout pass drains the bots before settling. */
  readonly handOffToBots?: boolean;
};

/** One human host plus two bots — the smallest match the engine will start. */
async function startSoloMatch(options: StartOptions): Promise<Harness> {
  const repository = new InMemoryRoomRepository();
  const commits: Commit[] = [];
  const refusals: string[] = [];
  const sleeps: number[] = [];
  const timeoutEvents: TurnTimeoutDriverEvent[] = [];
  const hooks: Hooks = { onBotPause: null };
  const turnTimeoutMs = options.turnTimeoutMs ?? 0;

  let nowMs = START_MS;
  const now = (): string => new Date(nowMs).toISOString();

  const service = createRoomService({
    repository,
    now,
    ids: {
      roomId: () => roomId,
      roomCode: () => "PAC456",
      gameId: () => createStableId("GameId", "game-bot-pacing-test"),
      commandId: () => createStableId("CommandId", "command-bot-pacing-test"),
    },
    gameSeed: () => "bot-pacing-seed",
    turnTimeoutMs,
  });

  /**
   * One service instance behind all three actors, exactly as production has it:
   * rooms/default-service.ts exports a single `roomService`, and both
   * bots/default-driver.ts and turn-timer/default-driver.ts import that same
   * object — so both server-side actors queue on the same per-room lock.
   */
  const observed = (source: Commit["source"]): RoomService => ({
    ...service,
    async roll(input) {
      const result = await service.roll(input);
      if (result.ok) {
        commits.push({
          source,
          actorId: createStableId("PlayerId", input.actorId),
          atMs: nowMs,
          expectedRevision: input.expectedRevision,
        });
      } else refusals.push(`${source}:${result.error.code}`);
      return result;
    },
    async respondToPrompt(input) {
      const result = await service.respondToPrompt(input);
      if (result.ok) {
        commits.push({
          source,
          actorId: createStableId("PlayerId", input.actorId),
          atMs: nowMs,
          expectedRevision: input.expectedRevision,
        });
      } else refusals.push(`${source}:${result.error.code}`);
      return result;
    },
  });

  /**
   * The bot is observed at its transport, not at the room service.
   *
   * A bot turn is no longer one `turn.roll`: it may promote, take a free action
   * or steer the roll first, and only the roll would reach `roll()`. Recording
   * at the service would therefore miss most of a chain — and every assertion in
   * this file is "one pause per committed bot command", which is a statement
   * about all of them.
   */
  const submit = botSubmitterFor(service, repository, { now, turnTimeoutMs });
  const observedSubmit: BotCommandSubmitter = async (submission) => {
    const result = await submit(submission);
    if (result.ok) {
      commits.push({
        source: "bot-driver",
        actorId: submission.actorId,
        atMs: nowMs,
        expectedRevision: submission.expectedRevision,
      });
    } else refusals.push(`bot-driver:${result.error.code}`);
    return result;
  };

  const botDriver = createBotDriver({
    submit: observedSubmit,
    repository,
    configuredDelayMs: options.delayMs,
    sleep: async (ms) => {
      sleeps.push(ms);
      nowMs += ms;
      const hook = hooks.onBotPause;
      if (hook !== null) await hook(ms);
    },
    publish: async () => undefined,
    onEvent: () => undefined,
  });

  const timeoutDriver = createTurnTimeoutDriver({
    roomService: observed("timeout-driver"),
    repository,
    now,
    timeoutMs: turnTimeoutMs,
    publish: async () => undefined,
    // Production wiring: the timeout pass awaits the bot drain, so a turn handed
    // to a bot by the clock is still paced, and the next human's deadline is armed
    // only once the bots have finished.
    driveBots: async (kicked) => {
      if (options.handOffToBots === false) return;
      await botDriver.drive(kicked);
    },
    setTimer: () => () => undefined,
    onEvent: (event) => timeoutEvents.push(event),
  });

  const readRoom = async (): Promise<StoredRoom> => {
    const room = await repository.get(roomId);
    if (room === null) throw new Error("room vanished");
    return room;
  };

  await service.create({
    hostId: host,
    playerName: "Host",
    modeId: "mode.quick",
    capacity: 3,
  });
  await service.addBot({ roomId, actorId: host, difficulty: "standard" });
  await service.addBot({ roomId, actorId: host, difficulty: "easy" });
  expect(await service.start({ roomId, actorId: host, actorKind: "human" })).toMatchObject({
    ok: true,
    value: { status: "active" },
  });

  const humanService = observed("human");

  return {
    botDriver,
    timeoutDriver,
    humanService,
    commits,
    refusals,
    sleeps,
    timeoutEvents,
    hooks,
    nowMs: () => nowMs,
    advanceMs: (ms) => {
      nowMs += ms;
    },
    room: readRoom,
    async humanTurn() {
      const room = await readRoom();
      const game = room.game;
      if (game === null) throw new Error("game vanished");
      expect(game.turn.activePlayerId).toBe(host);

      const legalActions = enumerateLegalActions(game, host);
      const prompt = legalActions.find((action) => action.type === "prompt.respond");
      if (prompt !== undefined && prompt.type === "prompt.respond") {
        const optionId = prompt.options[0];
        if (optionId === undefined) throw new Error("human prompt offered no options");
        expect(
          await humanService.respondToPrompt({
            roomId,
            actorId: host,
            actorKind: "human",
            commandId: `human:${game.revision}`,
            expectedRevision: prompt.expectedRevision,
            decisionPointId: String(prompt.decisionPointId),
            optionId: String(optionId),
          }),
        ).toMatchObject({ ok: true });
        return;
      }

      const roll = legalActions.find((action) => action.type === "turn.roll");
      if (roll === undefined) throw new Error("human has no legal action");
      expect(
        await humanService.roll({
          roomId,
          actorId: host,
          actorKind: "human",
          commandId: `human:${game.revision}`,
          expectedRevision: roll.expectedRevision,
        }),
      ).toMatchObject({ ok: true });
    },
  };
}

/** The ordered, distinct instants a run of committed turns reached clients at. */
function turnInstantsMs(summaries: readonly { readonly occurredAt: string }[]): number[] {
  return [...new Set(summaries.map((summary) => summary.occurredAt))].map((stamp) =>
    Date.parse(stamp),
  );
}

function lastTimeoutStop(events: readonly TurnTimeoutDriverEvent[]): TurnTimeoutStop | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "turn-timeout.pass.finished") return event.stop;
  }
  return null;
}

describe("bot turn pacing, as clients receive it", () => {
  it("Given a configured pause, When a chain of bot turns commits, Then each turn reaches clients a full pause after the last", async () => {
    const delayMs = 1_500;
    const harness = await startSoloMatch({ delayMs });
    const beforeHuman = (await harness.room()).eventSummaries.length;
    const humanAtMs = harness.nowMs();

    await harness.humanTurn();
    await harness.botDriver.drive(roomId);

    const summaries = (await harness.room()).eventSummaries.slice(beforeHuman);
    // Several events per committed turn is the whole reason the client needs a
    // presentation queue at all — and the reason this pause, not the commit, is
    // what separates one turn from the next.
    expect(summaries.length).toBeGreaterThan(harness.commits.length);

    const instants = turnInstantsMs(summaries);
    // One instant per committed command: no two turns share an `occurredAt`.
    expect(instants.length).toBe(harness.commits.length);
    expect(instants[0]).toBe(humanAtMs);
    for (let index = 1; index < instants.length; index += 1) {
      expect((instants[index] ?? 0) - (instants[index - 1] ?? 0)).toBe(delayMs);
    }
    expect(harness.refusals).toEqual([]);
  });

  it("Given the pause switched off, When the same chain commits, Then every turn lands in one instant — the burst the pause exists to remove", async () => {
    const harness = await startSoloMatch({ delayMs: 0 });
    const beforeHuman = (await harness.room()).eventSummaries.length;

    await harness.humanTurn();
    await harness.botDriver.drive(roomId);

    const summaries = (await harness.room()).eventSummaries.slice(beforeHuman);
    // This is what the spacing test above would look like if the delay were not
    // honoured, so it is also what makes that test meaningful rather than a
    // measurement of the harness's own clock arithmetic.
    expect(turnInstantsMs(summaries).length).toBe(1);
    expect(harness.commits.length).toBeGreaterThanOrEqual(3);
    // `0` is a supported configuration, not a broken one: nothing is refused and
    // the turn still comes back to the human.
    expect(harness.refusals).toEqual([]);
    expect((await harness.room()).game?.turn.activePlayerId).toBe(host);
  });

  it("Given the human has just acted, When the first bot of the chain takes its turn, Then it pauses first instead of committing into the same instant", async () => {
    const delayMs = 1_500;
    const harness = await startSoloMatch({ delayMs });

    await harness.humanTurn();
    const humanCommit = harness.commits.at(-1);
    expect(humanCommit?.source).toBe("human");

    await harness.botDriver.drive(roomId);

    // The pause is taken *before* each command, including the chain's first: the
    // separation between "my turn ended" and "the first opponent acted" is the
    // one a player most needs, and a delay placed after the commit would not
    // produce it.
    const firstBotCommit = harness.commits.find((commit) => commit.source === "bot-driver");
    expect(firstBotCommit?.atMs).toBe((humanCommit?.atMs ?? 0) + delayMs);

    // One pause per bot command, all of them the configured length: no command
    // slips through unpaced, and none is padded.
    const botCommits = harness.commits.filter((commit) => commit.source === "bot-driver");
    expect(botCommits.length).toBeGreaterThanOrEqual(2);
    expect(harness.sleeps.length).toBe(botCommits.length);
    expect(harness.sleeps.every((ms) => ms === delayMs)).toBe(true);

    // And the chain ends on a commit, not on a pause: the turn is the human's
    // again with no trailing dead air charged to them.
    expect(harness.commits.at(-1)?.source).toBe("bot-driver");
    expect(harness.nowMs()).toBe((humanCommit?.atMs ?? 0) + delayMs * botCommits.length);
  });

  it("Given a bot mid-pause, When a player request arrives, Then it is answered immediately rather than queued behind the pause", async () => {
    const harness = await startSoloMatch({ delayMs: 1_500 });
    await harness.humanTurn();

    const answers: string[] = [];
    harness.hooks.onBotPause = async () => {
      // Once: the first pause is enough to prove the lock is not held.
      harness.hooks.onBotPause = null;
      const game = (await harness.room()).game;
      if (game === null) throw new Error("game vanished");

      const pending = harness.humanService
        .roll({
          roomId,
          actorId: host,
          actorKind: "human",
          commandId: "human-during-bot-pause",
          expectedRevision: game.revision,
        })
        .then((result) => {
          answers.push(result.ok ? "ok" : result.error.code);
        });

      // Bounded microtask drain rather than an unbounded await: if the pause held
      // the room service's per-room lock this would fail with an empty `answers`
      // instead of hanging the suite until the runner's timeout.
      for (let tick = 0; tick < 200 && answers.length === 0; tick += 1) {
        await Promise.resolve();
      }
      expect(answers.length).toBe(1);
      await pending;
    };

    await harness.botDriver.drive(roomId);

    // The pause is taken outside `withRoomLock` (in the driver, not the service),
    // so a request that arrives during it gets a real answer at once. Out of turn,
    // so a refusal is the correct answer — the point is that it is *an* answer.
    expect(answers).toHaveLength(1);
    expect(answers[0]).not.toBe("ok");
    // And the bot's own turn was unaffected by the interloper.
    expect((await harness.room()).game?.turn.activePlayerId).toBe(host);
  });
});

describe("bot pacing against the turn clock", () => {
  it("Given bot pauses that outlast the turn clock, When the chain hands back, Then the human's deadline starts when their turn does", async () => {
    // Two bots at 1.5s each is 3s of pausing — longer than the whole turn budget.
    // If the clock were armed for the human before the chain, or measured from
    // before it, their turn would be taken from them before they ever saw it.
    const turnTimeoutMs = 2_000;
    const delayMs = 1_500;
    const harness = await startSoloMatch({ delayMs, turnTimeoutMs });
    await harness.humanTurn();

    harness.hooks.onBotPause = async () => {
      const room = await harness.room();
      const activePlayerId = room.game?.turn.activePlayerId ?? null;
      expect(activePlayerId).not.toBeNull();
      if (activePlayerId === null) return;
      // A bot holds the turn for the whole chain, and a bot is never on the clock,
      // so there is no deadline for these pauses to burn through.
      expect(botSeatFor(room, activePlayerId)).not.toBeNull();
      expect(room.turnTimer).toBeNull();
    };

    await harness.botDriver.drive(roomId);

    const room = await harness.room();
    expect(room.game?.turn.activePlayerId).toBe(host);
    const timer = room.turnTimer;
    expect(timer).not.toBeNull();
    if (timer === null) return;
    expect(timer.playerId).toBe(host);
    // The full budget, measured from now — not eroded by the 3s the bots spent.
    expect(Date.parse(timer.deadlineAt) - harness.nowMs()).toBe(turnTimeoutMs);

    // The enforcement half agrees: a pass right now waits, rather than taking a
    // turn the player has not yet had a chance to play.
    await harness.timeoutDriver.drive(roomId);
    expect(harness.commits.filter((commit) => commit.source === "timeout-driver")).toEqual([]);
    const stop = lastTimeoutStop(harness.timeoutEvents);
    expect(stop?.kind).toBe("timer-pending");
    if (stop?.kind !== "timer-pending") return;
    expect(stop.remainingMs).toBe(turnTimeoutMs);
  });

  it("Given a human turn that times out, When the pass hands off to paced bots, Then exactly one command lands per turn and the bots are still paced", async () => {
    const turnTimeoutMs = 2_000;
    const delayMs = 1_500;
    const harness = await startSoloMatch({ delayMs, turnTimeoutMs });

    // Past the host's deadline: the clock, not the player, ends this turn.
    harness.advanceMs(turnTimeoutMs);
    await harness.timeoutDriver.drive(roomId);

    const timeoutCommits = harness.commits.filter((commit) => commit.source === "timeout-driver");
    const botCommits = harness.commits.filter((commit) => commit.source === "bot-driver");
    expect(timeoutCommits).toHaveLength(1);
    expect(timeoutCommits[0]?.actorId).toBe(host);
    expect(botCommits.length).toBeGreaterThanOrEqual(2);

    const room = await harness.room();
    // Neither server actor ever committed for the other's kind of seat.
    for (const commit of harness.commits) {
      expect(botSeatFor(room, commit.actorId) !== null).toBe(commit.source === "bot-driver");
    }
    // One command per game revision. Two against one revision would be the clock
    // and a bot commit racing for the same turn.
    const revisions = harness.commits.map((commit) => commit.expectedRevision);
    expect(revisions.every((revision) => revision !== undefined)).toBe(true);
    expect(new Set(revisions).size).toBe(revisions.length);

    // The bots stayed paced *inside* the timeout pass — a turn handed over by the
    // clock is no less watchable than one handed over by a player.
    expect(harness.sleeps.length).toBe(botCommits.length);
    expect(harness.sleeps.every((ms) => ms === delayMs)).toBe(true);
    const timeoutAtMs = timeoutCommits[0]?.atMs ?? 0;
    for (let index = 0; index < botCommits.length; index += 1) {
      expect(botCommits[index]?.atMs).toBe(timeoutAtMs + delayMs * (index + 1));
    }

    // …and the host's next deadline is the whole budget again, armed after the
    // paced chain rather than before it.
    expect(room.game?.turn.activePlayerId).toBe(host);
    const timer = room.turnTimer;
    expect(timer).not.toBeNull();
    if (timer === null) return;
    expect(Date.parse(timer.deadlineAt) - harness.nowMs()).toBe(turnTimeoutMs);
  });
});

describe("BOT_TURN_DELAY_MS", () => {
  it("Given the variable is unset, When it is read, Then the documented default applies rather than 'off'", () => {
    expect(parseBotTurnDelayMs(undefined)).toEqual({
      ok: true,
      delayMs: DEFAULT_BOT_TURN_DELAY_MS,
    });
    expect(parseBotTurnDelayMs("   ")).toEqual({
      ok: true,
      delayMs: DEFAULT_BOT_TURN_DELAY_MS,
    });
  });

  it("Given zero, When it is read, Then the pause is switched off as a first-class configuration", () => {
    expect(parseBotTurnDelayMs("0")).toEqual({ ok: true, delayMs: 0 });
  });

  it("Given a value inside the supported range, When it is read, Then it is honoured exactly", () => {
    expect(parseBotTurnDelayMs("1")).toEqual({ ok: true, delayMs: 1 });
    expect(parseBotTurnDelayMs(" 2400 ")).toEqual({ ok: true, delayMs: 2_400 });
    expect(parseBotTurnDelayMs(String(MAXIMUM_BOT_TURN_DELAY_MS))).toEqual({
      ok: true,
      delayMs: MAXIMUM_BOT_TURN_DELAY_MS,
    });
  });

  it("Given a runaway value, When it is read, Then it is clamped to the ceiling and reported, not sped back up to the default", () => {
    // A mistyped 15000 in a six-seat room is a 75-second room-wide stall taken
    // inside the drain slot. Clamping keeps the operator's *direction* (slower)
    // while bounding the damage; falling back to the default would silently undo
    // the change they came to make.
    expect(parseBotTurnDelayMs("15000")).toEqual({
      ok: false,
      error: { code: "INVALID_BOT_TURN_DELAY" },
      fallbackMs: MAXIMUM_BOT_TURN_DELAY_MS,
    });
  });

  it("Given an unusable value, When it is read, Then it is reported rather than silently treated as unset", () => {
    for (const configured of ["-1", "1.5", "fast", "1e400", "NaN", "900ms"]) {
      expect(parseBotTurnDelayMs(configured)).toEqual({
        ok: false,
        error: { code: "INVALID_BOT_TURN_DELAY" },
        fallbackMs: DEFAULT_BOT_TURN_DELAY_MS,
      });
    }
  });

  it("Given the client plays a committed turn out over about a second, When the default is read, Then it is long enough for a beat to exist between turns", () => {
    // The guard against this being quietly "optimised" back down. The client's
    // event presentation queue plays a committed turn's events at ~180-320ms
    // each, and a bot turn carries roughly 2-6 of them, so a typical turn takes
    // ~1.0-1.3s to render. A default below that band makes the queue — not this
    // value — the pacer, and the burst comes back with added latency. A default
    // far above it makes a full table a waiting room.
    expect(DEFAULT_BOT_TURN_DELAY_MS).toBeGreaterThanOrEqual(1_300);
    expect(DEFAULT_BOT_TURN_DELAY_MS).toBeLessThanOrEqual(2_000);
    expect(MAXIMUM_BOT_TURN_DELAY_MS).toBeGreaterThan(DEFAULT_BOT_TURN_DELAY_MS);
  });
});
