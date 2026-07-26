import type { ModeRules } from "@office-ladder/content";

import type {
  GameState,
  IncomeStreamId,
  IncomeStreamState,
  PlayerId,
  PlayerState,
  ResourceId,
  ResourceState,
} from "../model";
import { createStableId } from "../model";

/**
 * The economy's shared primitives, and the income side of it.
 *
 * Layering, so the three economy modules stay acyclic: this file is the bottom.
 * `loans.ts` imports it; `upkeep.ts` imports both and owns the per-round
 * settlement that ties them together. Nothing here imports either of those.
 *
 * Every function is pure: same inputs, same outputs, no clock, no randomness, no
 * mutation of its arguments. Rounds come from `GameState.turn.round`, which is
 * canonical state rather than a wall clock (spec §7.1).
 */

/** A player's money resource together with the key it is filed under. */
export type MoneyHandle = {
  readonly key: string;
  readonly resource: ResourceState;
};

/**
 * The money resource, found by `kind` rather than by key.
 *
 * Setup happens to file it under the key `"money"`, but the key is content's
 * choice and `ResourceState.kind` is the contract — the same lookup
 * `roll-promotion.ts` and `roll-salary.ts` already do.
 */
export function findMoney(player: PlayerState): MoneyHandle | null {
  const found = Object.entries(player.resources).find(
    ([, resource]) => resource.kind === "resource.money",
  );
  if (found === undefined) return null;

  return { key: found[0], resource: found[1] };
}

/**
 * Why money moved. Carried through to the `ResourceChanged` event's `reason`, so
 * a read model folding the event log can tell an upkeep charge apart from a loan
 * drawdown without inspecting anything else.
 */
export type EconomyChangeReason =
  | "income-stream"
  | "upkeep"
  | "loan-principal"
  | "loan-repayment";

/**
 * One money movement, shaped exactly like a `ResourceChangedEvent` payload so a
 * caller can spread it into an event without re-deriving anything.
 *
 * These are returned rather than emitted because the economy modules are pure
 * state functions: the transition that calls them owns event sequencing.
 */
export type EconomyResourceChange = {
  readonly playerId: PlayerId;
  readonly resourceId: ResourceId;
  readonly previousValue: number;
  readonly newValue: number;
  readonly reason: EconomyChangeReason;
};

export type MoneyMovement = {
  readonly player: PlayerState;
  /** `null` when the value did not actually move — no change, no event. */
  readonly change: EconomyResourceChange | null;
  /** Signed, after clamping: what the player's balance really moved by. */
  readonly applied: number;
};

function clampToBounds(resource: ResourceState, value: number): number {
  const floor = resource.minimum ?? Number.NEGATIVE_INFINITY;
  const ceiling = resource.maximum ?? Number.POSITIVE_INFINITY;

  return Math.min(Math.max(value, floor), ceiling);
}

/**
 * How much of `resource` is actually spendable — the distance down to its floor,
 * never below it. Money's floor is 0 in every authored mode, so this is normally
 * just the balance; reading `minimum` rather than assuming zero means a mode that
 * allows an overdraft gets one for free.
 */
export function spendableMoney(money: MoneyHandle): number {
  const floor = money.resource.minimum ?? Number.NEGATIVE_INFINITY;
  if (floor === Number.NEGATIVE_INFINITY) return Number.POSITIVE_INFINITY;

  return Math.max(0, money.resource.value - floor);
}

/**
 * Moves a player's money by `delta`, clamped to the resource's own bounds.
 *
 * Returns `change: null` when the clamped value equals the current one, which
 * keeps the engine's existing "no value changed, no event" rule (the tile-effect
 * walk and the promotion charge both follow it) without the caller having to
 * check.
 */
export function moveMoney(
  player: PlayerState,
  delta: number,
  reason: EconomyChangeReason,
): MoneyMovement {
  const money = findMoney(player);
  if (money === null || delta === 0) {
    return { player, change: null, applied: 0 };
  }

  const previousValue = money.resource.value;
  const newValue = clampToBounds(money.resource, previousValue + delta);
  if (newValue === previousValue) {
    return { player, change: null, applied: 0 };
  }

  return {
    player: {
      ...player,
      resources: {
        ...player.resources,
        [money.key]: { ...money.resource, value: newValue },
      },
    },
    change: {
      playerId: player.id,
      resourceId: money.resource.id,
      previousValue,
      newValue,
      reason,
    },
    applied: newValue - previousValue,
  };
}

/**
 * Whether any part of the economy is switched on for this match.
 *
 * The per-round settlement is a whole no-op when this is false, which is what
 * keeps the Quick preset (upkeep, loans and income all off) byte-identical to
 * the pre-economy engine — including `upkeep.lastChargedRound`, which the
 * settlement otherwise advances.
 */
export function economyActive(rules: ModeRules): boolean {
  const { economy } = rules;

  return (
    economy.upkeepEnabled || economy.loansEnabled || economy.incomeStreamsEnabled
  );
}

/**
 * A stream to grant. The id is derived by the engine rather than supplied,
 * because an id chosen by a caller is an id a client could choose.
 */
export type IncomeStreamGrant = {
  readonly kind: IncomeStreamState["kind"];
  readonly perRound: number;
  /** `null` never expires on its own. */
  readonly remainingRounds: number | null;
  readonly sourceId: string | null;
};

/**
 * A deterministic, replay-identical id for a new income stream.
 *
 * `revision` is the game's own monotonic counter and the array length
 * disambiguates several grants inside one command, so the pair is unique for the
 * life of the match and re-derives identically on replay. Nothing the client
 * sends is in here — see `ephemeral-random.ts` for why that matters.
 */
export function incomeStreamId(
  state: GameState,
  player: PlayerState,
): IncomeStreamId {
  return createStableId(
    "IncomeStreamId",
    `${state.gameId}:income:${player.id}:${state.revision}:${player.incomeStreams.length}`,
  );
}

/**
 * Adds an income stream, honouring `economy.incomeStreamsEnabled`.
 *
 * A mode with income off silently grants nothing rather than banking a stream
 * that would never pay: the alternative leaves dead state in the snapshot that
 * starts paying the moment somebody flips the flag on a custom mode.
 */
export function grantIncomeStream(
  state: GameState,
  player: PlayerState,
  grant: IncomeStreamGrant,
): PlayerState {
  if (!state.rules.economy.incomeStreamsEnabled) return player;
  if (!Number.isFinite(grant.perRound) || grant.perRound <= 0) return player;
  if (grant.remainingRounds !== null && grant.remainingRounds <= 0) return player;

  const stream: IncomeStreamState = {
    id: incomeStreamId(state, player),
    kind: grant.kind,
    perRound: Math.trunc(grant.perRound),
    remainingRounds:
      grant.remainingRounds === null ? null : Math.trunc(grant.remainingRounds),
    sourceId: grant.sourceId,
  };

  return { ...player, incomeStreams: [...player.incomeStreams, stream] };
}

/** Removes every stream sourced from `sourceId` — a sold tile, a failed project. */
export function revokeIncomeStreams(
  player: PlayerState,
  sourceId: string,
): PlayerState {
  const remaining = player.incomeStreams.filter(
    (stream) => stream.sourceId !== sourceId,
  );
  if (remaining.length === player.incomeStreams.length) return player;

  return { ...player, incomeStreams: remaining };
}

/** What this player's streams pay per round right now, before any of them expire. */
export function incomePerRound(player: PlayerState, rules: ModeRules): number {
  if (!rules.economy.incomeStreamsEnabled) return 0;

  return player.incomeStreams.reduce(
    (total, stream) =>
      stream.remainingRounds !== null && stream.remainingRounds <= 0
        ? total
        : total + Math.max(0, stream.perRound),
    0,
  );
}

export type IncomeSettlement = {
  readonly player: PlayerState;
  readonly credited: number;
  readonly change: EconomyResourceChange | null;
  readonly expiredStreamIds: readonly IncomeStreamId[];
};

/**
 * Pays out one round of income and ages the streams that pay it.
 *
 * Streams are walked in array order, which is a real ordering that survives the
 * repository's JSON round trip — unlike record-key order, which is not a stable
 * contract (spec §10.1 says the same thing about derived targets).
 */
export function settleIncomeStreams(
  player: PlayerState,
  rules: ModeRules,
): IncomeSettlement {
  if (!rules.economy.incomeStreamsEnabled || player.incomeStreams.length === 0) {
    return { player, credited: 0, change: null, expiredStreamIds: [] };
  }

  let credited = 0;
  const expiredStreamIds: IncomeStreamId[] = [];
  const remaining: IncomeStreamState[] = [];

  for (const stream of player.incomeStreams) {
    if (stream.remainingRounds !== null && stream.remainingRounds <= 0) {
      expiredStreamIds.push(stream.id);
      continue;
    }

    credited += Math.max(0, stream.perRound);
    const nextRemaining =
      stream.remainingRounds === null ? null : stream.remainingRounds - 1;
    if (nextRemaining !== null && nextRemaining <= 0) {
      expiredStreamIds.push(stream.id);
      continue;
    }

    remaining.push({ ...stream, remainingRounds: nextRemaining });
  }

  const aged: PlayerState = { ...player, incomeStreams: remaining };
  const movement = moveMoney(aged, credited, "income-stream");

  return {
    player: movement.player,
    credited: movement.applied,
    change: movement.change,
    expiredStreamIds,
  };
}
