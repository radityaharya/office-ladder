/**
 * Gameplay v2's effect resolver — plans/24-gameplay-v2-spec.md §10.
 *
 * Foundational: several other v2 mechanics resolve *through* this module, so
 * everything here is additive. `resolve-tile-effects.ts`'s `resolveTileEffects`
 * and `applyEffectDescriptors` keep their exact v1 signatures and semantics, and
 * an effect list authored before v2 resolves identically either way — `target`
 * defaults to `"self"`, `timing` to `"immediate"`, `preventable` to `false`.
 *
 * The two seams other agents integrate against:
 *
 * - **`chosen-opponent`** never picks for the player. It parks the effect as a
 *   `PendingEffectState` and opens a `PromptState` of kind
 *   `CHOOSE_OPPONENT_PROMPT_KIND` addressed to the actor, whose option ids are
 *   the candidate `PlayerId`s. Answering it means calling `resumePendingEffect`
 *   with the chosen ids.
 * - **`preventable: true`** is the only thing that raises a
 *   `ReactionWindowState` carrying a `pendingEffectId`. The window's
 *   `pendingEffectId` points at the parked `PendingEffectState`; a successful
 *   prevention calls `cancelPendingEffect`, an expiry or a pass calls
 *   `resumePendingEffect`. Both are idempotent, because both look the pending
 *   effect up by id and find nothing the second time.
 */

export {
  cancelPendingEffect,
  resolveEffectsV2,
  resumePendingEffect,
} from "./resolve";
export type {
  CharacterPassiveSource,
  EffectResourceChange,
  EffectsV2Input,
  EffectsV2Options,
  EffectsV2Outcome,
  EffectsV2SkipReason,
  EffectsV2TraceEntry,
  ResumePendingEffectOptions,
  ResumeResult,
} from "./resolve";

export {
  CHOOSE_ONE_PROMPT_KIND,
  CHOOSE_OPPONENT_PROMPT_KIND,
  IMMUNITY_STATUS_ID,
  PENDING_EFFECT_PAYLOAD_KIND,
  decodePendingEffect,
  effectFrameId,
  effectPromptId,
  effectWindowId,
  effectsV2Id,
  encodePendingEffect,
  pendingEffectId,
  toJsonValue,
} from "./pending";
export type { PendingEffectPayload } from "./pending";

export { leaderPlayerId, livePlayerIds, resolveEffectTargets } from "./targeting";
export type { TargetInput, TargetResolution } from "./targeting";

export { evaluateEffectCondition } from "./conditions";

export { isScalable, scaledAmount, withScaledAmount } from "./scaling";

export {
  IMMUNITY_SCOPE_KEY,
  STATUS_POLARITY_KEY,
  STATUS_SOURCE_DECK_KEY,
  immunityCovers,
  immunityScope,
  removeMatchingStatuses,
  statusData,
  statusMatchesFilter,
  statusPolarity,
  statusSourceDeckId,
} from "./statuses";

export {
  isCardPlayableUnderRules,
  isEffectEnabled,
  isEffectTimingEnabled,
} from "./gating";
export type { EffectGate } from "./gating";

export {
  EFFECT_TARGETS,
  EFFECT_TIMINGS,
  EFFECT_V2_TYPES,
  carriesHeatForAggression,
  effectTarget,
  effectTiming,
  isAggressiveEffect,
  isAggressiveEffectShape,
  isLegacyEffect,
  isNewEffect,
  isPreventable,
  parseEffectCondition,
} from "./vocabulary";
export type {
  EffectChoiceOption,
  EffectCondition,
  EffectConditionSubject,
  EffectEnvelope,
  EffectImmunityScope,
  EffectPolarity,
  EffectScale,
  EffectScaleMetric,
  EffectStatusFilter,
  EffectTarget,
  EffectTiming,
  EffectV2,
  EffectV2Descriptor,
  LegacyEffectV2,
  NewEffectV2,
} from "./vocabulary";
