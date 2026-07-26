import type {
  CharacterAbilityDescriptor,
  DeckCard,
  DeckConfig,
  EffectDescriptor,
  RollOutcome,
  TileDecisionConfig,
} from "@office-ladder/content";

import type { GameState, PlayerId, PlayerState, ResourceState } from "../model";
import { randomInt, rollDie, type RandomSource } from "../random";
import { applyStatusEffect, consumeStatus, findActiveStatus } from "./player-status";
// Deliberately the module rather than the `effects-v2/` barrel: this import and
// `resolve.ts`'s import of `applySelfEffects` form a cycle, and keeping it to
// the single module that actually participates is what stops the cycle growing
// to the whole directory. Both sides only touch each other from inside function
// bodies, so the hoisted declarations are live by the time either is called.
import { resolveEffectsV2, type EffectsV2Options, type EffectsV2Outcome } from "./effects-v2/resolve";
import type { EffectV2 } from "./effects-v2/vocabulary";

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

/* ------------------------------------------------------------- v2 routing */

/**
 * Which resolver owns each authored effect type.
 *
 * **This map is the exhaustiveness guarantee.** It is keyed by
 * `EffectDescriptor["type"]`, so a type added to the content vocabulary and not
 * classified here is a compile error — the same property the switch in
 * `applyOne` used to carry alone, kept intact now that the switch no longer ends
 * in `satisfies never`. The switch is still checked too: its `default` branch
 * hands `effect` to `routeEffectToV2`, whose parameter type is derived from this
 * map, so dropping a `case` that this map calls `"v1"` also fails to compile.
 *
 * - `"v1"` — the per-player walk in this file applies it directly.
 * - `"v2"` — state-scoped: targeting, prompts, reaction windows, the shared
 *   board. Handed to `resolveEffectsV2` verbatim; this file reimplements none of
 *   it.
 * - `"unowned"` — in the authored vocabulary, in neither resolver. **Currently
 *   empty**, and kept anyway: it is the only thing standing between this file
 *   and an infinite mutual recursion. `effects-v2`'s `isLegacyEffect` sends any
 *   type missing from its own `EFFECT_V2_TYPES` straight back here, so routing
 *   such a type onward would bounce it between the two resolvers forever.
 *   Anything dropped from that list must be marked `"unowned"` here in the same
 *   change; it then reports through `UnresolvedEffect` instead of hanging.
 */
const EFFECT_ROUTING = {
  // v1 — immediate, single-player, already interpreted below.
  drawCards: "v1",
  modifyResource: "v1",
  restoreResourceToMaximum: "v1",
  payResource: "v1",
  incrementWorkCounter: "v1",
  rollCheck: "v1",
  applyStatus: "v1",
  skipTurns: "v1",
  gainSalary: "v1",
  grantExtraRoll: "v1",
  attemptPromotion: "v1",
  auditConfinement: "v1",
  // `noEffect` is v1 by definition rather than by implementation. The v2
  // resolver has a case for it too and that case is also `return;` — routing it
  // would be a hand-off, an id and a trace entry to arrive at the identical
  // result, and it would make a caller with no routing context report a
  // deliberate no-op as an *unresolved* effect, which is the opposite of true.
  // It is the one authored verb whose correct behaviour is exactly `inert`.
  noEffect: "v1",

  // v2 — every one of §10.3's types plus the three the re-cut plan added.
  // `effects-v2/resolve.ts`'s `applyNewEffect` owns all of them.
  transferResource: "v2",
  modifyHeat: "v2",
  placeObject: "v2",
  claimTile: "v2",
  releaseTile: "v2",
  startProject: "v2",
  contributeToProject: "v2",
  sabotageProject: "v2",
  openBallot: "v2",
  grantImmunity: "v2",
  forceDiscard: "v2",
  swapBoardPositions: "v2",
  teleport: "v2",
  modifyUpkeep: "v2",
  openReactionWindow: "v2",
  grantIncomeStream: "v2",

  removeStatuses: "v2",
  chooseOne: "v2",
  opposedRoll: "v2",
} as const satisfies Readonly<Record<EffectDescriptor["type"], EffectRoutingTarget>>;

type EffectRoutingTarget = "v1" | "v2" | "unowned";

type EffectRouting = typeof EFFECT_ROUTING;

/**
 * The table lookup, widened to the full target union.
 *
 * A function rather than an annotated `const`, because TypeScript narrows a
 * `const` to its initialiser's type regardless of the annotation, which would
 * make the `"unowned"` guard a comparison with no overlap and therefore an
 * error. Widening here is what keeps that guard compilable while the category is
 * empty.
 */
function routingFor(effectType: EffectDescriptor["type"]): EffectRoutingTarget {
  return EFFECT_ROUTING[effectType];
}

type EffectTypesRoutedTo<TRouting extends EffectRouting[keyof EffectRouting]> = {
  [K in keyof EffectRouting]: EffectRouting[K] extends TRouting ? K : never;
}[keyof EffectRouting];

/** Every effect this file's own switch is responsible for handling. */
type V1EffectType = EffectTypesRoutedTo<"v1">;

/**
 * The residue of `applyOne`'s switch: everything the v1 path does not own.
 *
 * Written as an `Exclude` over the *content* union rather than as a hand-listed
 * union so that a newly authored type lands here automatically — and is then
 * caught by `EFFECT_ROUTING`'s missing key.
 */
type NonV1Effect = Exclude<EffectDescriptor, { readonly type: V1EffectType }>;

/**
 * Why an authored effect reached the walk and nothing applied it.
 *
 * `effectType` is the whole content union rather than `NonV1Effect["type"]`
 * because the compiler cannot see what the two guards that produce this
 * guarantee: a v1 type only reaches the reporting path via its envelope, and
 * that path is gated on a routing context existing. In practice every value here
 * is a non-v1 type; the wider annotation just avoids a cast that would assert it.
 */
export type UnresolvedEffect = {
  readonly effectType: EffectDescriptor["type"];
  readonly reason:
    /** A v2 effect met without a `V2RoutingContext`; the caller passed no game state. */
    | "no-routing-context"
    /** In the authored vocabulary, in neither resolver. `EFFECT_ROUTING`'s `"unowned"`. */
    | "unimplemented";
};

/**
 * What the v1 walk needs in order to hand an effect to `resolveEffectsV2`.
 *
 * The v1 walk is per-player and the v2 resolver is state-scoped, so routing
 * cannot happen without canonical state to route *into*. Callers that have one —
 * every game transition — should pass it; callers that genuinely do not (a unit
 * test resolving a tile against a bare `PlayerState`) may omit it, and any v2
 * effect they meet is reported through `unresolvedEffects` rather than applied.
 * It is never silently dropped and it never corrupts the player.
 *
 * `state.players[player.id]` is overwritten with the in-flight player before
 * each hand-off, so the v2 resolver sees the effects resolved so far on this
 * walk rather than the state the transition started from.
 */
export type V2RoutingContext = {
  readonly state: GameState;
  /** Whose effects these are. Not necessarily the player being walked. */
  readonly actorId: PlayerId;
  readonly options?: EffectsV2Options;
};

/** Everything a routed batch produced, folded across every hand-off in one walk. */
export type V2RoutingResult = EffectsV2Outcome;

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
  /**
   * Everything the v2 resolver did on behalf of this walk, or `null` when no
   * `V2RoutingContext` was supplied and nothing was routed.
   *
   * `v2.state` is canonical: it already carries the mutated players, the
   * appended `prompts`, `reactionWindows` and `pendingEffects`. Take it
   * **verbatim** — do not replay it from `v2.trace`, and do not merge `player`
   * back into it by hand, because `player` is already read out of it.
   *
   * `v2.changes` are deliberately *not* folded into `changes`/`trace`: they
   * carry a `playerId` the v1 shape cannot express, and a card that moves money
   * across the table produces resource changes on players this walk never
   * touched. A caller emitting `ResourceChanged` events has to drain both.
   */
  readonly v2: V2RoutingResult | null;
  /** Authored effects that reached the walk and were applied by nobody. */
  readonly unresolvedEffects: readonly UnresolvedEffect[];
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

/**
 * The parts of a walk that are the same at every node of the effect tree.
 *
 * Bundled rather than passed as four more positional parameters: `applyOne`
 * already carried seven, and the two the v2 seam adds (the sink and the
 * structural path) would have made the call sites unreadable. Purely internal —
 * no exported signature changes shape because of it.
 */
type WalkContext = {
  readonly random: RandomSource;
  readonly decks: readonly DeckConfig[];
  /** `null` when the caller supplied no `V2RoutingContext`. */
  readonly v2: V2Sink | null;
  /** Collects effects nothing applied, including when `v2` is null. */
  readonly unresolved: UnresolvedEffect[];
};

/**
 * The mutable accumulator for routed effects.
 *
 * Mutable on purpose, and consistent with `effects-v2/resolve.ts`'s own `Draft`:
 * a routed effect mutates whole-game state, which cannot be threaded back
 * through `Accumulated` (per-player by construction) without turning every
 * return in this file into a two-headed value. The sink is created once per
 * top-level entry point and read out into that entry point's own outcome, so
 * nothing escapes the call.
 */
type V2Sink = {
  readonly actorId: PlayerId;
  readonly options: EffectsV2Options;
  outcome: EffectsV2Outcome;
};

function emptyV2Outcome(state: GameState): EffectsV2Outcome {
  return {
    state,
    changes: [],
    trace: [],
    openedPrompts: [],
    openedReactionWindows: [],
    parkedEffects: [],
    storedEffects: [],
    grantedExtraRollPlayerIds: [],
    auditPromptPlayerIds: [],
    heatThresholdCrossedPlayerIds: [],
  };
}

function unionOfPlayerIds(
  first: readonly PlayerId[],
  second: readonly PlayerId[],
): readonly PlayerId[] {
  return [...first, ...second.filter((playerId) => !first.includes(playerId))];
}

/** Folds one hand-off's outcome onto everything the walk has routed so far. */
function foldV2Outcome(
  previous: EffectsV2Outcome,
  next: EffectsV2Outcome,
): EffectsV2Outcome {
  return {
    // Verbatim: the resolver already applied every mutation to it, including the
    // ones it inherited from `previous` via the state it was handed.
    state: next.state,
    changes: [...previous.changes, ...next.changes],
    trace: [...previous.trace, ...next.trace],
    openedPrompts: [...previous.openedPrompts, ...next.openedPrompts],
    openedReactionWindows: [
      ...previous.openedReactionWindows,
      ...next.openedReactionWindows,
    ],
    parkedEffects: [...previous.parkedEffects, ...next.parkedEffects],
    storedEffects: [...previous.storedEffects, ...next.storedEffects],
    grantedExtraRollPlayerIds: unionOfPlayerIds(
      previous.grantedExtraRollPlayerIds,
      next.grantedExtraRollPlayerIds,
    ),
    auditPromptPlayerIds: unionOfPlayerIds(
      previous.auditPromptPlayerIds,
      next.auditPromptPlayerIds,
    ),
    heatThresholdCrossedPlayerIds: unionOfPlayerIds(
      previous.heatThresholdCrossedPlayerIds,
      next.heatThresholdCrossedPlayerIds,
    ),
  };
}

/**
 * Closes a walk by writing its final player back into the routed state.
 *
 * Without this the two halves of the outcome disagree: `outcome.player` carries
 * every v1 effect *and* the post-walk bookkeeping (`negativeEffectsIgnoredThisLap`,
 * a consumed status), while `outcome.v2.state`'s copy of that same player was
 * last written by whichever routed effect happened to run last. Reconciling them
 * would be the caller's problem, and every caller would get it slightly
 * differently. Instead `v2.state` is made authoritative for everyone, and
 * `player` is a view of the same record.
 */
function sealV2Outcome(
  context: WalkContext,
  player: PlayerState,
): V2RoutingResult | null {
  const sink = context.v2;
  if (sink === null) return null;

  const outcome = sink.outcome;
  sink.outcome = {
    ...outcome,
    state: {
      ...outcome.state,
      players: { ...outcome.state.players, [player.id]: player },
    },
  };

  return sink.outcome;
}

function createWalkContext(
  random: RandomSource,
  decks: readonly DeckConfig[],
  routing: V2RoutingContext | null,
): WalkContext {
  return {
    random,
    decks,
    v2:
      routing === null
        ? null
        : {
            actorId: routing.actorId,
            options: routing.options ?? {},
            outcome: emptyV2Outcome(routing.state),
          },
    unresolved: [],
  };
}

/**
 * Whether an effect carries an envelope the v1 walk cannot honour.
 *
 * The effect *type* is only half of what decides who resolves something. §10.1
 * to §10.3 add `target`, `timing`, `preventable`, `condition` and `scale` to
 * **every** effect, including the twelve v1 ones — and a `modifyResource` aimed
 * at `all-opponents`, or guarded by a condition, or eligible for prevention, is
 * a whole-table operation however familiar its type is. The v1 walk holds one
 * `PlayerState` and would apply it to the wrong player, silently. So the
 * envelope routes as surely as the type does.
 *
 * Every clause is the documented default, spelled out rather than derived, so
 * adding a field to the envelope without deciding about it here shows up as an
 * effect that stops routing rather than as a type error somewhere else.
 *
 * The caller only consults this when a routing context exists. Without one the
 * effect falls through to the v1 switch and applies to the walked player, which
 * is exactly right on the path that produces it: `effects-v2`'s
 * `applyLegacyToTarget` has *already* resolved the envelope and calls back here
 * with the target it selected, still carrying the original `target` field.
 * Treating that as unresolved would report a gap on the one path that has none.
 */
function hasV2Envelope(effect: EffectDescriptor): boolean {
  if (effect.target !== undefined && effect.target !== "self") return true;
  if (effect.preventable === true) return true;
  if (effect.condition !== undefined) return true;
  if (effect.scale !== undefined) return true;

  return false;
}

/**
 * Hands one effect the v1 path does not own to `resolveEffectsV2`.
 *
 * The whole of the routing job, and deliberately thin: targeting, card-level
 * timing, conditions, immunity, prevention and every one of the new effect
 * types are the v2 resolver's, already built, and reimplementing any of it here
 * would give the game two answers to the same question.
 *
 * Two things this does own:
 *
 * 1. **Handing over the in-flight player.** The walk's `player` is ahead of
 *    `sink.outcome.state` — it has this tile's earlier effects on it, and in
 *    `roll-turn.ts`'s case a new board position and a paid salary that are not
 *    in canonical state yet. It is written into the state under its own id
 *    first, and read back out afterwards.
 * 2. **`path`.** Every id the v2 resolver mints (pending effects, prompts,
 *    windows) is derived from the effect's position in the authored tree, so two
 *    routed effects in one tile must not present the same position. The walk's
 *    structural path is passed as `pathPrefix`; the resolver appends its own
 *    index within the batch, which is always `0` here because each hand-off
 *    carries exactly one effect.
 *
 * Known, bounded gap: an `ignoreNegativeEffect` allowance partly spent earlier
 * in this same walk is not visible to the v2 resolver, which recomputes the
 * shield from `player.negativeEffectsIgnoredThisLap` — a counter this file only
 * writes back at the end of `resolveTileEffects`. A tile that both triggers the
 * passive and routes a `transferResource` can therefore over-shield by one. It
 * is recorded rather than papered over because fixing it means moving the
 * counter's write into the walk, which changes v1 behaviour.
 */
function routeEffectToV2(
  player: PlayerState,
  effect: EffectDescriptor,
  context: WalkContext,
  origin: EffectOrigin,
  path: string,
): Accumulated {
  if (routingFor(effect.type) === "unowned") {
    context.unresolved.push({ effectType: effect.type, reason: "unimplemented" });

    return inert(player);
  }

  const sink = context.v2;
  if (sink === null) {
    // Only reachable for a v2 *type*: an envelope-only hand-off is gated on the
    // sink existing (see `hasV2Envelope`'s note), because falling through to the
    // v1 switch is the right answer there and reporting it would be a lie.
    context.unresolved.push({ effectType: effect.type, reason: "no-routing-context" });

    return inert(player);
  }

  const previous = sink.outcome;
  const stateWithWalker: GameState = {
    ...previous.state,
    players: { ...previous.state.players, [player.id]: player },
  };

  const outcome = resolveEffectsV2({
    state: stateWithWalker,
    actorId: sink.actorId,
    // The content union is a structural subset of the v2 vocabulary — `EffectV2`
    // is declared as `EffectDescriptor` widened by the v2 envelope — so this is
    // a widening, not a re-interpretation.
    effects: [effect as EffectV2],
    random: context.random,
    options: {
      ...sink.options,
      // The walk's own decks unless the caller named others, so a routed
      // `drawCards` reads the same content the v1 half just drew from.
      decks: sink.options.decks ?? context.decks,
      // The walk's origin, not the caller's: `ignoreNegativeEffect` distinguishes
      // a tile from a card, and by here we know which one this effect came off.
      origin,
      pathPrefix: `${path}:`,
    },
  });

  sink.outcome = foldV2Outcome(previous, outcome);

  return {
    ...inert(outcome.state.players[player.id] ?? player),
    extraRoll: outcome.grantedExtraRollPlayerIds.includes(player.id),
    openAuditPrompt: outcome.auditPromptPlayerIds.includes(player.id),
  };
}

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
  context: WalkContext,
  depth: number,
  shield: NegativeEffectShield | null,
  origin: EffectOrigin,
  path: string,
): Accumulated {
  const random = context.random;
  const decks = context.decks;
  if (depth > MAX_EFFECT_RECURSION_DEPTH) {
    return inert(player);
  }

  // Before the shield, deliberately. The shield belongs to the player being
  // walked, and an enveloped effect may not be aimed at them at all — letting
  // their `ignoreNegativeEffect` allowance absorb a loss headed for somebody
  // else would spend a real resource on nothing. The v2 resolver applies each
  // target's own shield once it knows who the targets are.
  if (context.v2 !== null && hasV2Envelope(effect)) {
    return routeEffectToV2(player, effect, context, origin, path);
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

      const nested = applyMany(
        player,
        outcome.effects,
        context,
        depth + 1,
        shield,
        origin,
        `${path}.o`,
      );
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
          context,
          depth + 1,
          remainingShield,
          "card",
          `${path}.c${drawIndex}`,
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
    case "noEffect":
      // Declared, not accidental: two Clock Deck cards exist precisely to burn a
      // draw, and an empty `effects` array is indistinguishable from an
      // authoring mistake. Doing nothing is the whole behaviour.
      return inert(player);
    default: {
      // Everything the v1 vocabulary owns is handled above; everything else is
      // the v2 resolver's.
      //
      // The exhaustiveness this branch used to carry as `satisfies never` is now
      // in two places, and both still bite. This annotation is the first: the
      // switch narrows `effect` to the members no `case` claimed, and that
      // residue must be assignable to `NonV1Effect` — which `EFFECT_ROUTING`
      // derives — so deleting a `case` the table still calls `"v1"` fails to
      // compile here. The table itself is the second: it is keyed by
      // `EffectDescriptor["type"]`, so a type added to the content vocabulary and
      // left unclassified fails to compile there. Neither can be satisfied by
      // widening, and losing either brings back the failure mode this whole file
      // is arranged against — a tile that mysteriously does nothing.
      const unhandled: NonV1Effect = effect;

      return routeEffectToV2(player, unhandled, context, origin, path);
    }
  }
}

function applyMany(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  context: WalkContext,
  depth: number,
  shield: NegativeEffectShield | null,
  origin: EffectOrigin,
  path: string,
): Accumulated {
  let current = player;
  let remainingShield = shield;
  const changes: TileEffectChange[] = [];
  const trace: TileEffectTraceEntry[] = [];
  let extraRoll = false;
  let rolledDoubles = false;
  let openAuditPrompt = false;
  let ignoredNegativeEffects = 0;

  effects.forEach((effect, index) => {
    const result = applyOne(
      current,
      effect,
      context,
      depth,
      remainingShield,
      origin,
      `${path}.${index}`,
    );
    current = result.player;
    changes.push(...result.changes);
    trace.push(...result.trace);
    extraRoll = extraRoll || result.extraRoll;
    rolledDoubles = rolledDoubles || result.rolledDoubles;
    openAuditPrompt = openAuditPrompt || result.openAuditPrompt;
    ignoredNegativeEffects += result.ignoredNegativeEffects;
    remainingShield = spend(remainingShield, result.ignoredNegativeEffects);
  });

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
 *
 * `routing` is optional and, when omitted, a v2 effect in `effects` resolves to
 * nothing and is reported in `unresolvedEffects` — the caller has no canonical
 * state to route into, so there is nowhere for a targeted or table-scoped effect
 * to land.
 */
export function applyEffectDescriptors(
  player: PlayerState,
  effects: readonly EffectDescriptor[],
  random: RandomSource,
  decks: readonly DeckConfig[] = [],
  routing: V2RoutingContext | null = null,
): {
  readonly player: PlayerState;
  readonly changes: readonly TileEffectChange[];
  readonly trace: readonly TileEffectTraceEntry[];
  readonly v2: V2RoutingResult | null;
  readonly unresolvedEffects: readonly UnresolvedEffect[];
} {
  const context = createWalkContext(random, decks, routing);
  const result = applyMany(player, effects, context, 0, null, "tile", "e");

  return {
    player: result.player,
    changes: result.changes,
    trace: result.trace,
    v2: sealV2Outcome(context, result.player),
    unresolvedEffects: context.unresolved,
  };
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
  readonly v2: V2RoutingResult | null;
  readonly unresolvedEffects: readonly UnresolvedEffect[];
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
 *
 * `routing` is left at `null` by `effects-v2/resolve.ts`, and must be: the v2
 * resolver calls this to apply a *legacy* effect to one target, so a v2 effect
 * met here would have to be sent back to the resolver that is already running,
 * which is a mutual recursion rather than a resolution. Such an effect is
 * reported in `unresolvedEffects` instead — see `EFFECT_ROUTING`'s `"unowned"`
 * note, which is the only way one can arrive on this path.
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
  routing: V2RoutingContext | null = null,
): SelfEffectResolution {
  const context = createWalkContext(random, decks, routing);
  const result = applyMany(player, effects, context, 0, shield, origin, "e");

  return {
    player: result.player,
    changes: result.changes,
    trace: result.trace,
    grantedExtraRoll: result.extraRoll,
    openAuditPrompt: result.openAuditPrompt,
    ignoredNegativeEffects: result.ignoredNegativeEffects,
    v2: sealV2Outcome(context, result.player),
    unresolvedEffects: context.unresolved,
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
  routing: V2RoutingContext | null = null,
): TileEffectOutcome {
  const context = createWalkContext(random, decks, routing);

  if (findActiveStatus(player, "status.skip-next-tile-effect") !== null) {
    // Skipping the tile skips its question too: the player never arrives at the
    // decision, so nothing is offered and nothing is charged.
    const skipped = consumeStatus(player, "status.skip-next-tile-effect");

    return {
      player: skipped,
      changes: [],
      trace: [],
      grantedExtraRoll: false,
      openAuditPrompt: false,
      openDecision: null,
      ignoredNegativeEffects: 0,
      v2: sealV2Outcome(context, skipped),
      unresolvedEffects: context.unresolved,
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
  const result = applyMany(effectivePlayer, effectiveEffects, context, 0, shield, "tile", "tile");
  const passive = applyCharacterPassive(result.player, characterPassive, tileKind, result.rolledDoubles);

  const offer = decision !== undefined && canAfford(passive.player, decision);
  // An unaffordable offer is never put to the player; the decline branch is
  // what would have happened anyway, so it resolves immediately.
  const unaffordable =
    decision !== undefined && !offer
      ? applyMany(
          passive.player,
          decision.decline.effects,
          context,
          0,
          spend(shield, result.ignoredNegativeEffects),
          "tile",
          "decline",
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
  const settledPlayer =
    ignoredNegativeEffects > 0
      ? {
          ...finalPlayer,
          negativeEffectsIgnoredThisLap:
            finalPlayer.negativeEffectsIgnoredThisLap + ignoredNegativeEffects,
        }
      : finalPlayer;

  return {
    player: settledPlayer,
    changes,
    trace,
    grantedExtraRoll: result.extraRoll,
    openAuditPrompt: result.openAuditPrompt,
    openDecision: offer && decision !== undefined ? decision : null,
    ignoredNegativeEffects,
    v2: sealV2Outcome(context, settledPlayer),
    unresolvedEffects: context.unresolved,
  };
}
