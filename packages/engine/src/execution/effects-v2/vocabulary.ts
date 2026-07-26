import type { EffectDescriptor } from "@office-ladder/content";

import type { JsonObject } from "../../model";
import type { PlacementKind, PlayerId, TileId } from "../../model";
import type { ResourceKey } from "../resolve-tile-effects";

/**
 * Gameplay v2's effect vocabulary — plans/24-gameplay-v2-spec.md §10.
 *
 * ## Why this lives in the engine rather than in `@office-ladder/content`
 *
 * §10 grows the *authored* vocabulary, and the authored vocabulary's home is
 * `packages/content/src/schema/effects.ts`. That file is owned by the content
 * wave and is not this agent's to edit, so the types are declared here as a
 * strict **superset** of the content union: `EffectV2` is
 * `EffectDescriptor | EffectV2Descriptor`, each member widened with the shared
 * envelope. Every card and tile authored today is already an `EffectV2` with no
 * change at all — `target` defaults to `"self"`, `timing` to `"immediate"`,
 * `preventable` to `false` and `condition` to absent, which is exactly the
 * behaviour the v1 resolver has.
 *
 * When content adopts §10 natively it should move these declarations across and
 * re-export them; nothing else in this directory has to change, because the
 * resolver consumes the structural shape rather than the nominal type.
 */

/**
 * Who an effect lands on. §10.1.
 *
 * Every derived target (`highest-rank`, `richest`, …) breaks ties by
 * `GameState.playerOrder` and **never** by object-key iteration over
 * `GameState.players`: key order is not a stable contract across the
 * repository's `JSON.parse(JSON.stringify(…))` boundary, so a tie-break that
 * read it would silently change which player an effect hit after a reload.
 */
export type EffectTarget =
  | "self"
  | "active-player"
  /** The actor picks. Opens a `PromptState`; never resolved silently. */
  | "chosen-opponent"
  | "all-opponents"
  | "all-players"
  | "left-neighbour"
  | "right-neighbour"
  | "highest-rank"
  | "lowest-rank"
  | "richest"
  | "poorest";

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

/** §10.2. */
export type EffectTiming =
  /** Resolves on draw or on play — v1's only behaviour, and the default. */
  | "immediate"
  /** Enters the hand and is played later on your own turn. Needs `agency.handEnabled`. */
  | "stored"
  /** Playable out of turn into an open window. Needs `interaction.reactionWindows`. */
  | "reaction";

export const EFFECT_TIMINGS: readonly EffectTiming[] = ["immediate", "stored", "reaction"];

/** Whose state a condition clause reads. */
export type EffectConditionSubject = "actor" | "target";

/**
 * The `condition` guard of §10.3, given a concrete grammar.
 *
 * The spec types it as a bare `JsonObject`, which is unusable as written: a
 * guard nothing can evaluate is a guard that does not guard. This is that
 * `JsonObject`, narrowed — every member is JSON-shaped, so an authored condition
 * round-trips through the repository unchanged and `parseEffectCondition`
 * accepts it back.
 *
 * Unparseable conditions **fail closed** (the effect does not apply). An
 * effect whose guard cannot be understood must not fire; the alternative is a
 * typo in content silently arming an unconditional effect.
 */
export type EffectCondition =
  | { readonly kind: "always" }
  | { readonly kind: "never" }
  | {
      readonly kind: "resourceAtLeast";
      readonly who: EffectConditionSubject;
      readonly resource: string;
      readonly amount: number;
    }
  | {
      readonly kind: "resourceAtMost";
      readonly who: EffectConditionSubject;
      readonly resource: string;
      readonly amount: number;
    }
  | {
      readonly kind: "rankIndexAtLeast";
      readonly who: EffectConditionSubject;
      readonly index: number;
    }
  | {
      readonly kind: "rankIndexAtMost";
      readonly who: EffectConditionSubject;
      readonly index: number;
    }
  | {
      readonly kind: "heatAtLeast";
      readonly who: EffectConditionSubject;
      readonly value: number;
    }
  | {
      readonly kind: "hasStatus";
      readonly who: EffectConditionSubject;
      readonly statusId: string;
    }
  | {
      readonly kind: "ownsTile";
      readonly who: EffectConditionSubject;
      /** `null` = the tile the subject is standing on. */
      readonly tileId: string | null;
    }
  | { readonly kind: "roundAtLeast"; readonly round: number }
  | { readonly kind: "quarterIndex"; readonly index: number }
  | { readonly kind: "not"; readonly of: EffectCondition }
  | { readonly kind: "all"; readonly of: readonly EffectCondition[] }
  | { readonly kind: "any"; readonly of: readonly EffectCondition[] };

/**
 * The four fields §10.1/§10.2/§10.3 add to *every* effect. All optional, and
 * every default reproduces v1 behaviour exactly.
 */
export type EffectEnvelope = {
  readonly target?: EffectTarget;
  readonly timing?: EffectTiming;
  /**
   * May a reaction cancel this? Default false.
   *
   * `true` is the *only* thing that makes an effect eligible to raise a
   * `ReactionWindowState` carrying a `pendingEffectId` — see `pending.ts`.
   */
  readonly preventable?: boolean;
  readonly condition?: EffectCondition | null;
};

/** Where a placed object lands. `null` = the tile the actor is standing on. */
type TileRef = TileId | null;

/**
 * The thirteen rows of §10.3's table, as sixteen discriminated members (the
 * table groups `claimTile`/`releaseTile`, the three project verbs, and
 * `swapBoardPositions`/`teleport` onto one row each).
 */
export type EffectV2Descriptor =
  /** Move a resource from the target to the actor. The steal primitive. */
  | {
      readonly type: "transferResource";
      readonly resource: ResourceKey;
      readonly amount: number;
      /** Default: transfer whatever the target actually has. */
      readonly insufficientFunds?: "transfer-up-to-available" | "all-or-nothing";
    }
  /** Raise or lower suspicion. Every aggressive effect must carry one (§10.4). */
  | {
      readonly type: "modifyHeat";
      readonly amount: number;
    }
  | {
      readonly type: "placeObject";
      readonly placementKind: PlacementKind;
      readonly tileId?: TileRef;
      readonly charges?: number;
      readonly visibility?: "public" | "owner-only";
      readonly data?: JsonObject;
    }
  | {
      readonly type: "claimTile";
      readonly tileId?: TileRef;
      /** Multiplied by `rules.board.claimCostMultiplier` to get the real price. */
      readonly baseCost: number;
    }
  | {
      readonly type: "releaseTile";
      readonly tileId?: TileRef;
    }
  | {
      readonly type: "startProject";
      readonly definitionId: string;
      readonly requiredMoney: number;
      readonly requiredWork: number;
      readonly payout: {
        readonly money: number;
        readonly reputation: number;
        readonly objectiveProgress: number;
      };
      readonly tileId?: TileRef;
      readonly openToJoin?: boolean;
      readonly leadBonusBasisPoints?: number;
      /** Default: `rules.projects.deadlineRounds`. */
      readonly deadlineRounds?: number;
    }
  | {
      readonly type: "contributeToProject";
      /** `null` = the contributor's own open project, else the one on their tile. */
      readonly projectId?: string | null;
      readonly money: number;
      readonly work: number;
    }
  | {
      readonly type: "sabotageProject";
      /** `null` = the first open project the actor does not lead. */
      readonly projectId?: string | null;
      readonly amount: number;
      readonly hidden?: boolean;
    }
  | {
      readonly type: "openBallot";
      readonly ballotKind: "vote" | "auction";
      readonly subjectId: string;
      readonly subject?: JsonObject;
      readonly closesInRounds?: number;
      readonly visibility?: "open" | "sealed";
    }
  /** Blocks the next N *preventable* effects targeting this player. */
  | {
      readonly type: "grantImmunity";
      readonly charges?: number;
      readonly rounds?: number;
    }
  | {
      readonly type: "forceDiscard";
      readonly count: number;
    }
  | {
      readonly type: "swapBoardPositions";
    }
  | {
      readonly type: "teleport";
      readonly destination:
        | { readonly kind: "tileIndex"; readonly index: number }
        | { readonly kind: "tileId"; readonly tileId: TileId };
    }
  | {
      readonly type: "modifyUpkeep";
      readonly amount: number;
    }
  /** Explicitly raise a window. Pairs with `preventable` (§10.3). */
  | {
      readonly type: "openReactionWindow";
      readonly windowKind: "prevention" | "end-turn" | "promotion-block";
    }
  | {
      readonly type: "grantIncomeStream";
      readonly streamKind: "asset" | "rent" | "project" | "side-gig";
      readonly perRound: number;
      readonly remainingRounds: number | null;
      readonly sourceId?: string | null;
    };

/** Distributes the envelope across a union so `.type` still narrows. */
type WithEnvelope<T> = T extends unknown ? T & EffectEnvelope : never;

/** A v1 authored effect, read through the v2 envelope. */
export type LegacyEffectV2 = WithEnvelope<EffectDescriptor>;

/** Everything §10.3 adds, read through the v2 envelope. */
export type NewEffectV2 = WithEnvelope<EffectV2Descriptor>;

/**
 * The full v2 vocabulary: every v1 effect plus every v2 effect, each carrying
 * the shared envelope.
 */
export type EffectV2 = LegacyEffectV2 | NewEffectV2;

const NEW_EFFECT_TYPES: ReadonlySet<string> = new Set<EffectV2Descriptor["type"]>([
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
]);

/** Every §10.3 type, in declaration order. Exported for content validation. */
export const EFFECT_V2_TYPES: readonly EffectV2Descriptor["type"][] = [
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
];

/** True when the effect is one of §10.3's new types rather than a v1 effect. */
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
 *    aggressive effect must carry a `modifyHeat` on the actor — so a content
 *    test can enforce that rule mechanically rather than by review.
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
    case "skipTurns":
    case "auditConfinement":
    case "applyStatus":
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
      effect.type === "modifyHeat" &&
      effect.amount > 0 &&
      effectTarget(effect) === "self",
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSubject(value: unknown): EffectConditionSubject | null {
  return value === "actor" || value === "target" ? value : null;
}

function parseNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Reads a `condition` back out of the loose `JsonObject` the spec stores it as.
 *
 * Returns `null` for anything it does not recognise, which the resolver treats
 * as "do not apply" — see `EffectCondition`'s fail-closed note.
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
      const resource = value["resource"];
      const amount = parseNumber(value["amount"]);
      if (who === null || typeof resource !== "string" || amount === null) return null;

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
      const statusId = value["statusId"];
      if (who === null || typeof statusId !== "string") return null;

      return { kind, who, statusId };
    }
    case "ownsTile": {
      const who = parseSubject(value["who"]);
      const tileId = value["tileId"];
      if (who === null || (tileId !== null && typeof tileId !== "string")) return null;

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
