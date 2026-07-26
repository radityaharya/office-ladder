import { describe, expect, it } from "vitest";

import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";
import type { ModeRules } from "@office-ladder/content";

import {
  createDeadlineDashGame,
  createGame,
  createStableId,
  GAME_STATE_SCHEMA_VERSION,
  serializeGameState,
  type SetupContent,
} from "../src";

const playerIds = [
  createStableId("PlayerId", "player-alex"),
  createStableId("PlayerId", "player-blair"),
  createStableId("PlayerId", "player-casey"),
] as const;

const baseSetup = {
  gameId: createStableId("GameId", "game.v2-state"),
  modeId: createStableId("ModeId", "mode.quick"),
  players: [
    {
      id: playerIds[0],
      order: 0,
      characterId: createStableId("CharacterId", "character.workaholic"),
      role: { id: createStableId("RoleId", "role.alex"), kind: "role.worker" as const },
    },
    {
      id: playerIds[1],
      order: 1,
      characterId: createStableId("CharacterId", "character.social-butterfly"),
      role: {
        id: createStableId("RoleId", "role.blair"),
        kind: "role.management" as const,
      },
    },
    {
      id: playerIds[2],
      order: 2,
      characterId: createStableId("CharacterId", "character.sales-star"),
      role: { id: createStableId("RoleId", "role.casey"), kind: "role.worker" as const },
    },
  ],
  authorizedStarterId: playerIds[0],
} as const;

const modeSetup = (modeId: string) => ({
  ...baseSetup,
  modeId: createStableId("ModeId", modeId),
});

/**
 * The shipped content pack with one mode's ruleset swapped out.
 *
 * Setup reads its enablement and its tunables from `ModeRules` and nothing else,
 * so the only way to prove that — rather than proving that the Standard preset
 * happens to contain the numbers asserted below — is to hand it a ruleset the
 * content pack does not ship.
 */
function contentWithRules(overrides: Partial<ModeRules>): SetupContent {
  const quick = deadlineDashModes["mode.quick"];

  return {
    ...deadlineDashContent,
    modes: {
      ...deadlineDashContent.modes,
      "mode.quick": { ...quick, rules: { ...quick.rules, ...overrides } },
    },
  };
}

describe("gameplay v2 canonical state at creation", () => {
  it("Given a new game, When it is created, Then it declares the v2 state schema version", () => {
    const result = createDeadlineDashGame(baseSetup, "schema-version");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.versions.stateSchemaVersion).toBe(GAME_STATE_SCHEMA_VERSION);
    expect(GAME_STATE_SCHEMA_VERSION).toBeGreaterThan(1);
  });

  it("Given a new game, When it is created, Then every shared-space collection starts empty", () => {
    const result = createDeadlineDashGame(baseSetup, "empty-collections");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.tileOwnership).toEqual({});
    expect(result.value.placements).toEqual([]);
    expect(result.value.projects).toEqual([]);
    expect(result.value.agreements).toEqual([]);
    expect(result.value.objectives).toEqual([]);
    expect(result.value.ballots).toEqual([]);
    expect(result.value.eliminatedPlayerIds).toEqual([]);
    expect(result.value.currentQuarterIndex).toBe(0);
  });

  /**
   * The whole point of snapshotting: a match must replay identically after the
   * content pack changes, which is only true if the state holds its own copy.
   * Reference equality is the observable difference between a snapshot and a
   * shortcut, so it is what gets asserted.
   */
  it("Given a mode preset, When a game is created, Then rules are copied into the state rather than referenced", () => {
    const result = createDeadlineDashGame(modeSetup("mode.standard"), "snapshot");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const preset = deadlineDashModes["mode.standard"].rules;
    expect(result.value.rules).toEqual(preset);
    expect(result.value.rules).not.toBe(preset);
    expect(result.value.rules.economy).not.toBe(preset.economy);
    expect(result.value.rules.economy.upkeepByRankIndex).not.toBe(
      preset.economy.upkeepByRankIndex,
    );
  });

  it("Given quarters disabled, When a game is created, Then no quarter schedule is laid out", () => {
    const result = createDeadlineDashGame(baseSetup, "no-quarters");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.rules.quarters.enabled).toBe(false);
    expect(result.value.quarters).toEqual([]);
  });

  it("Given quarters enabled, When a game is created, Then the schedule covers contiguous 1-based rounds", () => {
    const result = createGame(
      baseSetup,
      "quarters",
      contentWithRules({
        quarters: { enabled: true, count: 3, roundsEach: 5, globalEvents: true },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.quarters).toEqual([
      {
        index: 0,
        startedAtRound: 1,
        endsAtRound: 5,
        scheduledEventId: null,
        resolvedEventIds: [],
      },
      {
        index: 1,
        startedAtRound: 6,
        endsAtRound: 10,
        scheduledEventId: null,
        resolvedEventIds: [],
      },
      {
        index: 2,
        startedAtRound: 11,
        endsAtRound: 15,
        scheduledEventId: null,
        resolvedEventIds: [],
      },
    ]);
  });

  it("Given upkeep enabled, When a game is created, Then each player's charge comes off the rank ladder", () => {
    const quick = deadlineDashModes["mode.quick"].rules;
    const result = createGame(
      baseSetup,
      "upkeep",
      contentWithRules({
        economy: {
          ...quick.economy,
          upkeepEnabled: true,
          upkeepByRankIndex: [42, 99, 99, 99, 99, 99, 99, 99, 99],
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const playerId of playerIds) {
      expect(result.value.players[playerId].upkeep).toEqual({
        perRound: 42,
        lastChargedRound: 0,
        missedPayments: 0,
      });
    }
  });

  it("Given upkeep disabled, When a game is created, Then nobody is charged even though the ladder has values", () => {
    const quick = deadlineDashModes["mode.quick"].rules;
    const result = createGame(
      baseSetup,
      "upkeep-off",
      contentWithRules({
        economy: {
          ...quick.economy,
          upkeepEnabled: false,
          upkeepByRankIndex: [42, 99, 99, 99, 99, 99, 99, 99, 99],
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.players[playerIds[0]].upkeep.perRound).toBe(0);
  });

  it("Given a mode's heat threshold, When a game is created, Then each player's heat starts at zero against it", () => {
    const result = createDeadlineDashGame(modeSetup("mode.standard"), "heat");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const threshold = deadlineDashModes["mode.standard"].rules.conflict.heatThreshold;
    for (const playerId of playerIds) {
      expect(result.value.players[playerId].heat).toEqual({
        value: 0,
        threshold,
        investigationsOpened: 0,
        lastIncrementedAtRound: null,
      });
      expect(result.value.players[playerId].loans).toEqual([]);
      expect(result.value.players[playerId].incomeStreams).toEqual([]);
    }
  });

  it("Given a ruleset with no win path enabled, When a game is created, Then setup is rejected as unwinnable", () => {
    const result = createGame(
      baseSetup,
      "unwinnable",
      contentWithRules({
        winPaths: {
          promotion: false,
          wealth: false,
          influence: false,
          survival: false,
        },
      }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_MODE_RULES" } });
  });

  it("Given quarters enabled with a zero count, When a game is created, Then setup is rejected", () => {
    const result = createGame(
      baseSetup,
      "empty-quarters",
      contentWithRules({
        quarters: { enabled: true, count: 0, roundsEach: 4, globalEvents: false },
      }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_MODE_RULES" } });
  });

  it("Given upkeep enabled with a ladder shorter than the rank list, When a game is created, Then setup is rejected", () => {
    const quick = deadlineDashModes["mode.quick"].rules;
    const result = createGame(
      baseSetup,
      "short-ladder",
      contentWithRules({
        economy: { ...quick.economy, upkeepEnabled: true, upkeepByRankIndex: [0, 50] },
      }),
    );

    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_MODE_RULES" } });
  });

  it("Given every shipped preset, When a game is created, Then the state passes the engine's own serialization contract", () => {
    for (const modeId of Object.keys(deadlineDashModes)) {
      const result = createGame(modeSetup(modeId), "serializable", deadlineDashContent);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(() => serializeGameState(result.value)).not.toThrow();
    }
  });
});
