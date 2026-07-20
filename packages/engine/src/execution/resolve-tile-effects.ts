import type { EffectDescriptor } from "@office-ladder/content";

import type { PlayerState, ResourceState } from "../model";
import { randomInt, rollDie, type RandomSource } from "../random";

export type ResourceKey = "money" | "reputation" | "energy" | "work-counter";

export type TileEffectChange = {
  readonly resource: ResourceKey;
  readonly previousValue: number;
  readonly newValue: number;
};

export type TileEffectOutcome = {
  readonly player: PlayerState;
  readonly changes: readonly TileEffectChange[];
  readonly grantedExtraRoll: boolean;
};

/**
 * Small built-in flavor table used in place of real management-deck card
 * content (no deck/card pool has been authored yet — see AGENTS.md). Picked
 * deterministically via the tracked dice random source so replay stays
 * reproducible.
 */
const DECK_FLAVOR_EFFECTS: readonly EffectDescriptor[] = [
  { type: "modifyResource", resource: "money", amount: 150, clampAtZero: true },
  { type: "modifyResource", resource: "money", amount: -150, clampAtZero: true },
  { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
  { type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true },
  { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
  { type: "modifyResource", resource: "money", amount: 300, clampAtZero: true },
];

function adjustResource(
  player: PlayerState,
  resourceKey: string,
  amount: number,
  clampAtZero: boolean,
  clampAtMaximum: boolean,
): { readonly player: PlayerState; readonly change: TileEffectChange | null } {
  const resource = player.resources[resourceKey];
  if (resource === undefined) return { player, change: null };

  let nextValue = resource.value + amount;
  if (clampAtZero && resource.minimum !== null) {
    nextValue = Math.max(resource.minimum, nextValue);
  }
  if (clampAtMaximum && resource.maximum !== null) {
    nextValue = Math.min(resource.maximum, nextValue);
  }
  if (nextValue === resource.value) return { player, change: null };

  const updatedResource: ResourceState = { ...resource, value: nextValue };
  return {
    player: {
      ...player,
      resources: { ...player.resources, [resourceKey]: updatedResource },
    },
    change: {
      resource: resourceKey as ResourceKey,
      previousValue: resource.value,
      newValue: nextValue,
    },
  };
}

function applyOne(
  player: PlayerState,
  effect: EffectDescriptor,
  random: RandomSource,
  depth: number,
): { readonly player: PlayerState; readonly changes: readonly TileEffectChange[]; readonly extraRoll: boolean } {
  if (depth > 3) return { player, changes: [], extraRoll: false };

  switch (effect.type) {
    case "modifyResource": {
      const { player: next, change } = adjustResource(
        player,
        effect.resource,
        effect.amount,
        effect.clampAtZero ?? false,
        effect.clampAtMaximum ?? false,
      );
      return { player: next, changes: change ? [change] : [], extraRoll: false };
    }
    case "payResource": {
      const { player: next, change } = adjustResource(player, effect.resource, -effect.amount, true, false);
      return { player: next, changes: change ? [change] : [], extraRoll: false };
    }
    case "restoreResourceToMaximum": {
      const resource = player.resources[effect.resource];
      if (resource === undefined || resource.maximum === null) {
        return { player, changes: [], extraRoll: false };
      }
      const { player: next, change } = adjustResource(
        player,
        effect.resource,
        resource.maximum - resource.value,
        false,
        true,
      );
      return { player: next, changes: change ? [change] : [], extraRoll: false };
    }
    case "incrementWorkCounter": {
      const counter = player.resources["work-counter"];
      if (counter === undefined) return { player, changes: [], extraRoll: false };

      const { player: afterIncrement, change } = adjustResource(
        player,
        "work-counter",
        effect.amount,
        false,
        false,
      );
      const changes = change ? [change] : [];
      if (change !== null && change.newValue % effect.rewardEvery === 0) {
        const { player: afterReward, change: rewardChange } = adjustResource(
          afterIncrement,
          effect.reward.resource,
          effect.reward.amount,
          true,
          false,
        );
        return {
          player: afterReward,
          changes: rewardChange ? [...changes, rewardChange] : changes,
          extraRoll: false,
        };
      }
      return { player: afterIncrement, changes, extraRoll: false };
    }
    case "rollCheck": {
      const firstDie = rollDie(random, effect.dice.sides);
      const secondDie = effect.dice.count === 2 ? rollDie(random, effect.dice.sides) : null;
      const total = firstDie + (secondDie ?? 0);
      const isDoubles = secondDie !== null && secondDie === firstDie;

      const outcome = effect.outcomes.find((candidate) => {
        if ("doubles" in candidate.when) {
          return candidate.when.doubles === isDoubles;
        }
        const [min, max] = candidate.when.total;
        return total >= min && total <= max;
      });
      if (outcome === undefined) return { player, changes: [], extraRoll: false };

      return applyMany(player, outcome.effects, random, depth + 1);
    }
    case "drawCards": {
      const index = randomInt(random, 0, DECK_FLAVOR_EFFECTS.length - 1);
      const flavor = DECK_FLAVOR_EFFECTS[index];
      if (flavor === undefined) return { player, changes: [], extraRoll: false };
      return applyOne(player, flavor, random, depth + 1);
    }
    case "grantExtraRoll":
      return { player, changes: [], extraRoll: true };
    case "gainSalary":
    case "attemptPromotion":
      // Handled unconditionally once per turn in roll-turn.ts, independent of
      // which tile was landed on — see AGENTS.md.
      return { player, changes: [], extraRoll: false };
    case "skipTurns":
    case "applyStatus":
    case "auditConfinement":
      // Not implemented: would need turn-order-skipping and status/duration
      // tracking beyond what's modeled today. See AGENTS.md known gaps.
      return { player, changes: [], extraRoll: false };
    default:
      return { player, changes: [], extraRoll: false };
  }
}

function applyMany(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  random: RandomSource,
  depth: number,
): { readonly player: PlayerState; readonly changes: readonly TileEffectChange[]; readonly extraRoll: boolean } {
  let current = player;
  const changes: TileEffectChange[] = [];
  let extraRoll = false;

  for (const effect of effects) {
    const result = applyOne(current, effect, random, depth);
    current = result.player;
    changes.push(...result.changes);
    extraRoll = extraRoll || result.extraRoll;
  }

  return { player: current, changes, extraRoll };
}

export function resolveTileEffects(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  random: RandomSource,
): TileEffectOutcome {
  const result = applyMany(player, effects, random, 0);
  return { player: result.player, changes: result.changes, grantedExtraRoll: result.extraRoll };
}
