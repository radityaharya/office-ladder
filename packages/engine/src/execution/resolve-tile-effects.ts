import type { CharacterAbilityDescriptor, DeckCard, DeckConfig, EffectDescriptor } from "@office-ladder/content";

import type { PlayerState, ResourceState } from "../model";
import { randomInt, rollDie, type RandomSource } from "../random";
import { applyStatusEffect, consumeStatus, findActiveStatus } from "./player-status";

export type ResourceKey = "money" | "reputation" | "energy" | "work-counter";

export type TileEffectChange = {
  readonly resource: ResourceKey;
  readonly previousValue: number;
  readonly newValue: number;
};

export type ImmediateCardResolution = Pick<DeckCard, "id" | "nameKey"> & {
  readonly deckId: DeckConfig["id"];
};

export type TileEffectTraceEntry =
  | { readonly type: "card-drawn"; readonly card: ImmediateCardResolution }
  | { readonly type: "resource-changed"; readonly change: TileEffectChange };

export type TileEffectOutcome = {
  readonly player: PlayerState;
  readonly changes: readonly TileEffectChange[];
  readonly trace: readonly TileEffectTraceEntry[];
  readonly grantedExtraRoll: boolean;
  readonly openAuditPrompt: boolean;
};

const MAX_EFFECT_RECURSION_DEPTH = 3;

type Accumulated = {
  readonly player: PlayerState;
  readonly changes: readonly TileEffectChange[];
  readonly trace: readonly TileEffectTraceEntry[];
  readonly extraRoll: boolean;
  readonly rolledDoubles: boolean;
  readonly openAuditPrompt: boolean;
};

function resourceTrace(changes: readonly TileEffectChange[]): readonly TileEffectTraceEntry[] {
  return changes.map((change) => ({ type: "resource-changed", change }));
}

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
  decks: readonly DeckConfig[],
): Accumulated {
  if (depth > MAX_EFFECT_RECURSION_DEPTH) {
    return { player, changes: [], trace: [], extraRoll: false, rolledDoubles: false, openAuditPrompt: false };
  }

  switch (effect.type) {
    case "modifyResource": {
      const { player: next, change } = adjustResource(
        player,
        effect.resource,
        effect.amount,
        effect.clampAtZero ?? false,
        effect.clampAtMaximum ?? false,
      );
      const changes = change ? [change] : [];
      return { player: next, changes, trace: resourceTrace(changes), extraRoll: false, rolledDoubles: false, openAuditPrompt: false };
    }
    case "payResource": {
      const { player: next, change } = adjustResource(player, effect.resource, -effect.amount, true, false);
      const changes = change ? [change] : [];
      return { player: next, changes, trace: resourceTrace(changes), extraRoll: false, rolledDoubles: false, openAuditPrompt: false };
    }
    case "restoreResourceToMaximum": {
      const resource = player.resources[effect.resource];
      if (resource === undefined || resource.maximum === null) {
        return { player, changes: [], trace: [], extraRoll: false, rolledDoubles: false, openAuditPrompt: false };
      }
      const { player: next, change } = adjustResource(
        player,
        effect.resource,
        resource.maximum - resource.value,
        false,
        true,
      );
      const changes = change ? [change] : [];
      return { player: next, changes, trace: resourceTrace(changes), extraRoll: false, rolledDoubles: false, openAuditPrompt: false };
    }
    case "incrementWorkCounter": {
      const counter = player.resources["work-counter"];
      if (counter === undefined) return { player, changes: [], trace: [], extraRoll: false, rolledDoubles: false, openAuditPrompt: false };

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
          trace: resourceTrace(rewardChange ? [...changes, rewardChange] : changes),
          extraRoll: false,
          rolledDoubles: false,
          openAuditPrompt: false,
        };
      }
      return { player: afterIncrement, changes, trace: resourceTrace(changes), extraRoll: false, rolledDoubles: false, openAuditPrompt: false };
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
      if (outcome === undefined) {
        return { player, changes: [], trace: [], extraRoll: false, rolledDoubles: isDoubles, openAuditPrompt: false };
      }

      const nested = applyMany(player, outcome.effects, random, depth + 1, decks);
      return { ...nested, rolledDoubles: isDoubles };
    }
    case "drawCards": {
      const deck = decks.find((candidate) => candidate.id === effect.deckId);
      if (deck === undefined || deck.cards.length === 0) {
        return { player, changes: [], trace: [], extraRoll: false, rolledDoubles: false, openAuditPrompt: false };
      }

      let current = player;
      const changes: TileEffectChange[] = [];
      const trace: TileEffectTraceEntry[] = [];
      let extraRoll = false;
      let rolledDoubles = false;
      let openAuditPrompt = false;

      for (let drawIndex = 0; drawIndex < effect.count; drawIndex += 1) {
        const cardIndex = randomInt(random, 0, deck.cards.length - 1);
        const card = deck.cards[cardIndex];
        if (card === undefined) continue;

        trace.push({
          type: "card-drawn",
          card: { id: card.id, nameKey: card.nameKey, deckId: deck.id },
        });
        const result = applyMany(current, card.effects, random, depth + 1, decks);
        current = result.player;
        changes.push(...result.changes);
        trace.push(...result.trace);
        extraRoll = extraRoll || result.extraRoll;
        rolledDoubles = rolledDoubles || result.rolledDoubles;
        openAuditPrompt = openAuditPrompt || result.openAuditPrompt;
      }

      return { player: current, changes, trace, extraRoll, rolledDoubles, openAuditPrompt };
    }
    case "grantExtraRoll":
      return { player, changes: [], trace: [], extraRoll: true, rolledDoubles: false, openAuditPrompt: false };
    case "gainSalary":
    case "attemptPromotion":
      // Handled unconditionally once per turn in roll-turn.ts, independent of
      // which tile was landed on — see AGENTS.md.
      return { player, changes: [], trace: [], extraRoll: false, rolledDoubles: false, openAuditPrompt: false };
    case "skipTurns":
      return {
        player: { ...player, skipTurns: player.skipTurns + effect.count },
        changes: [],
        trace: [],
        extraRoll: false,
        rolledDoubles: false,
        openAuditPrompt: false,
      };
    case "auditConfinement":
      return {
        player: { ...player, inAudit: true },
        changes: [],
        trace: [],
        extraRoll: false,
        rolledDoubles: false,
        openAuditPrompt: true,
      };
    case "applyStatus":
      return {
        player: applyStatusEffect(player, effect),
        changes: [],
        trace: [],
        extraRoll: false,
        rolledDoubles: false,
        openAuditPrompt: false,
      };
    default:
      return { player, changes: [], trace: [], extraRoll: false, rolledDoubles: false, openAuditPrompt: false };
  }
}

function applyMany(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  random: RandomSource,
  depth: number,
  decks: readonly DeckConfig[],
): Accumulated {
  let current = player;
  const changes: TileEffectChange[] = [];
  const trace: TileEffectTraceEntry[] = [];
  let extraRoll = false;
  let rolledDoubles = false;
  let openAuditPrompt = false;

  for (const effect of effects) {
    const result = applyOne(current, effect, random, depth, decks);
    current = result.player;
    changes.push(...result.changes);
    trace.push(...result.trace);
    extraRoll = extraRoll || result.extraRoll;
    rolledDoubles = rolledDoubles || result.rolledDoubles;
    openAuditPrompt = openAuditPrompt || result.openAuditPrompt;
  }

  return { player: current, changes, trace, extraRoll, rolledDoubles, openAuditPrompt };
}

/**
 * A small subset of character passives are automatic (no player decision)
 * and fit naturally alongside tile-effect resolution: bonuses tied to
 * landing on a specific tile kind, or to rolling doubles on a rollCheck.
 * `salaryMultiplier` is handled separately in roll-salary.ts. Everything
 * else (active abilities with cooldowns, ignoreNegativeEffect's per-lap
 * counter, swapBoardPositions/teleport/stealResource which need a target
 * player) is not implemented — see AGENTS.md.
 */
function applyCharacterPassive(
  player: PlayerState,
  passive: CharacterAbilityDescriptor | undefined,
  tileKind: string,
  rolledDoubles: boolean,
): { readonly player: PlayerState; readonly changes: readonly TileEffectChange[] } {
  if (passive === undefined) return { player, changes: [] };

  if (passive.type === "workLandingMoneyBonus" && tileKind === "work") {
    const { player: next, change } = adjustResource(player, "money", passive.amount, true, false);
    return { player: next, changes: change ? [change] : [] };
  }
  if (passive.type === "meetingLandingReputationBonus" && tileKind === "meeting") {
    const { player: next, change } = adjustResource(player, "reputation", passive.amount, true, false);
    return { player: next, changes: change ? [change] : [] };
  }
  if (passive.type === "doublesMoneyBonus" && rolledDoubles) {
    const { player: next, change } = adjustResource(player, "money", passive.amount, true, false);
    return { player: next, changes: change ? [change] : [] };
  }

  return { player, changes: [] };
}

export function resolveTileEffects(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  random: RandomSource,
  tileKind: string,
  characterPassive: CharacterAbilityDescriptor | undefined,
  decks: readonly DeckConfig[] = [],
): TileEffectOutcome {
  if (findActiveStatus(player, "status.skip-next-tile-effect") !== null) {
    return {
      player: consumeStatus(player, "status.skip-next-tile-effect"),
      changes: [],
      trace: [],
      grantedExtraRoll: false,
      openAuditPrompt: false,
    };
  }

  const ignoresWorkEnergy =
    tileKind === "work" && findActiveStatus(player, "status.ignore-next-work-energy") !== null;
  const effectivePlayer = ignoresWorkEnergy
    ? consumeStatus(player, "status.ignore-next-work-energy")
    : player;
  const effectiveEffects = ignoresWorkEnergy
    ? effects.filter((effect) => !(effect.type === "modifyResource" && effect.resource === "energy" && effect.amount < 0))
    : effects;

  const result = applyMany(effectivePlayer, effectiveEffects, random, 0, decks);
  const passive = applyCharacterPassive(result.player, characterPassive, tileKind, result.rolledDoubles);

  return {
    player: passive.player,
    changes: [...result.changes, ...passive.changes],
    trace: [...result.trace, ...resourceTrace(passive.changes)],
    grantedExtraRoll: result.extraRoll,
    openAuditPrompt: result.openAuditPrompt,
  };
}
