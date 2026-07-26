import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";

import type {
  GameState,
  ModeRules,
  PlayerId,
  PlayerState,
  QuarterState,
  ResourceState,
} from "../src";
import { createCanonicalGameState, fixtureIds } from "./fixtures";

const branded = <Id extends string>(value: string) => value as Id;

export const standardRules: ModeRules = deadlineDashModes["mode.standard"].rules;
export const quickRules: ModeRules = deadlineDashModes["mode.quick"].rules;
export const campaignRules: ModeRules = deadlineDashModes["mode.campaign"].rules;
export const marathonRules: ModeRules = deadlineDashModes["mode.marathon"].rules;

export const content = deadlineDashContent;

export type Wallet = {
  readonly money?: number;
  readonly reputation?: number;
  readonly energy?: number;
  readonly workCounter?: number;
};

/**
 * A full resource set for one seat.
 *
 * The base fixture deliberately gives two of its three players no resources at
 * all, which is right for a projection test and useless for a scoring one: every
 * column here is read from a resource, so a table that is being scored needs all
 * four on every seat.
 */
export function wallet(playerId: PlayerId, values: Wallet = {}): Readonly<Record<string, ResourceState>> {
  const resource = (
    key: "money" | "reputation" | "energy" | "work-counter",
    kind: ResourceState["kind"],
    value: number,
    maximum: number | null,
  ): ResourceState => ({
    id: branded(`${playerId}:resource:${key}`),
    kind,
    value,
    minimum: 0,
    maximum,
  });

  return {
    money: resource("money", "resource.money", values.money ?? 1000, null),
    reputation: resource("reputation", "resource.reputation", values.reputation ?? 0, null),
    energy: resource("energy", "resource.energy", values.energy ?? 5, 5),
    "work-counter": resource(
      "work-counter",
      "resource.work-counter",
      values.workCounter ?? 0,
      null,
    ),
  };
}

/**
 * The quarter schedule a ruleset implies, laid out exactly the way `createGame`
 * lays it out — 1-based rounds, contiguous, nothing announced yet.
 */
export function quartersFor(rules: ModeRules): readonly QuarterState[] {
  if (!rules.quarters.enabled) return [];

  return Array.from({ length: rules.quarters.count }, (_, index) => ({
    index,
    startedAtRound: index * rules.quarters.roundsEach + 1,
    endsAtRound: (index + 1) * rules.quarters.roundsEach,
    scheduledEventId: null,
    resolvedEventIds: [],
  }));
}

export type SeatOverrides = {
  readonly wallet?: Wallet;
  readonly rankIndex?: number;
  readonly rankKind?: PlayerState["rank"]["kind"];
  readonly heat?: number;
  readonly lapsCompleted?: number;
  readonly missedPayments?: number;
};

/**
 * A three-seat table under `rules`, with a real quarter schedule, real wallets,
 * and none of the base fixture's in-flight prompts or reaction windows.
 *
 * Built from `createCanonicalGameState` rather than from scratch so it keeps
 * every id and shape the rest of the suite already agrees on.
 */
export function tableState(
  rules: ModeRules = standardRules,
  seats: Partial<Record<PlayerId, SeatOverrides>> = {},
): GameState {
  const base = createCanonicalGameState();
  const seatIds: readonly PlayerId[] = [
    fixtureIds.owner,
    fixtureIds.hiddenOpponent,
    fixtureIds.revealedOpponent,
  ];

  const players = Object.fromEntries(
    seatIds.map((playerId, index) => {
      const player = base.players[playerId];
      const overrides = seats[playerId] ?? {};

      return [
        playerId,
        {
          ...player,
          order: index,
          rank: {
            id: branded(overrides.rankKind ?? "rank.intern"),
            kind: overrides.rankKind ?? "rank.intern",
            index: overrides.rankIndex ?? 0,
          },
          resources: wallet(playerId, overrides.wallet),
          statuses: [],
          skipTurns: 0,
          inAudit: false,
          lapsCompleted: overrides.lapsCompleted ?? 0,
          upkeep: {
            perRound: rules.economy.upkeepEnabled
              ? (rules.economy.upkeepByRankIndex[overrides.rankIndex ?? 0] ?? 0)
              : 0,
            lastChargedRound: 0,
            missedPayments: overrides.missedPayments ?? 0,
          },
          loans: [],
          incomeStreams: [],
          heat: {
            value: overrides.heat ?? 0,
            threshold: rules.conflict.heatThreshold,
            investigationsOpened: 0,
            lastIncrementedAtRound: null,
          },
        } satisfies PlayerState,
      ];
    }),
  );

  return {
    ...base,
    modeId: branded("mode.standard"),
    rules,
    status: "active",
    players,
    playerOrder: seatIds,
    turn: { ...base.turn, round: 1, phase: "pre-roll", activePlayerId: fixtureIds.owner },
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    resolutionStack: [],
    objectives: [],
    projects: [],
    tileOwnership: {},
    quarters: quartersFor(rules),
    currentQuarterIndex: 0,
    rng: {
      streams: {
        dice: { algorithm: "xorshift32", version: "1", state: "305419896", cursor: 3 },
        setup: { algorithm: "xorshift32", version: "1", state: "2654435769", cursor: 0 },
      },
    },
  };
}

/** The repository's own persistence boundary, which every state has to survive. */
export function jsonRoundTrip(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/**
 * Recursively freezes a value, so a transition that mutates its input throws
 * rather than passing quietly. Same trick as `purity-replay.test.ts`.
 */
export function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreeze(inner, seen);
  }

  return Object.freeze(value);
}
