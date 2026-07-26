import { afterEach, describe, expect, it, vi } from "vitest";

import { deadlineDashModes } from "@office-ladder/content";
import {
  deserializeGameState,
  GAME_STATE_SCHEMA_VERSION,
  serializeGameState,
  type GameState,
} from "@office-ladder/engine";
import { fromRoomSnapshot } from "../../src/rooms/room-snapshot";
import {
  V1_PLAYER_IDS,
  V1_ROOM_REVISION,
  V1_ROOM_SNAPSHOT,
} from "./fixtures/v1-room-snapshot";

/**
 * Gameplay v2 adds ten required collections to `GameState` and four to every
 * `PlayerState` (plans/24-gameplay-v2-spec.md §5.9, §5.3, §5.4), and bumps
 * `versions.stateSchemaVersion`. Every row already in
 * `room_projections.projection` has none of them, and `deserializeGameState`
 * does not degrade — it throws. Without the migration in
 * rooms/room-snapshot.ts, every existing room becomes permanently unopenable:
 * `fromRoomSnapshot` returns null, which callers surface as ROOM_NOT_FOUND.
 *
 * The fixture these tests load is **captured, not generated** — see
 * `fixtures/v1-room-snapshot.ts`. A fixture built by calling today's
 * `createGame` would acquire every new field for free and would therefore
 * assert nothing at all, which is the specific way this test could look green
 * while production stayed broken.
 */

const QUICK_RULES = deadlineDashModes["mode.quick"].rules;
const MARATHON_RULES = deadlineDashModes["mode.marathon"].rules;

/**
 * The version the fixture was written at, which is a fact about the fixture and
 * not a knob. Kept separate from the engine's own
 * `GAME_STATE_SCHEMA_VERSION` so the two can be asserted to differ — if they
 * ever coincide, this file is no longer testing a migration.
 */
const V1_STATE_SCHEMA_VERSION = 1;

/** Every collection spec §5.9 adds to `GameState`, with its empty value. */
const EMPTY_V2_COLLECTIONS = {
  tileOwnership: {},
  placements: [],
  projects: [],
  agreements: [],
  objectives: [],
  ballots: [],
  quarters: [],
  eliminatedPlayerIds: [],
} as const;

/**
 * Reads through the jsonb boundary rather than handing the literal over
 * directly: `JSON.parse(JSON.stringify(...))` is exactly what a Postgres jsonb
 * column does to a snapshot, and it is also what guarantees a test cannot
 * accidentally share a reference with the frozen fixture.
 */
function readRoom(snapshot: unknown, revision: number = V1_ROOM_REVISION) {
  return fromRoomSnapshot(JSON.parse(JSON.stringify(snapshot)) as unknown, revision);
}

function openedGame(snapshot: unknown = V1_ROOM_SNAPSHOT): GameState {
  const room = readRoom(snapshot);
  if (room === null) {
    throw new Error(
      "the snapshot did not open at all — a pre-v2 row must still be readable",
    );
  }
  if (room.game === null) {
    throw new Error("the snapshot opened without its canonical game");
  }
  return room.game;
}

/** The migration declining and the unreadable path both log. */
function silenceLogs(): void {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a pre-v2 stored game, read by a v2 build", () => {
  it("Given the frozen v1 fixture, When the engine is handed it unmigrated, Then it is refused — so the migration is the only reason the room opens", () => {
    // Three halves, all load-bearing. The fixture is genuinely behind the engine;
    // the engine genuinely refuses it, so nothing else in the read path could
    // have rescued it; and the reader's ladder lands exactly on the version the
    // engine accepts. That last assertion is what couples this file to
    // room-snapshot.ts's STATE_SCHEMA_MIGRATIONS: if the ladder ever stops one
    // rung short of the engine, every stored room reads back as null.
    expect(V1_ROOM_SNAPSHOT.game.versions.stateSchemaVersion).toBe(
      V1_STATE_SCHEMA_VERSION,
    );
    expect(GAME_STATE_SCHEMA_VERSION).toBeGreaterThan(V1_STATE_SCHEMA_VERSION);
    expect(() => deserializeGameState(JSON.stringify(V1_ROOM_SNAPSHOT.game))).toThrow(
      /stateSchemaVersion/,
    );

    expect(openedGame().versions.stateSchemaVersion).toBe(GAME_STATE_SCHEMA_VERSION);
  });

  it("Given the frozen v1 fixture, When the room is read, Then every collection §5.9 adds is present and empty and the quarter index is 0", () => {
    const game = openedGame();

    expect({
      tileOwnership: game.tileOwnership,
      placements: game.placements,
      projects: game.projects,
      agreements: game.agreements,
      objectives: game.objectives,
      ballots: game.ballots,
      quarters: game.quarters,
      eliminatedPlayerIds: game.eliminatedPlayerIds,
    }).toEqual(EMPTY_V2_COLLECTIONS);
    // Not "no quarter": a match that never had quarters is still inside the
    // first one, and nothing back-dates global events onto the rounds it
    // already played.
    expect(game.currentQuarterIndex).toBe(0);
  });

  it("Given the frozen v1 fixture, When the room is read, Then rules are backfilled from the mode preset its modeId names", () => {
    const game = openedGame();

    expect(game.rules).toEqual(QUICK_RULES);
    // The whole block, not a spot check: a partial backfill is what a mechanic
    // reading `rules.projects.deadlineRounds` would fault on.
    expect(game.rules.winShape).toBe("race");
    expect(game.rules.economy.upkeepEnabled).toBe(false);
  });

  it("Given a v1 state whose own modeId disagrees with the room column, When it is read, Then the state's mode decides its rules", () => {
    // A running match carries the mode it was actually started with; the room
    // column is only a fallback for a state that has no modeId at all.
    const game = openedGame({
      ...V1_ROOM_SNAPSHOT,
      modeId: "mode.quick",
      game: { ...V1_ROOM_SNAPSHOT.game, modeId: "mode.marathon" },
    });

    expect(game.rules).toEqual(MARATHON_RULES);
  });

  it("Given the frozen v1 fixture, When the room is read, Then every player gains upkeep, loans, income streams and heat", () => {
    const game = openedGame();

    for (const playerId of V1_PLAYER_IDS) {
      const player = game.players[playerId];
      expect(player).toBeDefined();
      expect(player?.loans).toEqual([]);
      expect(player?.incomeStreams).toEqual([]);
      expect(player?.upkeep).toEqual({
        // mode.quick has upkeep switched off, so the charge is 0 by config.
        perRound: 0,
        // Charged from where the match actually is (round 2), not round 0: a
        // legacy game must not wake up owing arrears for every round it played
        // before upkeep existed.
        lastChargedRound: 2,
        missedPayments: 0,
      });
      expect(player?.heat).toEqual({
        value: 0,
        threshold: QUICK_RULES.conflict.heatThreshold,
        investigationsOpened: 0,
        lastIncrementedAtRound: null,
      });
    }
  });

  it("Given a stored player from before `negativeEffectsIgnoredThisLap` existed, When the room is read, Then the counter is defaulted instead of the room becoming unopenable", () => {
    // Found on the live database, not reasoned about: two rooms in
    // `room_projections` could not be opened at all — `deserializeGameState`
    // rejected them with "negativeEffectsIgnoredThisLap must be an integer
    // greater than or equal to 0" — while every test here stayed green. The
    // fixture cannot catch this by itself because that field was added *while
    // the schema version stayed at 1*, so the capture already has it and
    // "stateSchemaVersion: 1" in fact covers several real shapes. Stripping it
    // is what reproduces the oldest of them.
    const strippedPlayers: Record<string, Record<string, unknown>> = {};
    for (const [playerId, player] of Object.entries(V1_ROOM_SNAPSHOT.game.players)) {
      const fields: Record<string, unknown> = { ...player };
      delete fields["negativeEffectsIgnoredThisLap"];
      strippedPlayers[playerId] = fields;
    }
    const stripped = {
      ...V1_ROOM_SNAPSHOT,
      game: { ...V1_ROOM_SNAPSHOT.game, players: strippedPlayers },
    };
    for (const player of Object.values(strippedPlayers)) {
      expect(player).not.toHaveProperty("negativeEffectsIgnoredThisLap");
    }

    const game = openedGame(stripped);

    for (const playerId of V1_PLAYER_IDS) {
      // Zero, not "carry on where they left off": zero is also what completing a
      // lap resets the counter to, so the player starts their current lap with
      // the whole allowance rather than an invented spend.
      expect(game.players[playerId]?.negativeEffectsIgnoredThisLap).toBe(0);
    }
    // And a value that *is* stored still wins — the step stays additive.
    const spent = {
      ...stripped,
      game: {
        ...stripped.game,
        players: {
          ...strippedPlayers,
          "user-v1-host": {
            ...strippedPlayers["user-v1-host"],
            negativeEffectsIgnoredThisLap: 2,
          },
        },
      },
    };
    expect(openedGame(spent).players["user-v1-host"]?.negativeEffectsIgnoredThisLap).toBe(2);
  });

  it("Given a v1 marathon state with a promoted player, When it is read, Then upkeep is read off the rank ladder and heat off the mode's threshold", () => {
    // mode.quick zeroes both tunables, so on that preset "read from config" and
    // "hardcoded 0" are indistinguishable. A mode that switches them on is what
    // proves the values come from `ModeRules` at all.
    const promoted = {
      ...V1_ROOM_SNAPSHOT,
      modeId: "mode.marathon",
      game: {
        ...V1_ROOM_SNAPSHOT.game,
        modeId: "mode.marathon",
        players: {
          ...V1_ROOM_SNAPSHOT.game.players,
          "user-v1-second": {
            ...V1_ROOM_SNAPSHOT.game.players["user-v1-second"],
            rank: { id: "rank.supervisor", kind: "rank.supervisor", index: 3 },
          },
        },
      },
    };

    const game = openedGame(promoted);

    const ladder = MARATHON_RULES.economy.upkeepByRankIndex;
    // Expectations are derived from the preset, not transcribed from it: the
    // ladder is an unplaytested first-pass tuning and will move. What must hold
    // is that the charge is looked up *by rank index* — asserted by the two
    // players landing on different entries, which a flat or index-0-only lookup
    // could not produce.
    expect(MARATHON_RULES.economy.upkeepEnabled).toBe(true);
    expect(ladder[3]).not.toBe(ladder[0]);
    expect(game.players["user-v1-second"]?.upkeep.perRound).toBe(ladder[3]);
    // Still an intern, so still the bottom of the same ladder.
    expect(game.players["user-v1-host"]?.upkeep.perRound).toBe(ladder[0]);
    expect(game.players["user-v1-host"]?.heat.threshold).toBe(
      MARATHON_RULES.conflict.heatThreshold,
    );
    expect(MARATHON_RULES.conflict.heatThreshold).toBeGreaterThan(0);
  });

  it("Given the frozen v1 fixture, When the room is read, Then the migration is purely additive and everything it did carry survives", () => {
    const room = readRoom(V1_ROOM_SNAPSHOT);
    const game = openedGame();
    const storedGame = V1_ROOM_SNAPSHOT.game;

    expect(game.gameId).toBe(storedGame.gameId);
    expect(game.revision).toBe(storedGame.revision);
    expect(game.eventSequence).toBe(storedGame.eventSequence);
    expect(game.status).toBe("active");
    expect(game.turn).toEqual(storedGame.turn);
    // The RNG cursor in particular: a replay is only deterministic if the
    // migration leaves the stream exactly where the match left it.
    expect(game.rng).toEqual(storedGame.rng);
    expect(game.tileIds).toEqual(storedGame.tileIds);
    expect(game.playerOrder).toEqual(storedGame.playerOrder);
    expect(game.lastCommandId).toBe(storedGame.lastCommandId);

    const host = game.players["user-v1-host"];
    expect(host?.position).toBe(10);
    expect(host?.resources).toEqual(storedGame.players["user-v1-host"].resources);
    expect(host?.tokens).toEqual(storedGame.players["user-v1-host"].tokens);
    expect(host?.characterId).toBe("character.workaholic");

    // And the room envelope around it.
    expect(room?.revision).toBe(V1_ROOM_REVISION);
    expect(room?.memberIds).toEqual([...V1_PLAYER_IDS]);
    expect(room?.eventSummaries).toHaveLength(V1_ROOM_SNAPSHOT.eventSummaries.length);
    expect(room?.turnTimer).toEqual(V1_ROOM_SNAPSHOT.turnTimer);
  });

  it("Given the frozen v1 fixture, When the room is read, Then the migrated state passes the engine's own invariant checks", () => {
    const game = openedGame();

    // serializeGameState runs assertJsonCompatible plus the full assertGameState
    // invariant walk, so this is the engine's verdict rather than this test's:
    // a backfill that produced an `undefined`, a non-finite number or a shape
    // assertGameState rejects fails here.
    expect(() => serializeGameState(game)).not.toThrow();
    expect(deserializeGameState(serializeGameState(game))).toEqual(game);
  });

  it("Given a v1 match that had already ended, When it is read, Then the outcome gains an empty breakdown and only a win path it can actually know", () => {
    const withOutcome = (reason: string): unknown => ({
      ...V1_ROOM_SNAPSHOT,
      game: {
        ...V1_ROOM_SNAPSHOT.game,
        status: "ended",
        outcome: {
          reason,
          winnerPlayerIds: ["user-v1-host"],
          winningRole: null,
          endedAt: "2026-07-20T12:05:00.000Z",
          data: {},
        },
      },
    });

    // Reaching Director *is* the promotion path, so filling it in is a rename,
    // not an inference.
    expect(openedGame(withOutcome("director-reached")).outcome).toEqual({
      reason: "director-reached",
      winnerPlayerIds: ["user-v1-host"],
      winningRole: null,
      endedAt: "2026-07-20T12:05:00.000Z",
      data: {},
      scores: [],
      winPath: "promotion",
    });

    const scored = openedGame(withOutcome("marathon-scored")).outcome;
    // Which path a scored win came down is exactly what the missing breakdown
    // would have said, so it stays null rather than being guessed. And `scores`
    // stays empty rather than being fabricated for a winner screen.
    expect(scored?.winPath).toBeNull();
    expect(scored?.scores).toEqual([]);
  });

  it("Given a v1 state whose modeId no content pack knows, When it is read, Then rules still resolve instead of the room becoming unreadable", () => {
    const game = openedGame({
      ...V1_ROOM_SNAPSHOT,
      modeId: "mode.from-a-future-build",
      game: { ...V1_ROOM_SNAPSHOT.game, modeId: "mode.also-unknown" },
    });

    // Same choice normalizeMode already makes for the room's own column, for the
    // same reason: a room whose rules could not be resolved is a room nothing
    // can ever open.
    expect(game.rules).toEqual(QUICK_RULES);
  });

  it("Given a v1 state with no versions block at all, When it is read, Then it is refused rather than half-migrated", () => {
    silenceLogs();

    // The upgrade is attempted (an unreadable version is assumed to be the
    // oldest), but a state missing engineVersion/rulesetId/contentHash is not
    // something this reader can invent values for, so the engine's own
    // validation has the last word and the row survives untouched for a repair.
    expect(
      readRoom({
        ...V1_ROOM_SNAPSHOT,
        game: { ...V1_ROOM_SNAPSHOT.game, versions: {} },
      }),
    ).toBeNull();
  });

  it("Given a stored snapshot read twice, When the first read migrates it, Then the stored object was not mutated", () => {
    // Deliberately not through readRoom's clone: InMemoryRoomRepository hands
    // fromRoomSnapshot the very object it is holding, so a migration that
    // mutated in place would silently rewrite the stored row on first read.
    const before = JSON.stringify(V1_ROOM_SNAPSHOT);

    const first = fromRoomSnapshot(V1_ROOM_SNAPSHOT, V1_ROOM_REVISION);
    const second = fromRoomSnapshot(V1_ROOM_SNAPSHOT, V1_ROOM_REVISION);

    expect(JSON.stringify(V1_ROOM_SNAPSHOT)).toBe(before);
    expect("rules" in V1_ROOM_SNAPSHOT.game).toBe(false);
    expect(second?.game).toEqual(first?.game);
  });
});

describe("a v2 stored game, read by the same build that wrote it", () => {
  it("Given a v2 snapshot, When it is read, Then it round-trips unchanged instead of being migrated again", () => {
    const v2Game: GameState = {
      ...openedGame(),
      // Every value here is one a re-run of the v1 upgrade would overwrite, so
      // deep equality below is a real assertion about the version gate and not
      // just about JSON round-tripping.
      rules: MARATHON_RULES,
      currentQuarterIndex: 2,
      quarters: [
        {
          index: 0,
          startedAtRound: 1,
          endsAtRound: 4,
          scheduledEventId: null,
          resolvedEventIds: [],
        },
        {
          index: 1,
          startedAtRound: 5,
          endsAtRound: 8,
          scheduledEventId: "globalEvent.audit-season",
          resolvedEventIds: ["globalEvent.audit-season"],
        },
        {
          index: 2,
          startedAtRound: 9,
          endsAtRound: 12,
          scheduledEventId: null,
          resolvedEventIds: [],
        },
      ],
    };

    // The room column still says mode.quick: if the ladder ran again it would
    // resolve quick's preset and overwrite marathon's frozen rules, which is
    // exactly the bug that would silently reset a live v2 match's ruleset on
    // every read.
    const room = readRoom({ ...V1_ROOM_SNAPSHOT, modeId: "mode.quick", game: v2Game });

    expect(room?.game).toEqual(v2Game);
    expect(room?.game?.rules).toEqual(MARATHON_RULES);
    expect(room?.game?.currentQuarterIndex).toBe(2);
    expect(room?.game?.quarters).toHaveLength(3);
    expect(room?.game?.versions.stateSchemaVersion).toBe(GAME_STATE_SCHEMA_VERSION);
  });

  it("Given a v2 snapshot with occupied collections, When it is read, Then nothing is reset to empty", () => {
    const base = openedGame();
    const v2Game: GameState = {
      ...base,
      eliminatedPlayerIds: [],
      tileOwnership: {
        [base.tileIds[3] ?? "tile.board.unknown"]: {
          tileId: base.tileIds[3] ?? "tile.board.unknown",
          ownerId: base.playerOrder[0]!,
          level: 1,
          claimedAtRound: 2,
          tollPaidCount: 4,
        },
      },
    };

    const room = readRoom({ ...V1_ROOM_SNAPSHOT, game: v2Game });

    expect(room?.game?.tileOwnership).toEqual(v2Game.tileOwnership);
  });
});
