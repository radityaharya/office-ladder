import type {
  CharacterAbilityDescriptor,
  DeckCard,
  DeckConfig,
  EffectDescriptor,
  RollOutcome,
  TileDecisionConfig,
} from "@office-ladder/content";

import type { PlayerState, ResourceState } from "../model";
import { randomInt, rollDie, type RandomSource } from "../random";
import { applyStatusEffect, consumeStatus, findActiveStatus } from "./player-status";

export type ResourceKey = "money" | "reputation" | "energy" | "work-counter";

/** Where an effect came from, matching the `sources` vocabulary of character passives. */
export type EffectOrigin = "tile" | "card";

export type TileEffectChange = {
  readonly resource: ResourceKey;
  readonly previousValue: number;
  readonly newValue: number;
};

export type ImmediateCardResolution = Pick<DeckCard, "id" | "nameKey"> & {
  readonly deckId: DeckConfig["id"];
};

/** One negative effect an `ignoreNegativeEffect` passive absorbed instead of applying. */
export type IgnoredNegativeEffect = {
  readonly origin: EffectOrigin;
  readonly effectType: "modifyResource" | "payResource";
  readonly resource: ResourceKey;
  /** Positive magnitude of the resource loss that never happened. */
  readonly amount: number;
};

export type TileEffectTraceEntry =
  | { readonly type: "card-drawn"; readonly card: ImmediateCardResolution }
  | { readonly type: "resource-changed"; readonly change: TileEffectChange }
  | { readonly type: "negative-effect-ignored"; readonly ignored: IgnoredNegativeEffect };

export type TileEffectOutcome = {
  readonly player: PlayerState;
  readonly changes: readonly TileEffectChange[];
  readonly trace: readonly TileEffectTraceEntry[];
  readonly grantedExtraRoll: boolean;
  readonly openAuditPrompt: boolean;
  /**
   * The landed tile's authored decision, when it should actually be put to the
   * player. Null when the tile asks nothing, when the player could not honour
   * the accept branch's cost (the decline branch resolved immediately instead),
   * or when the tile's resolution was skipped outright.
   */
  readonly openDecision: TileDecisionConfig | null;
  /** How many negative effects the acting character's passive absorbed here. */
  readonly ignoredNegativeEffects: number;
};

const MAX_EFFECT_RECURSION_DEPTH = 3;

/**
 * The remaining budget of an `ignoreNegativeEffect` passive, carried down the
 * effect tree so a nested card effect cannot spend an allowance the tile's own
 * effects already used up.
 */
type NegativeEffectShield = {
  readonly remaining: number;
  readonly sources: readonly EffectOrigin[];
};

type Accumulated = {
  readonly player: PlayerState;
  readonly changes: readonly TileEffectChange[];
  readonly trace: readonly TileEffectTraceEntry[];
  readonly extraRoll: boolean;
  readonly rolledDoubles: boolean;
  readonly openAuditPrompt: boolean;
  readonly ignoredNegativeEffects: number;
};

function resourceTrace(changes: readonly TileEffectChange[]): readonly TileEffectTraceEntry[] {
  return changes.map((change) => ({ type: "resource-changed", change }));
}

/** Nothing happened: the player is untouched and no randomness was consumed. */
function inert(player: PlayerState): Accumulated {
  return {
    player,
    changes: [],
    trace: [],
    extraRoll: false,
    rolledDoubles: false,
    openAuditPrompt: false,
    ignoredNegativeEffects: 0,
  };
}

function fromChanges(
  player: PlayerState,
  changes: readonly TileEffectChange[],
): Accumulated {
  return { ...inert(player), changes, trace: resourceTrace(changes) };
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

/**
 * What Tech Genius's `ignoreNegativeEffect` passive is allowed to cancel.
 *
 * Deliberately narrow and mechanical: an effect qualifies only when it takes a
 * resource away by an authored amount — a negative `modifyResource` or any
 * `payResource`. Everything else is out of scope on purpose, including
 * `skipTurns`, `auditConfinement`, `applyStatus` (even when the status is a
 * penalty), and a `rollCheck` whose *outcome* happens to be bad: the shield
 * fires on the outcome's own negative effect, not on the check itself. Being
 * boring here is the point — a player must be able to predict what their one
 * use per lap will absorb.
 *
 * The loss is measured against the player's *actual* resource state rather than
 * the authored amount, so an allowance is never spent on a loss that would take
 * nothing: a `payResource` from an empty wallet, or a clamped `modifyResource`
 * on a resource already sitting at its minimum, both change no value at all and
 * so are not "a negative effect" this passive has anything to prevent. The
 * reported amount is likewise what was really prevented, not what was authored.
 */
function negativeResourceLoss(
  player: PlayerState,
  effect: EffectDescriptor,
): {
  readonly effectType: "modifyResource" | "payResource";
  readonly resource: ResourceKey;
  readonly amount: number;
} | null {
  if (effect.type === "modifyResource" && effect.amount < 0) {
    const { change } = adjustResource(
      player,
      effect.resource,
      effect.amount,
      effect.clampAtZero ?? false,
      effect.clampAtMaximum ?? false,
    );
    if (change === null) return null;

    return {
      effectType: "modifyResource",
      resource: change.resource,
      amount: change.previousValue - change.newValue,
    };
  }
  if (effect.type === "payResource" && effect.amount > 0) {
    const { change } = adjustResource(player, effect.resource, -effect.amount, true, false);
    if (change === null) return null;

    return {
      effectType: "payResource",
      resource: change.resource,
      amount: change.previousValue - change.newValue,
    };
  }

  return null;
}

function spend(shield: NegativeEffectShield | null, used: number): NegativeEffectShield | null {
  if (shield === null || used === 0) return shield;
  return { ...shield, remaining: shield.remaining - used };
}

function applyOne(
  player: PlayerState,
  effect: EffectDescriptor,
  random: RandomSource,
  depth: number,
  decks: readonly DeckConfig[],
  shield: NegativeEffectShield | null,
  origin: EffectOrigin,
): Accumulated {
  if (depth > MAX_EFFECT_RECURSION_DEPTH) {
    return inert(player);
  }

  if (shield !== null && shield.remaining > 0 && shield.sources.includes(origin)) {
    const loss = negativeResourceLoss(player, effect);
    if (loss !== null) {
      return {
        ...inert(player),
        trace: [{ type: "negative-effect-ignored", ignored: { origin, ...loss } }],
        ignoredNegativeEffects: 1,
      };
    }
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
      return fromChanges(next, change ? [change] : []);
    }
    case "payResource": {
      const { player: next, change } = adjustResource(player, effect.resource, -effect.amount, true, false);
      return fromChanges(next, change ? [change] : []);
    }
    case "restoreResourceToMaximum": {
      const resource = player.resources[effect.resource];
      if (resource === undefined || resource.maximum === null) {
        return inert(player);
      }
      const { player: next, change } = adjustResource(
        player,
        effect.resource,
        resource.maximum - resource.value,
        false,
        true,
      );
      return fromChanges(next, change ? [change] : []);
    }
    case "incrementWorkCounter": {
      const counter = player.resources["work-counter"];
      if (counter === undefined) return inert(player);

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
        return fromChanges(
          afterReward,
          rewardChange ? [...changes, rewardChange] : changes,
        );
      }
      return fromChanges(afterIncrement, changes);
    }
    case "rollCheck": {
      const firstDie = rollDie(random, effect.dice.sides);
      const secondDie = effect.dice.count === 2 ? rollDie(random, effect.dice.sides) : null;
      const total = firstDie + (secondDie ?? 0);
      const isDoubles = secondDie !== null && secondDie === firstDie;

      const outcome = matchRollOutcome(effect.outcomes, total, isDoubles);
      if (outcome === null) {
        return { ...inert(player), rolledDoubles: isDoubles };
      }

      const nested = applyMany(player, outcome.effects, random, depth + 1, decks, shield, origin);
      return { ...nested, rolledDoubles: isDoubles };
    }
    case "drawCards": {
      const deck = decks.find((candidate) => candidate.id === effect.deckId);
      // The **fallback path**, and deliberately a silent one: a deck the content
      // pack has not authored yet draws nothing rather than inventing a card.
      //
      // This used to be `DECK_FLAVOR_EFFECTS`, a small synthesized table of
      // plausible resource deltas that stood in for real card content. Real
      // cards now exist and are read from `decks` above, so the stand-in is
      // gone — but the *fallback shape* is still load-bearing while the
      // remaining decks are authored (§10.4: `decks.ts` holds 29 of ~247
      // designed cards). Do not reintroduce synthesized effects here: a draw
      // that quietly pays out content nobody wrote is indistinguishable, in the
      // log and in the UI, from one that did.
      if (deck === undefined || deck.cards.length === 0) {
        return inert(player);
      }

      let current = player;
      let remainingShield = shield;
      const changes: TileEffectChange[] = [];
      const trace: TileEffectTraceEntry[] = [];
      let extraRoll = false;
      let rolledDoubles = false;
      let openAuditPrompt = false;
      let ignoredNegativeEffects = 0;

      for (let drawIndex = 0; drawIndex < effect.count; drawIndex += 1) {
        const cardIndex = randomInt(random, 0, deck.cards.length - 1);
        const card = deck.cards[cardIndex];
        if (card === undefined) continue;

        trace.push({
          type: "card-drawn",
          card: { id: card.id, nameKey: card.nameKey, deckId: deck.id },
        });
        const result = applyMany(
          current,
          card.effects,
          random,
          depth + 1,
          decks,
          remainingShield,
          "card",
        );
        current = result.player;
        changes.push(...result.changes);
        trace.push(...result.trace);
        extraRoll = extraRoll || result.extraRoll;
        rolledDoubles = rolledDoubles || result.rolledDoubles;
        openAuditPrompt = openAuditPrompt || result.openAuditPrompt;
        ignoredNegativeEffects += result.ignoredNegativeEffects;
        remainingShield = spend(remainingShield, result.ignoredNegativeEffects);
      }

      return {
        player: current,
        changes,
        trace,
        extraRoll,
        rolledDoubles,
        openAuditPrompt,
        ignoredNegativeEffects,
      };
    }
    case "grantExtraRoll":
      return { ...inert(player), extraRoll: true };
    case "gainSalary":
    case "attemptPromotion":
      // Handled unconditionally once per turn in roll-turn.ts, independent of
      // which tile was landed on — see AGENTS.md.
      return inert(player);
    case "skipTurns":
      return inert({ ...player, skipTurns: player.skipTurns + effect.count });
    case "auditConfinement":
      return { ...inert({ ...player, inAudit: true }), openAuditPrompt: true };
    case "applyStatus":
      return inert(applyStatusEffect(player, effect));
    default:
      // Every EffectDescriptor variant is handled above, so a new one added to
      // the content vocabulary is a compile error here rather than a silent
      // no-op that only surfaces as a tile that mysteriously does nothing.
      return effect satisfies never;
  }
}

function applyMany(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  random: RandomSource,
  depth: number,
  decks: readonly DeckConfig[],
  shield: NegativeEffectShield | null,
  origin: EffectOrigin,
): Accumulated {
  let current = player;
  let remainingShield = shield;
  const changes: TileEffectChange[] = [];
  const trace: TileEffectTraceEntry[] = [];
  let extraRoll = false;
  let rolledDoubles = false;
  let openAuditPrompt = false;
  let ignoredNegativeEffects = 0;

  for (const effect of effects) {
    const result = applyOne(current, effect, random, depth, decks, remainingShield, origin);
    current = result.player;
    changes.push(...result.changes);
    trace.push(...result.trace);
    extraRoll = extraRoll || result.extraRoll;
    rolledDoubles = rolledDoubles || result.rolledDoubles;
    openAuditPrompt = openAuditPrompt || result.openAuditPrompt;
    ignoredNegativeEffects += result.ignoredNegativeEffects;
    remainingShield = spend(remainingShield, result.ignoredNegativeEffects);
  }

  return {
    player: current,
    changes,
    trace,
    extraRoll,
    rolledDoubles,
    openAuditPrompt,
    ignoredNegativeEffects,
  };
}

/**
 * Outcome matching for a dice check, shared by the `rollCheck` effect and by a
 * tile decision's accept branch so both read authored `when` conditions the
 * same way.
 */
export function matchRollOutcome(
  outcomes: readonly RollOutcome[],
  total: number,
  isDoubles: boolean,
): RollOutcome | null {
  const outcome = outcomes.find((candidate) => {
    if ("doubles" in candidate.when) {
      return candidate.when.doubles === isDoubles;
    }
    const [minimum, maximum] = candidate.when.total;
    return total >= minimum && total <= maximum;
  });

  return outcome ?? null;
}

/**
 * Resolves a bare list of authored effects outside tile resolution — used when
 * a decision prompt's chosen branch is applied (see respond-to-prompt.ts).
 * No character passive applies here: nothing about a branch the player chose
 * themselves is an effect "landed on".
 */
export function applyEffectDescriptors(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  random: RandomSource,
  decks: readonly DeckConfig[] = [],
): {
  readonly player: PlayerState;
  readonly changes: readonly TileEffectChange[];
  readonly trace: readonly TileEffectTraceEntry[];
} {
  const result = applyMany(player, effects, random, 0, decks, null, "tile");
  return { player: result.player, changes: result.changes, trace: result.trace };
}

/**
 * Everything the per-player effect walk produced, for callers that need more
 * than `applyEffectDescriptors`' three fields.
 *
 * The gameplay-v2 resolver (`effects-v2/`) applies v1 effects to *targets other
 * than the actor*, and has to know whether one of them granted an extra roll or
 * opened an audit — outcomes that only make sense once you know which player
 * they landed on. Rather than duplicate the walk, it calls `applySelfEffects`
 * per target and folds these flags into its own report.
 */
export type SelfEffectResolution = {
  readonly player: PlayerState;
  readonly changes: readonly TileEffectChange[];
  readonly trace: readonly TileEffectTraceEntry[];
  readonly grantedExtraRoll: boolean;
  readonly openAuditPrompt: boolean;
  readonly ignoredNegativeEffects: number;
};

/**
 * The v1 effect walk, applied to one player, with the full outcome reported.
 *
 * Additive: `applyEffectDescriptors` and `resolveTileEffects` are untouched and
 * keep their exact signatures and semantics, because several other mechanics
 * resolve through them. This is the same `applyMany` those two already use — no
 * second interpreter, so a v1 effect behaves identically whether it arrives via
 * a tile, a decision branch, or a v2 target.
 *
 * `shield` is the acting *target's* `ignoreNegativeEffect` allowance, when they
 * have one; pass `null` (the default) for a walk no passive applies to.
 */
export function applySelfEffects(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  random: RandomSource,
  decks: readonly DeckConfig[] = [],
  origin: EffectOrigin = "tile",
  shield: {
    readonly remaining: number;
    readonly sources: readonly EffectOrigin[];
  } | null = null,
): SelfEffectResolution {
  const result = applyMany(player, effects, random, 0, decks, shield, origin);

  return {
    player: result.player,
    changes: result.changes,
    trace: result.trace,
    grantedExtraRoll: result.extraRoll,
    openAuditPrompt: result.openAuditPrompt,
    ignoredNegativeEffects: result.ignoredNegativeEffects,
  };
}

/**
 * The `ignoreNegativeEffect` allowance a player has left this lap, if their
 * character has that passive at all. Exported so the v2 resolver can honour a
 * *target's* own passive when an effect lands on them from across the table —
 * the shield belongs to whoever is being hit, not to whoever is hitting.
 */
export function negativeEffectShieldFor(
  player: PlayerState,
  passive: CharacterAbilityDescriptor | undefined,
): { readonly remaining: number; readonly sources: readonly EffectOrigin[] } | null {
  return createNegativeEffectShield(player, passive);
}

/**
 * A small subset of character passives are automatic (no player decision)
 * and fit naturally alongside tile-effect resolution: bonuses tied to
 * landing on a specific tile kind, or to rolling doubles on a rollCheck.
 * `salaryMultiplier` is handled separately in roll-salary.ts, and
 * `ignoreNegativeEffect` is applied inside the effect walk itself (it has to
 * cancel individual effects rather than add a bonus afterwards). Everything
 * else (active abilities with cooldowns, swapBoardPositions/teleport/
 * stealResource which need a target player) is not implemented — see AGENTS.md.
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

/** The passive's per-lap allowance that is still unspent on this lap. */
function createNegativeEffectShield(
  player: PlayerState,
  passive: CharacterAbilityDescriptor | undefined,
): NegativeEffectShield | null {
  if (passive === undefined || passive.type !== "ignoreNegativeEffect") return null;

  const remaining = passive.usesPerLap - player.negativeEffectsIgnoredThisLap;
  if (remaining <= 0) return null;

  return { remaining, sources: passive.sources };
}

function canAfford(player: PlayerState, decision: TileDecisionConfig): boolean {
  const resource = player.resources[decision.accept.cost.resource];
  return resource !== undefined && resource.value >= decision.accept.cost.amount;
}

export function resolveTileEffects(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  random: RandomSource,
  tileKind: string,
  characterPassive: CharacterAbilityDescriptor | undefined,
  decks: readonly DeckConfig[] = [],
  decision: TileDecisionConfig | undefined = undefined,
): TileEffectOutcome {
  if (findActiveStatus(player, "status.skip-next-tile-effect") !== null) {
    // Skipping the tile skips its question too: the player never arrives at the
    // decision, so nothing is offered and nothing is charged.
    return {
      player: consumeStatus(player, "status.skip-next-tile-effect"),
      changes: [],
      trace: [],
      grantedExtraRoll: false,
      openAuditPrompt: false,
      openDecision: null,
      ignoredNegativeEffects: 0,
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

  const shield = createNegativeEffectShield(effectivePlayer, characterPassive);
  const result = applyMany(effectivePlayer, effectiveEffects, random, 0, decks, shield, "tile");
  const passive = applyCharacterPassive(result.player, characterPassive, tileKind, result.rolledDoubles);

  const offer = decision !== undefined && canAfford(passive.player, decision);
  // An unaffordable offer is never put to the player; the decline branch is
  // what would have happened anyway, so it resolves immediately.
  const unaffordable =
    decision !== undefined && !offer
      ? applyMany(
          passive.player,
          decision.decline.effects,
          random,
          0,
          decks,
          spend(shield, result.ignoredNegativeEffects),
          "tile",
        )
      : null;

  const changes = [
    ...result.changes,
    ...passive.changes,
    ...(unaffordable?.changes ?? []),
  ];
  const trace = [
    ...result.trace,
    ...resourceTrace(passive.changes),
    ...(unaffordable?.trace ?? []),
  ];
  const ignoredNegativeEffects =
    result.ignoredNegativeEffects + (unaffordable?.ignoredNegativeEffects ?? 0);
  const finalPlayer = unaffordable?.player ?? passive.player;

  return {
    player:
      ignoredNegativeEffects > 0
        ? {
            ...finalPlayer,
            negativeEffectsIgnoredThisLap:
              finalPlayer.negativeEffectsIgnoredThisLap + ignoredNegativeEffects,
          }
        : finalPlayer,
    changes,
    trace,
    grantedExtraRoll: result.extraRoll,
    openAuditPrompt: result.openAuditPrompt,
    openDecision: offer && decision !== undefined ? decision : null,
    ignoredNegativeEffects,
  };
}
