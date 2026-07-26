import { describe, expect, it } from "vitest";

import { createStableId, type GameState, type PlayerId } from "@office-ladder/engine";
import { createBotDriver, type BotDriver } from "../../src/rooms/bots/bot-driver";
import { botSeatFor } from "../../src/rooms/bots/bot-seats";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import type { BotCommandSubmitter } from "../../src/rooms/bots/bot-command-submitter";
import { botSubmitterFor } from "./bot-submitter";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type {
  RoomRepository,
  RoomService,
  RoomWriteResult,
  StoredRoom,
} from "../../src/rooms/service/types";
import {
  createTurnTimeoutDriver,
  type TurnTimeoutDriver,
} from "../../src/rooms/turn-timer/turn-timeout-driver";

/**
 * The two server-side actors, aimed at the same room at the same time.
 *
 * There are now three things that commit commands — the bot driver, the turn-clock
 * expiry, and real player requests — and the two drivers do **not** share a mutex.
 * Each builds its own `createRoomDrainScheduler`, so the per-room slot only
 * excludes a second pass of the *same* driver. Two independent mutexes over one
 * room is not mutual exclusion, so the safety has to come from somewhere else, and
 * these tests are about proving where:
 *
 * 1. **Disjoint predicates on freshly-read state.** The bot driver acts only when
 *    `botSeatFor(activePlayer)` is non-null; the clock is only ever armed for a
 *    player `playerOnTheClock` returns, which excludes bot seats. Both re-read the
 *    room immediately before deciding.
 * 2. **The engine's `expectedRevision`**, which is per *game* revision and so
 *    refuses the loser of any race outright.
 * 3. **The repository's revision predicate**, which is the only one of the three
 *    that survives a second server process.
 *
 * The room service's per-room lock is deliberately *not* on that list: it makes the
 * common single-process case avoid the conflict, but the timeout driver's own timer
 * write bypasses it entirely (it writes through the repository, not the service),
 * and a second instance has a different lock map. So every test here is also run
 * against two RoomService instances over one repository — two processes over one
 * database — where the lock provably cannot help.
 */

const players = {
  host: createStableId("PlayerId", "user-host"),
  second: createStableId("PlayerId", "user-second"),
} as const;

const roomId = "room-driver-interleaving-test";
const START_MS = Date.parse("2026-07-26T12:00:00.000Z");
const TIMEOUT_MS = 30_000;

/** Who committed, and for whom. The whole safety argument is about these pairs. */
type Commit = {
  readonly source: "bot-driver" | "timeout-driver" | "human";
  readonly actorId: PlayerId;
  /**
   * The command type. Was `"roll" | "respond"` when those were the only two a
   * bot could send; a bot turn is now a short chain (a promotion, a free action,
   * then the roll), and every link has to be counted or the revision-delta
   * assertions below stop meaning anything.
   */
  readonly kind: string;
  /** The game revision the command was applied against. */
  readonly expectedRevision: number | undefined;
};

type Harness = {
  readonly repository: InMemoryRoomRepository;
  readonly botDriver: BotDriver;
  readonly timeoutDriver: TurnTimeoutDriver;
  /** The third source of commands: an actual player request. */
  readonly humanService: RoomService;
  readonly commits: readonly Commit[];
  readonly refusals: readonly string[];
  readonly advanceMs: (ms: number) => void;
  readonly game: () => Promise<GameState>;
  readonly room: () => Promise<StoredRoom>;
};

function ids() {
  return {
    roomId: () => roomId,
    roomCode: () => "ILV123",
    gameId: () => createStableId("GameId", "game-driver-interleaving-test"),
    commandId: () => createStableId("CommandId", "command-driver-interleaving-test"),
  };
}

/**
 * A three-seat room — two humans and one bot — with both drivers live.
 *
 * Two humans and a bot is the mix that gives *both* drivers real work: the clock
 * is armed on the human turns and never on the bot's, so each driver's predicate
 * fires on a different seat while the other is also being kicked.
 *
 * @param processes 1 shares one RoomService (one server, one lock map); 2 gives
 * each driver its own service over the same repository, which is what a second
 * server instance actually looks like.
 */
async function startMatch(options: {
  readonly processes: 1 | 2;
  readonly repository?: RoomRepository;
  /**
   * Whether the timeout driver hands a bot turn to the bot driver, as it does in
   * production. Turning it off is the only way to *observe* a room sitting on a
   * bot's turn: with the hand-off on, a timeout pass never leaves one behind — it
   * drains the bots before it returns.
   */
  readonly handOffToBots?: boolean;
}): Promise<Harness> {
  const backing = new InMemoryRoomRepository();
  const repository = options.repository ?? backing;
  const commits: Commit[] = [];
  const refusals: string[] = [];
  let nowMs = START_MS;
  const now = (): string => new Date(nowMs).toISOString();

  const build = (): RoomService =>
    createRoomService({
      repository,
      now,
      ids: ids(),
      gameSeed: () => "driver-interleaving-seed",
      turnTimeoutMs: TIMEOUT_MS,
    });

  const setupService = build();
  const botService = options.processes === 1 ? setupService : build();
  const timeoutService = options.processes === 1 ? setupService : build();
  const playerService = options.processes === 1 ? setupService : build();

  /** Records every *committed* command, tagged with which actor produced it. */
  const observed = (service: RoomService, source: Commit["source"]): RoomService => ({
    ...service,
    async roll(input) {
      const result = await service.roll(input);
      if (result.ok) {
        commits.push({
          source,
          actorId: createStableId("PlayerId", input.actorId),
          kind: "roll",
          expectedRevision: input.expectedRevision,
        });
      } else refusals.push(`${source}:roll:${result.error.code}`);
      return result;
    },
    async respondToPrompt(input) {
      const result = await service.respondToPrompt(input);
      if (result.ok) {
        commits.push({
          source,
          actorId: createStableId("PlayerId", input.actorId),
          kind: "respond",
          expectedRevision: input.expectedRevision,
        });
      } else refusals.push(`${source}:respond:${result.error.code}`);
      return result;
    },
  });

  /**
   * The bot driver is observed at its *transport*, not at the room service.
   *
   * Only two of the twenty-eight commands a bot can send reach `roll()` or
   * `respondToPrompt()`, so wrapping the service would record part of a bot's
   * turn and miss the rest — and every assertion here is a count of committed
   * commands against a revision delta.
   */
  const botSubmit = botSubmitterFor(botService, repository, {
    now,
    turnTimeoutMs: TIMEOUT_MS,
  });
  const observedBotSubmit: BotCommandSubmitter = async (submission) => {
    const result = await botSubmit(submission);
    if (result.ok) {
      commits.push({
        source: "bot-driver",
        actorId: submission.actorId,
        kind: submission.command.type,
        expectedRevision: submission.expectedRevision,
      });
    } else refusals.push(`bot-driver:${submission.command.type}:${result.error.code}`);
    return result;
  };

  const botDriver = createBotDriver({
    submit: observedBotSubmit,
    repository,
    configuredDelayMs: 0,
    sleep: async () => undefined,
    publish: async () => undefined,
    onEvent: () => undefined,
  });

  const timeoutDriver = createTurnTimeoutDriver({
    roomService: observed(timeoutService, "timeout-driver"),
    repository,
    now,
    timeoutMs: TIMEOUT_MS,
    publish: async () => undefined,
    // Exactly the production wiring: the timeout driver awaits the bot driver's
    // `drive`, so a pass that hands the turn to a bot waits for the bots to finish
    // before arming the next human's clock. This is also the only place the two
    // drivers' slots are held at the same time, so a cycle here would deadlock.
    driveBots: async (kicked) => {
      if (options.handOffToBots === false) return;
      await botDriver.drive(kicked);
    },
    setTimer: () => () => undefined,
    onEvent: () => undefined,
  });

  await setupService.create({ hostId: players.host, playerName: "Host", modeId: "mode.quick" });
  await setupService.join({ roomId, actorId: players.second, playerName: "Second" });
  await setupService.addBot({ roomId, actorId: players.host, difficulty: "standard" });
  expect(
    await setupService.start({ roomId, actorId: players.host, actorKind: "human" }),
  ).toMatchObject({ ok: true });

  const readRoom = async (): Promise<StoredRoom> => {
    const room = await repository.get(roomId);
    if (room === null) throw new Error("room vanished");
    return room;
  };

  return {
    repository: backing,
    botDriver,
    timeoutDriver,
    humanService: observed(playerService, "human"),
    commits,
    refusals,
    advanceMs: (ms) => {
      nowMs += ms;
    },
    game: async () => {
      const game = (await readRoom()).game;
      if (game === null) throw new Error("game vanished");
      return game;
    },
    room: readRoom,
    ...{},
  };
}

/**
 * Runs the whole match with both drivers kicked concurrently on every cycle, the
 * clock always already expired. Nothing else moves the game, so every command is
 * one driver or the other acting on somebody's behalf.
 */
async function playByDriversAlone(harness: Harness, cycles = 600): Promise<number> {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const game = await harness.game();
    if (game.status !== "active") return cycle;
    // Past every human deadline, so the timeout driver always has work to do.
    harness.advanceMs(TIMEOUT_MS);
    await Promise.all([
      harness.botDriver.drive(roomId),
      harness.timeoutDriver.drive(roomId),
    ]);
  }
  return cycles;
}

/**
 * The same match, but with a real player request fired at the *same instant* as
 * both drivers, every cycle, for the seat whose clock has just run out.
 *
 * This is the interleaving that actually contends: the player and the timeout
 * driver both want to commit the identical command against the identical game
 * revision. Without it the two drivers mostly stay out of each other's way
 * (their predicates are disjoint), so nothing would exercise the write predicate.
 */
async function playWithPlayerRacing(harness: Harness, cycles = 600): Promise<number> {
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const room = await harness.room();
    const game = room.game;
    if (game === null) throw new Error("game vanished");
    if (game.status !== "active") return cycle;
    const activePlayerId = game.turn.activePlayerId;
    harness.advanceMs(TIMEOUT_MS);

    const racing: Promise<unknown>[] = [
      harness.botDriver.drive(roomId),
      harness.timeoutDriver.drive(roomId),
    ];
    // Only a human seat can produce a player request, and only a roll: a prompt
    // needs its decision point, which the drivers may have consumed by now.
    if (
      activePlayerId !== null &&
      botSeatFor(room, activePlayerId) === null &&
      game.prompts.length === 0
    ) {
      racing.push(
        harness.humanService.roll({
          roomId,
          actorId: activePlayerId,
          actorKind: "human",
          commandId: `player-${game.revision}`,
          expectedRevision: game.revision,
        }),
      );
    }
    await Promise.all(racing);
  }
  return cycles;
}

async function assertNoCrossedSeats(harness: Harness): Promise<void> {
  const room = await harness.room();
  for (const commit of harness.commits) {
    const isBotSeat = botSeatFor(room, commit.actorId) !== null;
    if (commit.source === "bot-driver") {
      // The bot driver acting for a human would be this server playing a real
      // player's turn for them with no clock having run out.
      expect(isBotSeat).toBe(true);
    } else if (commit.source === "human") {
      expect(isBotSeat).toBe(false);
    } else {
      // The clock is never armed for a bot seat, so enforcing one against a bot
      // would mean two actors racing for a single command with nothing to gain.
      expect(isBotSeat).toBe(false);
    }
  }
}

function assertNoTurnTakenTwice(harness: Harness): void {
  const revisions = harness.commits.map((commit) => commit.expectedRevision);
  expect(revisions.every((revision) => revision !== undefined)).toBe(true);
  // Two commits against one game revision is the definition of a double-apply:
  // one turn, two commands. The engine's expectedRevision is what forbids it, and
  // this is the assertion that would catch that guard being loosened.
  expect(new Set(revisions).size).toBe(revisions.length);
}

/**
 * Every test below plays out a whole match with two drivers contending, which is
 * tens of seconds of real work — one measured run of this file took 35,970ms.
 * Vitest's default is 5,000ms, so these were passing only when nothing else was
 * running and failing whenever the suite had company. That is not flakiness to
 * live with: it is a timeout an order of magnitude below the work, so which runs
 * go red is decided by machine load rather than by the code.
 *
 * Generous on purpose. The assertions here are about correctness under
 * contention, and the thing they must never do is fail for being slow — a red
 * that means "busy laptop" teaches the reader to ignore this file.
 */
const MATCH_TIMEOUT_MS = 120_000;

describe.each([
  ["one server process", 1 as const],
  ["two server processes over one database", 2 as const],
])("bot driver and turn clock interleaved: %s", (_label, processes) => {
  it("Given both drivers kicked on every cycle, When the match is played out, Then each only ever acts for its own kind of seat", async () => {
    const harness = await startMatch({ processes });
    const before = await harness.game();

    await playByDriversAlone(harness);

    await assertNoCrossedSeats(harness);
    // Both drivers must actually have committed something, or the disjointness
    // above would hold vacuously.
    expect(harness.commits.some((commit) => commit.source === "bot-driver")).toBe(true);
    expect(harness.commits.some((commit) => commit.source === "timeout-driver")).toBe(true);
    expect((await harness.game()).revision).toBeGreaterThan(before.revision);
  }, MATCH_TIMEOUT_MS);

  it("Given both drivers racing every turn, When commands commit, Then no turn is taken twice and none is lost", async () => {
    const harness = await startMatch({ processes });
    const before = await harness.game();

    await playByDriversAlone(harness);

    assertNoTurnTakenTwice(harness);
    // Every committed command advances the game by exactly one revision, so a
    // double-apply would make the count exceed the revision delta and a lost
    // command would make it fall short. This is the one assertion that covers
    // both failure modes at once.
    const after = await harness.game();
    expect(harness.commits).toHaveLength(after.revision - before.revision);
  }, MATCH_TIMEOUT_MS);

  it("Given a player request racing both drivers on every turn, When all three contend, Then exactly one command lands per turn", async () => {
    const harness = await startMatch({ processes });
    const before = await harness.game();

    await playWithPlayerRacing(harness);

    // The contention is real, not assumed: somebody has to have been refused.
    expect(harness.refusals.length).toBeGreaterThan(0);
    assertNoTurnTakenTwice(harness);
    await assertNoCrossedSeats(harness);
    // A lost update — two writers whose reads overlapped, one silently discarded
    // after being told it succeeded — is exactly a commit count above the revision
    // delta. Removing the repository's revision predicate makes this fail.
    const after = await harness.game();
    expect(harness.commits).toHaveLength(after.revision - before.revision);
    // And the loser was told, rather than being given a 200 over a turn nobody
    // took: every refusal carries a code.
    expect(harness.refusals.every((refusal) => refusal.split(":").length === 3)).toBe(true);
  }, MATCH_TIMEOUT_MS);

  it("Given both drivers driving the whole match, When nobody human ever acts, Then it terminates with a winner rather than stalling", async () => {
    const harness = await startMatch({ processes });

    const cycles = await playByDriversAlone(harness);

    const game = await harness.game();
    // Progress is the real anti-deadlock assertion: a wedged room, a livelock
    // between the two drivers, or a quiet stop with nobody left to revive it would
    // all show up as the loop burning every cycle with the match still active.
    expect(game.status).toBe("ended");
    expect(game.outcome?.winnerPlayerIds.length).toBeGreaterThan(0);
    expect(cycles).toBeLessThan(600);
    // The clock is cleared once nothing is left to enforce, so a finished match
    // cannot leave a deadline behind for a driver to act on.
    expect((await harness.room()).turnTimer).toBeNull();
  }, MATCH_TIMEOUT_MS);
});

describe("the timer write bypasses the service lock", () => {
  it("Given a timer write racing a bot's command, When the timer write wins, Then the bot's turn is retried rather than lost", async () => {
    // The timeout driver persists a deadline through the *repository*, not the room
    // service, so this write is the one mutation the per-room lock does not
    // serialize. It can therefore land between the bot driver's read and its
    // commit, bumping the room revision and making the bot's command lose the
    // repository predicate. Losing it must cost a retried pass, never the turn.
    const backing = new InMemoryRoomRepository();
    let interpose: (() => Promise<void>) | null = null;
    const racing: RoomRepository = {
      create: (room) => backing.create(room),
      getByCode: (code) => backing.getByCode(code),
      get: (id) => backing.get(id),
      async save(room, expectedRevision): Promise<RoomWriteResult> {
        const hook = interpose;
        interpose = null;
        // Fires once, while this write is "on the wire".
        if (hook !== null) await hook();
        return backing.save(room, expectedRevision);
      },
    };

    // Hand-off disabled so a bot turn is left standing for the bot driver to pick
    // up under the race, instead of being drained inside the timeout pass.
    const harness = await startMatch({
      processes: 2,
      repository: racing,
      handOffToBots: false,
    });
    // Get to a bot's turn: the timeout driver takes the humans' turns for us.
    for (let cycle = 0; cycle < 40; cycle += 1) {
      const room = await harness.room();
      const game = room.game;
      if (game === null) throw new Error("game vanished");
      const activePlayerId = game.turn.activePlayerId;
      if (activePlayerId !== null && botSeatFor(room, activePlayerId) !== null) break;
      harness.advanceMs(TIMEOUT_MS);
      await harness.timeoutDriver.drive(roomId);
    }
    const room = await harness.room();
    const activePlayerId = (await harness.game()).turn.activePlayerId;
    expect(activePlayerId).not.toBeNull();
    expect(activePlayerId === null ? null : botSeatFor(room, activePlayerId)).not.toBeNull();
    const before = await harness.game();

    // A bare timer write commits while the bot driver's own write is in flight.
    interpose = async () => {
      const current = await backing.get(roomId);
      if (current === null) throw new Error("room vanished");
      expect(
        await backing.save(
          { ...current, revision: current.revision + 1 },
          current.revision,
        ),
      ).toEqual({ ok: true });
    };
    await harness.botDriver.drive(roomId);

    // The bot's first attempt lost the predicate...
    expect(harness.refusals.some((refusal) => refusal.includes("STALE_REVISION"))).toBe(true);
    // ...and a later kick still gets the turn taken, which is the property that
    // matters: a lost race costs a pass, not a seat.
    await harness.botDriver.drive(roomId);
    expect((await harness.game()).revision).toBeGreaterThan(before.revision);
    await assertNoCrossedSeats(harness);
  }, MATCH_TIMEOUT_MS);
});
