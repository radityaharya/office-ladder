import type { EffectDescriptor } from "@office-ladder/content";

import type { PlayerState, PlayerStatusState } from "../model";
import { createStableId } from "../model";

export function findActiveStatus(
  player: PlayerState,
  statusId: string,
): PlayerStatusState | null {
  return player.statuses.find((status) => status.id === statusId && status.stacks > 0) ?? null;
}

/** Decrements one stack of a status, removing it entirely once exhausted. */
export function consumeStatus(player: PlayerState, statusId: string): PlayerState {
  const statuses = player.statuses
    .map((status) =>
      status.id === statusId ? { ...status, stacks: status.stacks - 1 } : status,
    )
    .filter((status) => status.stacks > 0);

  return { ...player, statuses };
}

/** Applies the applyStatus tile effect: adds (or replaces) a status by id. */
export function applyStatusEffect(
  player: PlayerState,
  input: {
    readonly statusId: string;
    readonly duration:
      | { readonly kind: "uses"; readonly count: number }
      | { readonly kind: "turns"; readonly count: number };
    readonly parameters?: Readonly<Record<string, number | string | boolean>>;
  },
): PlayerState {
  const status: PlayerStatusState = {
    id: createStableId("StatusId", input.statusId),
    sourceId: null,
    stacks: input.duration.kind === "uses" ? input.duration.count : 1,
    remainingTurns: input.duration.kind === "turns" ? input.duration.count : null,
    expiresAtRound: null,
    visibility: "private",
    data: input.parameters ?? {},
  };

  return {
    ...player,
    statuses: [...player.statuses.filter((existing) => existing.id !== status.id), status],
  };
}

/**
 * Movement this player loses to a turns-based status, read once at the start of
 * their own turn. Only `status.burnout-tile` slows a player down today; its
 * `movementPenalty` parameter is authored on the burnout tile.
 *
 * The caller clamps the result so a penalty can never stop a player dead: a
 * zero-space "move" would re-resolve the tile they are already standing on.
 */
export function statusMovementPenalty(player: PlayerState): number {
  const burnout = findActiveStatus(player, "status.burnout-tile");
  if (burnout === null) return 0;

  const penalty = burnout.data["movementPenalty"];
  if (typeof penalty !== "number" || !Number.isFinite(penalty) || penalty <= 0) {
    return 0;
  }

  return Math.floor(penalty);
}

/* ------------------------------------------------ the card status vocabulary */

/**
 * The seven statuses the 242-card pack applies that the engine had no consumer
 * for — re-cut plan §11.2, which is explicit that an id landing in `StatusId`
 * and in `validStatusIds` without a third landing here "validates, persists, and
 * does nothing forever".
 *
 * Every one follows the shape of the four that already worked
 * (`status.next-salary-multiplier`, `status.next-roll-extra-movement`,
 * `status.skip-next-tile-effect`, `status.ignore-next-work-energy`): read the
 * status at the moment the thing it modifies happens, apply it exactly once, and
 * consume it. None of them ticks, none of them stacks — every authored use is
 * `duration: { kind: "uses", count: 1 }`.
 */
export const CARD_STATUS_IDS = {
  workCardMoneyMultiplier: "status.next-work-card-money-multiplier",
  workCardReputationMultiplier: "status.next-work-card-reputation-multiplier",
  workExtraEnergy: "status.next-work-extra-energy",
  ignoreMeetingEnergy: "status.ignore-next-meeting-energy",
  skipNetworkingReward: "status.skip-next-networking-reward",
  promotionReputationDiscount: "status.next-promotion-reputation-discount",
  cancelMoneyLoss: "status.cancel-next-money-loss",
} as const;

/**
 * A numeric authored parameter off a status, or the fallback.
 *
 * `PlayerStatusState.data` is a `JsonObject` that survived a JSON round trip, so
 * every read is a guard rather than a cast — the same discipline
 * `statusMovementPenalty` already applies to `movementPenalty`.
 */
function numberParameter(
  status: PlayerStatusState,
  key: string,
  fallback: number,
): number {
  const value = status.data[key];

  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Whether an effect is a *reward* to whoever it lands on.
 *
 * Only `status.skip-next-networking-reward` needs this, and it needs it to be
 * conservative in one specific direction: the attack must drop the victim's
 * gains and leave their losses alone (re-cut plan §11.2 — "dropping everything
 * makes the attack backfire half the time"). So an effect this function cannot
 * classify is treated as *not* a reward and still applies. Deliberately **not**
 * exhaustive over `EffectDescriptor`: a new effect type keeps working here, it
 * simply is not suppressible until someone classifies it. That is the opposite
 * trade-off from `resolve-tile-effects.ts`'s `satisfies never`, and on purpose —
 * failing to suppress a reward is a balance wobble, failing to *apply* a new
 * effect is a card that does nothing.
 */
function isRewardEffect(effect: EffectDescriptor): boolean {
  switch (effect.type) {
    case "applyStatus":
      // The only effect that carries authored polarity of its own.
      return effect.polarity === "positive";
    case "modifyResource":
      return effect.amount > 0;
    case "incrementWorkCounter":
      return effect.amount > 0;
    case "restoreResourceToMaximum":
    case "grantExtraRoll":
    case "grantImmunity":
    case "grantIncomeStream":
    case "drawCards":
      return true;
    case "transferResource":
      // Default direction is the steal: resource flows to whoever is resolving
      // the card, which for a drawn card is the holder of this status.
      return (effect.direction ?? "target-to-actor") === "target-to-actor";
    case "modifyHeat":
      return effect.amount < 0;
    default:
      return false;
  }
}

function scaleResourceGain(
  effect: EffectDescriptor,
  resource: string,
  multiplier: number,
): EffectDescriptor {
  if (effect.type !== "modifyResource") return effect;
  if (effect.resource !== resource || effect.amount <= 0) return effect;

  // Rounded rather than floored so a `x2` never loses a point to arithmetic and
  // a fractional authored multiplier still lands on a whole resource unit.
  return { ...effect, amount: Math.round(effect.amount * multiplier) };
}

export type CardStatusOutcome = {
  readonly player: PlayerState;
  /** The card's effects as the statuses leave them. */
  readonly effects: readonly EffectDescriptor[];
  /** Which status ids were spent here, in application order. */
  readonly consumedStatusIds: readonly string[];
};

/**
 * Applies every deck-scoped card status the player is holding to the card they
 * are resolving *right now*, and consumes the ones that fired.
 *
 * Call this once, immediately before a drawn or played card's `effects` are
 * resolved, with the deck the card came from. It rewrites the effect list rather
 * than the resulting resource deltas, which is what keeps it composable with the
 * character passives, immunity and reaction machinery that run afterwards — a
 * suppressed effect is genuinely absent, so nothing downstream reports a change
 * that did not happen.
 *
 * **Consumption is per card, not per matching line**, matching the shipped
 * behaviour of `status.ignore-next-work-energy`: that status is spent by landing
 * on a work tile whether or not the tile had an energy cost to ignore. "Your
 * next work card" therefore means the next one you resolve, full stop; a work
 * card with no money on it still spends a money multiplier. Any other rule makes
 * the status invisible to the player and unbounded in duration.
 */
export function applyCardStatuses(
  player: PlayerState,
  deckId: string,
  effects: readonly EffectDescriptor[],
): CardStatusOutcome {
  let current = player;
  let currentEffects = effects;
  const consumedStatusIds: string[] = [];

  const spend = (statusId: string): PlayerStatusState | null => {
    const status = findActiveStatus(current, statusId);
    if (status === null) return null;
    current = consumeStatus(current, statusId);
    consumedStatusIds.push(statusId);

    return status;
  };

  if (deckId === "deck.work") {
    const money = spend(CARD_STATUS_IDS.workCardMoneyMultiplier);
    if (money !== null) {
      // `x0` is the attack half of this status: the award is zeroed, not negated.
      const multiplier = Math.max(0, numberParameter(money, "multiplier", 1));
      currentEffects = currentEffects.map((effect) =>
        scaleResourceGain(effect, "money", multiplier),
      );
    }

    const reputation = spend(CARD_STATUS_IDS.workCardReputationMultiplier);
    if (reputation !== null) {
      const multiplier = Math.max(0, numberParameter(reputation, "multiplier", 1));
      currentEffects = currentEffects.map((effect) =>
        scaleResourceGain(effect, "reputation", multiplier),
      );
    }

    const extraEnergy = spend(CARD_STATUS_IDS.workExtraEnergy);
    if (extraEnergy !== null) {
      // The penalty twin of `status.ignore-next-work-energy`, per the authoring
      // note on `card.meeting.action-items` and its `polarity: "negative"`: the
      // shipped status *removes* a work tile's energy cost, so its mirror adds
      // one to the next work card. (The docstring on `StatusId` in
      // `packages/content/src/schema/ids.ts` reads the other way round and is
      // the odd one out — flagged, not silently obeyed.)
      const amount = Math.max(0, Math.floor(numberParameter(extraEnergy, "energy", 1)));
      if (amount > 0) {
        currentEffects = [
          ...currentEffects,
          { type: "modifyResource", resource: "energy", amount: -amount, clampAtZero: true },
        ];
      }
    }
  }

  if (deckId === "deck.meeting" && spend(CARD_STATUS_IDS.ignoreMeetingEnergy) !== null) {
    // Scoped to the energy line only — `status.skip-next-tile-effect` already
    // exists for "suppress the whole thing", and the authoring note on
    // `card.meeting.calendar-priority` says explicitly that this is not that.
    currentEffects = currentEffects.filter(
      (effect) =>
        !(effect.type === "modifyResource" && effect.resource === "energy" && effect.amount < 0),
    );
  }

  if (deckId === "deck.networking" && spend(CARD_STATUS_IDS.skipNetworkingReward) !== null) {
    currentEffects = currentEffects.filter((effect) => !isRewardEffect(effect));
  }

  return { player: current, effects: currentEffects, consumedStatusIds };
}

export type MoneyLossOutcome = {
  readonly player: PlayerState;
  /** The delta as it should actually be applied. */
  readonly amount: number;
  readonly cancelled: boolean;
};

/**
 * `status.cancel-next-money-loss` — the next negative money delta is cancelled
 * outright and the status is spent.
 *
 * Takes a signed delta and returns the one to apply, so it sits directly in
 * front of whatever mutates money (a `modifyResource`, a `payResource`, an
 * upkeep charge, a transfer out) without that caller needing to know the status
 * exists. A non-negative delta is returned untouched and spends nothing: the
 * card promises protection from a *loss*, so a turn that never lost money must
 * not silently burn it.
 */
export function cancelMoneyLoss(player: PlayerState, amount: number): MoneyLossOutcome {
  if (amount >= 0 || findActiveStatus(player, CARD_STATUS_IDS.cancelMoneyLoss) === null) {
    return { player, amount, cancelled: false };
  }

  return {
    player: consumeStatus(player, CARD_STATUS_IDS.cancelMoneyLoss),
    amount: 0,
    cancelled: true,
  };
}

export type PromotionDiscountOutcome = {
  readonly player: PlayerState;
  /** Reputation to subtract from the next rank's requirement. Never negative. */
  readonly discount: number;
};

/**
 * `status.next-promotion-reputation-discount` — reduces the reputation the next
 * promotion costs, then is spent.
 *
 * Reuses the discount path `resolvePromotion` already runs for the Office
 * Politician's `modifyPromotionRequirement`, which is exactly what the authoring
 * notes on `card.networking.new-mentor` and `card.work.promotion-portfolio` say
 * it should do; the two stack, because one is a character and the other is a
 * card and neither claims exclusivity.
 *
 * The status is spent on the promotion *attempt* that reads it, not only on a
 * successful one — an attempt is the moment the requirement is evaluated, and a
 * discount that survives a failed attempt is a permanent discount.
 */
export function promotionReputationDiscount(player: PlayerState): PromotionDiscountOutcome {
  const status = findActiveStatus(player, CARD_STATUS_IDS.promotionReputationDiscount);
  if (status === null) return { player, discount: 0 };

  return {
    player: consumeStatus(player, CARD_STATUS_IDS.promotionReputationDiscount),
    discount: Math.max(0, Math.floor(numberParameter(status, "reputation", 0))),
  };
}

/** Decrements remainingTurns for every turns-based status the player holds, dropping expired ones. */
export function tickStatusTurns(player: PlayerState): PlayerState {
  const statuses = player.statuses
    .map((status) =>
      status.remainingTurns === null
        ? status
        : { ...status, remainingTurns: status.remainingTurns - 1 },
    )
    .filter((status) => status.remainingTurns === null || status.remainingTurns > 0);

  return { ...player, statuses };
}
