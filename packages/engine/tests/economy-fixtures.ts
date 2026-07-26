import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";

import type {
  GameState,
  IncomeStreamId,
  IncomeStreamState,
  LoanId,
  LoanState,
  ModeRules,
  PlayerId,
  PlayerState,
  RankId,
  ResourceId,
  ResourceState,
} from "../src";
import { createCanonicalGameState, fixtureIds } from "./fixtures";
import { withRules, type RulesOverrides } from "./turn-loop-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

/**
 * The Standard preset is the economy's home ruleset: upkeep, loans and income
 * all on, `promotionRaisesUpkeep` on, `bankruptcy: "demote"`. Tests that are
 * about a *different* setting flip exactly that one with `withRules`, so what a
 * test is actually asserting stays visible in the test.
 */
export const economyRules: ModeRules = deadlineDashModes["mode.standard"].rules;

export const economyContent = deadlineDashContent;

export const economyIds = fixtureIds;

/** The rank ladder's tiers are 1-based, so index i is the rank of tier i + 1. */
export function rankAtIndex(index: number): { readonly id: RankId; readonly kind: PlayerState["rank"]["kind"]; readonly index: number } {
  const rank = deadlineDashContent.ranks.find((candidate) => candidate.tier === index + 1);
  if (rank === undefined) throw new Error(`no authored rank at index ${index}`);

  return { id: brand<RankId>(rank.id), kind: rank.id as PlayerState["rank"]["kind"], index };
}

function moneyResource(playerId: PlayerId, value: number): ResourceState {
  return {
    id: brand<ResourceId>(`resource-${playerId}-money`),
    kind: "resource.money",
    value,
    minimum: 0,
    maximum: null,
  };
}

export function loan(
  id: string,
  overrides: Partial<LoanState> = {},
): LoanState {
  return {
    id: brand<LoanId>(id),
    principal: 1000,
    outstanding: 1000,
    interestBasisPoints: 1000,
    takenAtRound: 1,
    ...overrides,
  };
}

export function incomeStream(
  id: string,
  overrides: Partial<IncomeStreamState> = {},
): IncomeStreamState {
  return {
    id: brand<IncomeStreamId>(id),
    kind: "rent",
    perRound: 40,
    remainingRounds: null,
    sourceId: null,
    ...overrides,
  };
}

export type PlayerEconomy = {
  readonly money?: number;
  readonly rankIndex?: number;
  readonly perRound?: number;
  readonly lastChargedRound?: number;
  readonly missedPayments?: number;
  readonly loans?: readonly LoanState[];
  readonly incomeStreams?: readonly IncomeStreamState[];
};

export type EconomyStateOptions = {
  readonly rules?: RulesOverrides;
  readonly round?: number;
  readonly activePlayerId?: PlayerId;
  readonly eliminatedPlayerIds?: readonly PlayerId[];
  readonly players?: Partial<Record<PlayerId, PlayerEconomy>>;
};

/**
 * A live three-seat game under the Standard ruleset, with every seat holding a
 * real money resource.
 *
 * The base canonical fixture deliberately gives two of its three players no
 * resources at all (it exists to test projection redaction), which is not a table
 * an economy can be settled against — a player with no money resource is a
 * different edge case, and it gets its own test rather than being the default.
 */
export function economyState(options: EconomyStateOptions = {}): GameState {
  const base = createCanonicalGameState();
  const round = options.round ?? 1;

  const players: Record<string, PlayerState> = {};
  for (const playerId of base.playerOrder) {
    const seat = base.players[playerId];
    if (seat === undefined) continue;
    const economy = options.players?.[playerId] ?? {};
    const rank = rankAtIndex(economy.rankIndex ?? seat.rank.index);

    players[playerId] = {
      ...seat,
      rank,
      skipTurns: 0,
      inAudit: false,
      statuses: [],
      resources: {
        ...seat.resources,
        money: moneyResource(playerId, economy.money ?? 1000),
      },
      upkeep: {
        perRound: economy.perRound ?? 0,
        /**
         * Settled through the *previous* round by default, so settling the
         * current one charges exactly one round. A test about the catch-up path
         * sets this explicitly and says so.
         */
        lastChargedRound: economy.lastChargedRound ?? round - 1,
        missedPayments: economy.missedPayments ?? 0,
      },
      loans: economy.loans ?? [],
      incomeStreams: economy.incomeStreams ?? [],
    };
  }

  const state: GameState = {
    ...base,
    rules: economyRules,
    status: "active",
    quarters: [],
    currentQuarterIndex: 0,
    eliminatedPlayerIds: options.eliminatedPlayerIds ?? [],
    players,
    prompts: [],
    pendingEffects: [],
    reactionWindows: [],
    resolutionStack: [],
    turn: {
      ...base.turn,
      number: round,
      round,
      activePlayerId: options.activePlayerId ?? fixtureIds.owner,
      phase: "pre-roll",
    },
    lastCommandId: null,
  };

  return options.rules === undefined ? state : withRules(state, options.rules);
}

/**
 * Recursively freezes a value. Every engine module is an ES module and therefore
 * strict-mode code, so a write to a frozen object throws rather than failing
 * silently — which is what turns "the economy never mutates its inputs" into
 * something a test can observe. Lifted from `purity-replay.test.ts`.
 */
export function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreeze(inner, seen);
  }

  return Object.freeze(value);
}
