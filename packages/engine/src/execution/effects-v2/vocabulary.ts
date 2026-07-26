import type { PlayerId } from "../../model";

import type {
  AdvancedEffectDescriptor,
  CoreEffectDescriptor,
  EffectChoiceOption,
  EffectCondition as ContentEffectCondition,
  EffectConditionSubject as ContentEffectConditionSubject,
  EffectEnvelope as ContentEffectEnvelope,
  EffectImmunityScope,
  EffectPolarity,
  EffectScale,
  EffectScaleMetric,
  EffectStatusFilter,
  EffectTarget as ContentEffectTarget,
  EffectTiming as ContentEffectTiming,
} from "@office-ladder/content";

/**
 * Gameplay v2's effect vocabulary — plans/24-gameplay-v2-spec.md §10, plus the
 * re-cut plan's §3 amendments.
 *
 * ## This file used to *declare* the vocabulary. It no longer does.
 *
 * The original version carried a hand-written superset of the content union,
 * with a note saying: *"When content adopts §10 natively it should move these
 * declarations across and re-export them; nothing else in this directory has to
 * change, because the resolver consumes the structural shape rather than the
 * nominal type."*
 *
 * Content has now adopted §10 natively — `packages/content/src/schema/effects.ts`
 * declares `target` / `preventable` / `condition` / `scale` on every effect and
 * all twenty §10.3+§3+§11 types. Keeping a second declaration here stopped being
 * belt-and-braces and became a *divergence*: `grantImmunity` was `{charges,
 * rounds}` here and `{count, duration, scope}` there, `transferResource` had no
 * `direction`, and `EffectCondition.resource` was `string` here against
 * `ResourceId | "work-counter"` there. The intersection of the two envelopes made
 * an authored condition literal fail to typecheck at all.
 *
 * So this module is now a **thin alias layer** over the content declarations. It
 * exists for three reasons that a bare re-export would not serve:
 *
 * 1. `timing` — §10.5 moved timing onto `DeckCard`, but the resolver still has to
 *    honour one when a caller attaches it to a single effect (the hand mechanic
 *    resolves a stored effect list, not a card). That one field is added here and
 *    nowhere else.
 * 2. The runtime tables (`EFFECT_V2_TYPES`, `EFFECT_TARGETS`, …) that content
 *    validation and the resolver's own dispatch read.
 * 3. The predicates (`isNewEffect`, `isAggressiveEffectShape`, …) that decide
 *    which half of the resolver an effect goes to.
 *
 * Adding an effect type to content is still a **compile error** here and in
 * `resolve.ts` — the `satisfies never` in both switches is what makes a new
 * authored verb impossible to ship as a silent no-op, and that is deliberately
 * load-bearing.
 */

/** §10.1. Re-exported from content; the engine adds nothing. */
export type EffectTarget = ContentEffectTarget;

export const EFFECT_TARGETS: readonly EffectTarget[] = [
  "self",
  "active-player",
  "chosen-opponent",
  "all-opponents",
  "all-players",
  "left-neighbour",
  "right-neighbour",
  "highest-rank",
  "lowest-rank",
  "richest",
  "poorest",
];

/** §10.2. Attached to `DeckCard` by content; attachable per-effect here. */
export type EffectTiming = ContentEffectTiming;

export const EFFECT_TIMINGS: readonly EffectTiming[] = ["immediate", "stored", "reaction"];

/** Whose state a condition clause or a `scale` metric reads. */
export type EffectConditionSubject = ContentEffectConditionSubject;

/** §10.3's guard, as the closed grammar `conditions.ts` evaluates. */
export type EffectCondition = ContentEffectCondition;

export type { EffectChoiceOption, EffectImmunityScope, EffectPolarity, EffectScale, EffectScaleMetric, EffectStatusFilter };

/**
 * The envelope, plus the one field the engine adds.
 *
 * `timing` is not in content's envelope on purpose (§10.5 puts it on the card).
 * The resolver still reads it, because a *stored* effect list handed back by the
 * hand mechanic has no card around it any more, and because the deck-construction
 * filter (`isCardPlayableUnderRules`) is stated in terms of effects.
 */
export type EffectEnvelope = ContentEffectEnvelope & {
  readonly timing?: EffectTiming;
};

/** Distributes the envelope across a union so `.type` still narrows. */
type WithEnvelope<T> = T extends unknown ? T & EffectEnvelope : never;

/** Everything §10.3, §3 and §11 add, read through the envelope. */
export type EffectV2Descriptor = AdvancedEffectDescriptor;

/** A v1 authored effect, read through the v2 envelope. */
export type LegacyEffectV2 = WithEnvelope<CoreEffectDescriptor>;

/** Everything beyond v1, read through the v2 envelope. */
export type NewEffectV2 = WithEnvelope<AdvancedEffectDescriptor>;

/**
 * The full v2 vocabulary. Structurally identical to content's
 * `EffectDescriptor`, widened only by the optional engine-side `timing`, so an
 * authored `EffectDescriptor` is assignable here without a cast and vice versa.
 */
export type EffectV2 = LegacyEffectV2 | NewEffectV2;

/**
 * Every non-v1 type, in declaration order. Exported for content validation.
 *
 * The `satisfies` clause is the enforcement: adding a member to
 * `AdvancedEffectDescriptor` without listing it here fails to compile, and
 * listing one that is not in the union fails too.
 */
export const EFFECT_V2_TYPES = [
  "transferResource",
  "modifyHeat",
  "placeObject",
  "claimTile",
  "releaseTile",
  "startProject",
  "contributeToProject",
  "sabotageProject",
  "openBallot",
  "grantImmunity",
  "forceDiscard",
  "swapBoardPositions",
  "teleport",
  "modifyUpkeep",
  "openReactionWindow",
  "grantIncomeStream",
  "removeStatuses",
  "chooseOne",
  "noEffect",
  "opposedRoll",
] as const satisfies readonly AdvancedEffectDescriptor["type"][];

const NEW_EFFECT_TYPES: ReadonlySet<string> = new Set<string>(EFFECT_V2_TYPES);

/**
 * Exhaustiveness in the other direction. `satisfies` above proves every listed
 * name is a real type; this proves every real type is listed. Without it a new
 * content verb would be classified as *legacy* and routed into the v1 resolver,
 * which is exactly the silent no-op the `satisfies never` guards exist to
 * prevent.
 */
type AssertEmpty<T extends never> = T;
export type EveryAdvancedTypeIsListed = AssertEmpty<
  Exclude<AdvancedEffectDescriptor["type"], (typeof EFFECT_V2_TYPES)[number]>
>;

/** True when the effect is one of the new types rather than a v1 effect. */
export function isNewEffect(effect: EffectV2): effect is NewEffectV2 {
  return NEW_EFFECT_TYPES.has(effect.type);
}

/** True when the effect is a v1 effect the per-player resolver already handles. */
export function isLegacyEffect(effect: EffectV2): effect is LegacyEffectV2 {
  return !NEW_EFFECT_TYPES.has(effect.type);
}

/** An effect's target, with §10.1's documented default applied. */
export function effectTarget(effect: EffectV2): EffectTarget {
  return effect.target ?? "self";
}

/** An effect's timing, with §10.2's documented default applied. */
export function effectTiming(effect: EffectV2): EffectTiming {
  return effect.timing ?? "immediate";
}

/** Whether an effect may be cancelled by a reaction. Default false (§10.3). */
export function isPreventable(effect: EffectV2): boolean {
  return effect.preventable === true;
}

/**
 * Whether an effect is *aggressive* in §10.4's sense when it lands on
 * `targetId` on behalf of `actorId`.
 *
 * Two independent jobs:
 *
 * 1. It gates cross-player hostility on `rules.conflict.targetedAttacks`, so a
 *    mode with attacks switched off cannot be attacked through by an authored
 *    card.
 * 2. It is the predicate §10.4's authoring rule is stated in terms of — every
 *    aimed aggressive effect must carry a `modifyHeat` on the actor — so a
 *    content test can enforce that rule mechanically rather than by review.
 *
 * Self-directed effects are never aggressive, however negative: paying your own
 * upkeep is not an attack.
 */
export function isAggressiveEffect(
  effect: EffectV2,
  actorId: PlayerId,
  targetId: PlayerId,
): boolean {
  if (actorId === targetId) return false;

  return isAggressiveEffectShape(effect);
}

/**
 * The id-free half of `isAggressiveEffect`: would this effect be hostile *if* it
 * landed on somebody other than the actor? Used by the authoring check below,
 * which reasons about a card before any player ids exist.
 */
export function isAggressiveEffectShape(effect: EffectV2): boolean {
  switch (effect.type) {
    case "transferResource":
      // §3.8: `actor-to-target` is the *gift* direction — `card.event.coffee-treat`
      // buys the table a round. Charging heat for it would be charging heat for
      // generosity, and §5.1 is explicit that over-charging is as much a defect
      // as under-charging.
      return (effect.direction ?? "target-to-actor") === "target-to-actor";
    case "forceDiscard":
    case "sabotageProject":
    case "swapBoardPositions":
    case "teleport":
      return true;
    case "modifyResource":
      return effect.amount < 0;
    case "payResource":
      return effect.amount > 0;
    case "modifyUpkeep":
      return effect.amount > 0;
    case "modifyHeat":
      return effect.amount > 0;
    case "applyStatus":
      // Provenance makes this answerable instead of assumed. A status with no
      // authored polarity keeps the old, conservative answer.
      return effect.polarity !== "positive";
    case "skipTurns":
    case "auditConfinement":
      return true;
    case "chooseOne":
      // A branch is only ever offered, never forced — but if *every* branch is
      // hostile the choice is between two attacks, and the card should pay for
      // it. An escape hatch branch (one benign option) makes it benign.
      return (
        effect.options.length > 0 &&
        effect.options.every((option) => option.effects.some(isAggressiveEffectShape))
      );
    case "opposedRoll":
      return true;
    default:
      return false;
  }
}

/**
 * Whether a list of effects satisfies §10.4: every aggressive effect it
 * contains is accompanied by a `modifyHeat` that raises the actor's suspicion.
 *
 * Exported for the content-authoring wave to assert over authored decks. The
 * resolver deliberately does **not** enforce it at runtime — silently inventing
 * heat an author did not write would make the authored number a lie, and
 * double-charge every card that does carry one.
 */
export function carriesHeatForAggression(effects: readonly EffectV2[]): boolean {
  const hasAggression = effects.some(
    (effect) => effectTarget(effect) !== "self" && isAggressiveEffectShape(effect),
  );
  if (!hasAggression) return true;

  return effects.some(
    (effect) =>
      effect.type === "modifyHeat" && effect.amount > 0 && effectTarget(effect) === "self",
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSubject(value: unknown): EffectConditionSubject | null {
  return value === "actor" || value === "target" ? value : null;
}

function parseNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type ConditionOf<Kind extends EffectCondition["kind"]> = Extract<EffectCondition, { kind: Kind }>;

const CONDITION_RESOURCES: readonly ConditionOf<"resourceAtLeast">["resource"][] = [
  "money",
  "reputation",
  "energy",
  "work-counter",
];

function parseConditionResource(
  value: unknown,
): ConditionOf<"resourceAtLeast">["resource"] | null {
  return CONDITION_RESOURCES.find((candidate) => candidate === value) ?? null;
}

/**
 * `StatusId` and `TileId` are closed/templated unions in content, so there is no
 * runtime list to check against without importing the content pack. Prefix
 * checks are what is actually available, and they are enough: an id that passes
 * the prefix but names nothing simply finds no status / no tile, which is the
 * same fail-closed outcome as rejecting it.
 */
function parseStatusId(value: unknown): ConditionOf<"hasStatus">["statusId"] | null {
  return typeof value === "string" && value.startsWith("status.")
    ? (value as ConditionOf<"hasStatus">["statusId"])
    : null;
}

function parseTileId(value: unknown): ConditionOf<"ownsTile">["tileId"] | null | "invalid" {
  if (value === null) return null;

  return typeof value === "string" && value.startsWith("tile.")
    ? (value as ConditionOf<"ownsTile">["tileId"])
    : "invalid";
}

/**
 * Reads a `condition` back out of the loose JSON the repository stores it as.
 *
 * Returns `null` for anything it does not recognise, which the resolver treats
 * as "do not apply" — a typo in content must never silently arm an
 * unconditional effect.
 */
export function parseEffectCondition(value: unknown): EffectCondition | null {
  if (!isJsonObject(value)) return null;

  const kind = value["kind"];
  switch (kind) {
    case "always":
    case "never":
      return { kind };
    case "resourceAtLeast":
    case "resourceAtMost": {
      const who = parseSubject(value["who"]);
      const resource = parseConditionResource(value["resource"]);
      const amount = parseNumber(value["amount"]);
      if (who === null || resource === null || amount === null) return null;

      return { kind, who, resource, amount };
    }
    case "rankIndexAtLeast":
    case "rankIndexAtMost": {
      const who = parseSubject(value["who"]);
      const index = parseNumber(value["index"]);
      if (who === null || index === null) return null;

      return { kind, who, index };
    }
    case "heatAtLeast": {
      const who = parseSubject(value["who"]);
      const heat = parseNumber(value["value"]);
      if (who === null || heat === null) return null;

      return { kind, who, value: heat };
    }
    case "hasStatus": {
      const who = parseSubject(value["who"]);
      const statusId = parseStatusId(value["statusId"]);
      if (who === null || statusId === null) return null;

      return { kind, who, statusId };
    }
    case "ownsTile": {
      const who = parseSubject(value["who"]);
      const tileId = parseTileId(value["tileId"]);
      if (who === null || tileId === "invalid") return null;

      return { kind, who, tileId };
    }
    case "roundAtLeast": {
      const round = parseNumber(value["round"]);
      if (round === null) return null;

      return { kind, round };
    }
    case "quarterIndex": {
      const index = parseNumber(value["index"]);
      if (index === null) return null;

      return { kind, index };
    }
    case "not": {
      const of = parseEffectCondition(value["of"]);
      if (of === null) return null;

      return { kind, of };
    }
    case "all":
    case "any": {
      const of = value["of"];
      if (!Array.isArray(of)) return null;
      const parsed: EffectCondition[] = [];
      for (const entry of of) {
        const condition = parseEffectCondition(entry);
        if (condition === null) return null;
        parsed.push(condition);
      }

      return { kind, of: parsed };
    }
    default:
      return null;
  }
}
