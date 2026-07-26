import { expect } from "vitest";

import { deadlineDashContent } from "@office-ladder/content";

import {
  deserializeGameState,
  serializeGameState,
  stableStringify,
} from "../src";
import type {
  CommandId,
  GameState,
  PlayerId,
  PlayerState,
  RankId,
  ResourceId,
  ResourceState,
  RoleKind,
  TransitionResult,
  TransitionValue,
} from "../src";
import { createCanonicalGameState, fixtureIds } from "./fixtures";
import { logicalTimestamp, withRules, type RulesOverrides } from "./turn-loop-fixtures";

export const branded = <Id extends string>(value: string) => value as Id;

export const agencyIds = fixtureIds;

export function agencyContext(timestamp = logicalTimestamp) {
  return { logicalTimestamp: timestamp, content: deadlineDashContent };
}

export type SeatOverrides = {
  readonly money?: number;
  readonly reputation?: number;
  readonly energy?: number;
  readonly energyMaximum?: number;
  readonly workCounter?: number;
  readonly characterId?: string;
  readonly position?: number;
  readonly rankKind?: PlayerState["rank"]["kind"];
  readonly rankIndex?: number;
  readonly lapsCompleted?: number;
  readonly inAudit?: boolean;
  readonly skipTurns?: number;
  readonly role?: RoleKind;
  readonly roleRevealed?: boolean;
  readonly upkeepPerRound?: number;
};

function resource(
  playerId: string,
  key: string,
  kind: ResourceState["kind"],
  value: number,
  maximum: number | null,
): ResourceState {
  return {
    id: branded<ResourceId>(`${playerId}:resource:${key}`),
    kind,
    value,
    minimum: 0,
    maximum,
  };
}

function seat(base: PlayerState, overrides: SeatOverrides): PlayerState {
  const rankKind = overrides.rankKind ?? "rank.intern";

  return {
    ...base,
    position: overrides.position ?? 0,
    lapsCompleted: overrides.lapsCompleted ?? 0,
    characterId: branded(overrides.characterId ?? base.characterId),
    rank: {
      id: branded<RankId>(rankKind),
      kind: rankKind,
      index: overrides.rankIndex ?? 0,
    },
    role: {
      ...base.role,
      kind: overrides.role ?? base.role.kind,
      revealed: overrides.roleRevealed ?? false,
    },
    resources: {
      money: resource(base.id, "money", "resource.money", overrides.money ?? 1000, null),
      reputation: resource(
        base.id,
        "reputation",
        "resource.reputation",
        overrides.reputation ?? 2,
        null,
      ),
      energy: resource(
        base.id,
        "energy",
        "resource.energy",
        overrides.energy ?? 5,
        overrides.energyMaximum ?? 5,
      ),
      "work-counter": resource(
        base.id,
        "work-counter",
        "resource.work-counter",
        overrides.workCounter ?? 0,
        null,
      ),
    },
    statuses: [],
    abilities: [],
    hand: [],
    skipTurns: overrides.skipTurns ?? 0,
    inAudit: overrides.inAudit ?? false,
    negativeEffectsIgnoredThisLap: 0,
    upkeep: { ...base.upkeep, perRound: overrides.upkeepPerRound ?? 0 },
  };
}

export type AgencyStateOptions = {
  readonly rules?: RulesOverrides;
  readonly owner?: SeatOverrides;
  readonly opponent?: SeatOverrides;
  readonly bystander?: SeatOverrides;
};

/**
 * A three-seat, mid-match, pre-roll state with every resource the agency
 * commands touch, no open prompts, and nothing else in flight.
 *
 * It starts from the canonical fixture so every v2 field the model has gained
 * is present and correctly shaped, then normalises the three seats: the shipped
 * fixture deliberately parks one opponent in audit confinement with a skipped
 * turn, which would silently change the turn hand-off in half the assertions
 * here.
 */
export function agencyState(options: AgencyStateOptions = {}): GameState {
  const base = createCanonicalGameState();
  const owner = base.players[agencyIds.owner];
  const opponent = base.players[agencyIds.hiddenOpponent];
  const bystander = base.players[agencyIds.revealedOpponent];
  if (owner === undefined || opponent === undefined || bystander === undefined) {
    throw new Error("canonical fixture is missing a seat");
  }

  const state: GameState = {
    ...base,
    status: "active",
    boardSize: deadlineDashContent.board.spaces.length,
    tileIds: deadlineDashContent.board.spaces.map((tile) =>
      branded<GameState["tileIds"][number]>(tile.id),
    ),
    turn: {
      number: 4,
      round: 2,
      activePlayerId: agencyIds.owner,
      phase: "pre-roll",
      startedAt: logicalTimestamp,
      deadlineAt: null,
    },
    players: {
      [agencyIds.owner]: seat(owner, options.owner ?? {}),
      [agencyIds.hiddenOpponent]: seat(opponent, {
        position: 10,
        role: "role.management",
        ...(options.opponent ?? {}),
      }),
      [agencyIds.revealedOpponent]: seat(bystander, {
        position: 20,
        role: "role.worker",
        ...(options.bystander ?? {}),
      }),
    },
    // The seats above are dealt empty hands, so the canonical fixture's
    // hand-zone cards would be orphaned — and `serializeGameState` refuses a
    // state whose cards are not referenced by their declared zone.
    cards: Object.fromEntries(
      Object.entries(base.cards).filter(([, card]) => card.zone !== "hand"),
    ),
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    resolutionStack: [],
    outcome: null,
    lastCommandId: null,
  };

  return options.rules === undefined ? state : withRules(state, options.rules);
}

export function commandBase(
  state: GameState,
  commandId: string,
  actorId: PlayerId = agencyIds.owner,
) {
  return {
    commandId: branded<CommandId>(commandId),
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
  };
}

export function accepted(result: TransitionResult): TransitionValue {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value;
}

export function rejected(result: TransitionResult, code: string): void {
  expect(result).toEqual(
    expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code }),
    }),
  );
}

export function resourceValue(
  state: GameState,
  playerId: PlayerId,
  key: string,
): number {
  const value = state.players[playerId]?.resources[key]?.value;
  if (value === undefined) throw new Error(`missing resource ${key}`);

  return value;
}

/**
 * Every state this wave produces has to survive the repository's jsonb
 * boundary unchanged — a pending pip adjustment, a spent cooldown or a
 * per-turn action counter that does not round-trip is a mechanic that resets
 * whenever the room is resumed.
 */
export function expectRoundTrips(state: GameState): void {
  const restored = deserializeGameState(serializeGameState(state));
  expect(restored).toEqual(state);
  expect(stableStringify(restored)).toBe(stableStringify(state));
}
