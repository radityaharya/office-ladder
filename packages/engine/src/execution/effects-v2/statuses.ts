import { createStableId, type JsonObject, type PlayerStatusState } from "../../model";
import type {
  EffectImmunityScope,
  EffectPolarity,
  EffectStatusFilter,
  EffectV2,
} from "./vocabulary";

/**
 * Status **provenance**, and the two verbs that need it.
 *
 * The re-cut plan's §3.5 is blunt about why this exists: *"'remove all negative
 * Work card effects' is an unevaluable predicate without both of these reaching
 * `PlayerStatusState`."* `removeStatuses` is not a missing verb, it is a verb
 * with nothing to filter on — so provenance has to land first or the verb is
 * decoration.
 *
 * ## Why provenance lives in `PlayerStatusState.data` and not as two new fields
 *
 * `PlayerStatusState` is declared in `packages/engine/src/model/game.ts`, which
 * this agent does not own. `data: JsonObject` is the field that exists precisely
 * for per-status payload, it round-trips through the repository's
 * `JSON.parse(JSON.stringify(…))` boundary unchanged, and it is already how
 * `status.burnout-tile` carries its `movementPenalty`. The two keys below are
 * namespaced so they cannot collide with an authored `parameters` key.
 *
 * Promoting them to first-class `polarity` / `sourceDeckId` fields on
 * `PlayerStatusState` is the right end state and is recorded as a hand-off, not
 * skipped: it would let the projection layer render "this is a debuff" without
 * reaching into `data`. Nothing about this module's behaviour changes when it
 * happens — `statusPolarity` and `statusSourceDeckId` become one-line reads.
 */

/** Reserved `data` keys. Namespaced so an authored parameter cannot collide. */
export const STATUS_POLARITY_KEY = "v2:polarity";
export const STATUS_SOURCE_DECK_KEY = "v2:sourceDeckId";

/** The scope a `grantImmunity` charge was granted with, parked on its status. */
export const IMMUNITY_SCOPE_KEY = "v2:immunityScope";

export function statusPolarity(status: PlayerStatusState): EffectPolarity | null {
  const value = status.data[STATUS_POLARITY_KEY];

  return value === "positive" || value === "negative" ? value : null;
}

export function statusSourceDeckId(status: PlayerStatusState): string | null {
  const value = status.data[STATUS_SOURCE_DECK_KEY];

  return typeof value === "string" ? value : null;
}

/**
 * Builds the `data` payload for a status, folding provenance in beside the
 * authored `parameters`.
 *
 * `sourceDeckId` is taken from the effect when the author wrote one and from the
 * resolving deck otherwise — §3.5 notes it *can* be inferred where `polarity`
 * cannot, and inferring it is what makes `grantImmunity`'s `sourceDeckId` scope
 * work against cards whose author did not repeat themselves.
 */
export function statusData(
  parameters: Readonly<Record<string, number | string | boolean>> | undefined,
  polarity: EffectPolarity | undefined,
  sourceDeckId: string | null,
): JsonObject {
  const data: Record<string, string | number | boolean> = { ...(parameters ?? {}) };
  if (polarity !== undefined) data[STATUS_POLARITY_KEY] = polarity;
  if (sourceDeckId !== null) data[STATUS_SOURCE_DECK_KEY] = sourceDeckId;

  return data;
}

/**
 * Whether a status matches a `removeStatuses` filter.
 *
 * **Fails closed on missing provenance.** A filter that names a polarity does
 * not match a status that never declared one — an untagged status could be
 * anything, and silently stripping it would let a card that reads "clear one
 * penalty" clear a benefit instead. An empty filter (no clauses at all) matches
 * everything, which is the only reading of "remove statuses" with no qualifier.
 */
export function statusMatchesFilter(
  status: PlayerStatusState,
  filter: EffectStatusFilter,
): boolean {
  if (filter.statusId !== undefined && status.id !== filter.statusId) return false;
  if (filter.polarity !== undefined && statusPolarity(status) !== filter.polarity) return false;
  if (
    filter.sourceDeckId !== undefined &&
    statusSourceDeckId(status) !== filter.sourceDeckId
  ) {
    return false;
  }

  return true;
}

/**
 * Applies `removeStatuses`, honouring `limit`.
 *
 * Removal walks `player.statuses` in array order, which is insertion order and
 * stable across a JSON round trip — so "remove one negative Work status" removes
 * the *oldest* matching one, deterministically, rather than whichever the
 * iteration happened to reach first.
 */
export function removeMatchingStatuses(
  statuses: readonly PlayerStatusState[],
  filter: EffectStatusFilter,
  limit: number | undefined,
): { readonly statuses: readonly PlayerStatusState[]; readonly removed: readonly string[] } {
  const budget = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(0, limit);
  const kept: PlayerStatusState[] = [];
  const removed: string[] = [];

  for (const status of statuses) {
    if (removed.length < budget && statusMatchesFilter(status, filter)) {
      removed.push(status.id);
      continue;
    }
    kept.push(status);
  }

  return { statuses: kept, removed };
}

/* ------------------------------------------------------------- immunity */

/**
 * How an immunity was scoped, read back off the status it was written to.
 *
 * Returns `null` when nothing is stored — which the matcher treats as "blocks
 * any hostile effect", preserving the behaviour `grantImmunity` had before it
 * grew a declared scope.
 */
export function immunityScope(status: PlayerStatusState): EffectImmunityScope | null {
  const stored = status.data[IMMUNITY_SCOPE_KEY];
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;

  const raw = stored as JsonObject;
  const resource = raw["resource"];
  const direction = raw["direction"];
  const effectTypes = raw["effectTypes"];
  const sourceDeckId = raw["sourceDeckId"];

  const types: string[] = [];
  if (Array.isArray(effectTypes)) {
    for (const entry of effectTypes) {
      if (typeof entry === "string") types.push(entry);
    }
  }

  return {
    ...(typeof resource === "string"
      ? { resource: resource as NonNullable<EffectImmunityScope["resource"]> }
      : {}),
    ...(direction === "loss" || direction === "gain" ? { direction } : {}),
    ...(types.length > 0 ? { effectTypes: types } : {}),
    ...(typeof sourceDeckId === "string"
      ? { sourceDeckId: sourceDeckId as NonNullable<EffectImmunityScope["sourceDeckId"]> }
      : {}),
  };
}

/** The resource an effect moves, when it moves exactly one. */
function affectedResource(effect: EffectV2): string | null {
  switch (effect.type) {
    case "modifyResource":
    case "transferResource":
      return effect.resource;
    case "payResource":
      return "money";
    case "restoreResourceToMaximum":
      return effect.resource;
    case "incrementWorkCounter":
      return "work-counter";
    default:
      return null;
  }
}

/** Whether an effect takes the resource away from whoever it lands on. */
function isResourceLoss(effect: EffectV2): boolean {
  switch (effect.type) {
    case "modifyResource":
      return effect.amount < 0;
    case "payResource":
      return effect.amount > 0;
    case "transferResource":
      // A steal is a loss for the target; a gift is a gain for them.
      return (effect.direction ?? "target-to-actor") === "target-to-actor";
    default:
      return false;
  }
}

/**
 * Whether one immunity charge covers this effect.
 *
 * Every clause present in the scope must hold; clauses that are absent do not
 * constrain. An entirely empty scope covers any effect aimed at the holder,
 * which is the pre-§3.4 behaviour and the safe reading of "you are protected".
 */
export function immunityCovers(
  scope: EffectImmunityScope | null,
  effect: EffectV2,
  sourceDeckId: string | null,
): boolean {
  if (scope === null) return true;

  if (scope.effectTypes !== undefined && !scope.effectTypes.includes(effect.type)) {
    return false;
  }
  if (scope.resource !== undefined && affectedResource(effect) !== scope.resource) {
    return false;
  }
  if (scope.direction !== undefined) {
    const isLoss = isResourceLoss(effect);
    if (scope.direction === "loss" && !isLoss) return false;
    if (scope.direction === "gain" && isLoss) return false;
  }
  if (scope.sourceDeckId !== undefined && sourceDeckId !== scope.sourceDeckId) {
    return false;
  }

  return true;
}

/** Mints the `StatusId` brand for a raw id string. */
export function statusId(raw: string) {
  return createStableId("StatusId", raw);
}
