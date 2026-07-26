import type {
  CharacterAbilityDescriptor,
  DeckConfig,
  EffectDescriptor,
} from "@office-ladder/content";

import {
  createStableId,
  type BallotState,
  type EffectId,
  type GameState,
  type IncomeStreamState,
  type JsonObject,
  type JsonValue,
  type LogicalTimestamp,
  type PendingEffectState,
  type PlacementState,
  type PlayerId,
  type PlayerState,
  type ProjectState,
  type PromptState,
  type ReactionWindowState,
  type ResourceState,
  type TileId,
} from "../../model";
import { rollDie, type RandomSource } from "../../random";
import { findActiveStatus } from "../player-status";
import {
  applySelfEffects,
  matchRollOutcome,
  negativeEffectShieldFor,
  type EffectOrigin,
  type IgnoredNegativeEffect,
  type ImmediateCardResolution,
  type ResourceKey,
  type TileEffectChange,
} from "../resolve-tile-effects";
import { evaluateEffectCondition } from "./conditions";
import { isEffectEnabled, isEffectTimingEnabled } from "./gating";
import {
  CHOOSE_ONE_PROMPT_KIND,
  CHOOSE_OPPONENT_PROMPT_KIND,
  IMMUNITY_STATUS_ID,
  decodePendingEffect,
  effectFrameId,
  effectPromptId,
  effectWindowId,
  encodePendingEffect,
  pendingEffectId,
  type PendingEffectPayload,
} from "./pending";
import { withScaledAmount } from "./scaling";
import {
  IMMUNITY_SCOPE_KEY,
  immunityCovers,
  immunityScope,
  removeMatchingStatuses,
  statusData,
  statusId as brandStatusId,
} from "./statuses";
import { livePlayerIds, resolveEffectTargets } from "./targeting";
import {
  effectTarget,
  effectTiming,
  isAggressiveEffectShape,
  isLegacyEffect,
  isPreventable,
  parseEffectCondition,
  type EffectV2,
  type NewEffectV2,
} from "./vocabulary";

/* ------------------------------------------------------------------ report */

export type EffectResourceChange = TileEffectChange & { readonly playerId: PlayerId };

/** Why an effect (or one target of it) did nothing. */
export type EffectsV2SkipReason =
  | "mode-disabled"
  | "condition-failed"
  | "condition-unparseable"
  | "timing-disabled"
  | "no-target"
  | "immune"
  | "insufficient-resources"
  | "placement-cap-reached"
  | "project-cap-reached"
  | "project-not-found"
  | "tile-already-owned"
  | "tile-not-owned"
  | "tile-unknown"
  | "no-cards-to-discard"
  /** `removeStatuses` found nothing its filter matched. */
  | "no-status-to-remove"
  /** A `chooseOne` reached the per-target applier without an answered branch. */
  | "choice-not-decided";

export type EffectsV2TraceEntry =
  | {
      readonly type: "resource-changed";
      readonly playerId: PlayerId;
      readonly change: TileEffectChange;
    }
  | {
      readonly type: "card-drawn";
      readonly playerId: PlayerId;
      readonly card: ImmediateCardResolution;
    }
  | {
      readonly type: "negative-effect-ignored";
      readonly playerId: PlayerId;
      readonly ignored: IgnoredNegativeEffect;
    }
  | {
      readonly type: "heat-changed";
      readonly playerId: PlayerId;
      readonly previousValue: number;
      readonly newValue: number;
      readonly thresholdCrossed: boolean;
    }
  | { readonly type: "placement-created"; readonly placement: PlacementState }
  | {
      readonly type: "tile-claimed";
      readonly tileId: TileId;
      readonly ownerId: PlayerId;
      readonly cost: number;
    }
  | {
      readonly type: "tile-released";
      readonly tileId: TileId;
      readonly previousOwnerId: PlayerId;
    }
  | { readonly type: "project-started"; readonly project: ProjectState }
  | {
      readonly type: "project-contributed";
      readonly projectId: string;
      readonly playerId: PlayerId;
      readonly money: number;
      readonly work: number;
    }
  | {
      readonly type: "project-sabotaged";
      readonly projectId: string;
      readonly playerId: PlayerId;
      readonly amount: number;
      readonly hidden: boolean;
    }
  | { readonly type: "ballot-opened"; readonly ballot: BallotState }
  | {
      readonly type: "immunity-granted";
      readonly playerId: PlayerId;
      readonly charges: number;
      readonly rounds: number | null;
      /** True when the grant named a scope, false for a blanket shield. */
      readonly scoped: boolean;
    }
  | {
      readonly type: "statuses-removed";
      readonly playerId: PlayerId;
      readonly statusIds: readonly string[];
    }
  | {
      readonly type: "immunity-consumed";
      readonly playerId: PlayerId;
      readonly effectType: string;
      /** False when the charge is duration-based and therefore not spent. */
      readonly chargeSpent: boolean;
    }
  | {
      readonly type: "opposed-roll";
      readonly actorId: PlayerId;
      readonly opponentId: PlayerId;
      readonly actorTotal: number;
      readonly opponentTotal: number;
      readonly path: string;
    }
  | {
      readonly type: "roll-check";
      readonly total: number;
      readonly doubles: boolean;
      readonly resolution: "shared" | "per-target";
      readonly playerIds: readonly PlayerId[];
      readonly path: string;
    }
  | {
      readonly type: "choice-opened";
      readonly playerIds: readonly PlayerId[];
      readonly optionIds: readonly string[];
      readonly path: string;
    }
  | {
      readonly type: "choice-resolved";
      readonly optionId: string;
      readonly path: string;
    }
  | {
      readonly type: "cards-discarded";
      readonly playerId: PlayerId;
      readonly cardIds: readonly string[];
    }
  | {
      readonly type: "positions-swapped";
      readonly playerIds: readonly [PlayerId, PlayerId];
      readonly positions: readonly [number, number];
    }
  | {
      readonly type: "teleported";
      readonly playerId: PlayerId;
      readonly from: number;
      readonly to: number;
    }
  | {
      readonly type: "upkeep-changed";
      readonly playerId: PlayerId;
      readonly previousPerRound: number;
      readonly newPerRound: number;
    }
  | {
      readonly type: "income-stream-granted";
      readonly playerId: PlayerId;
      readonly stream: IncomeStreamState;
    }
  | { readonly type: "extra-roll-granted"; readonly playerId: PlayerId }
  | { readonly type: "audit-opened"; readonly playerId: PlayerId }
  | {
      readonly type: "effect-parked";
      readonly reason: "reaction-window" | "chosen-opponent" | "choose-one";
      readonly pendingEffectId: EffectId;
      readonly path: string;
    }
  | { readonly type: "effect-stored"; readonly path: string; readonly effect: EffectV2 }
  | {
      readonly type: "effect-skipped";
      readonly reason: EffectsV2SkipReason;
      /** The `ModeRules` field that refused it, when `reason` is `mode-disabled`. */
      readonly rule: string | null;
      readonly path: string;
      readonly playerId: PlayerId | null;
    }
  | { readonly type: "reaction-window-opened"; readonly window: ReactionWindowState };

/**
 * Everything one batch of effects did.
 *
 * `state` already carries every mutation — the caller takes it verbatim and does
 * not re-apply anything from `trace`. `trace` and `changes` exist so the calling
 * transition can emit the matching `GameEvent`s; the resolver emits none itself,
 * because it does not own the event sequence.
 *
 * The resolver never touches `revision`, `eventSequence`, `lastCommandId`,
 * `stateHash` or `turn` — those belong to whichever transition invoked it.
 */
export type EffectsV2Outcome = {
  readonly state: GameState;
  readonly changes: readonly EffectResourceChange[];
  readonly trace: readonly EffectsV2TraceEntry[];
  /** Already appended to `state.prompts`; repeated here for event emission. */
  readonly openedPrompts: readonly PromptState[];
  /** Already appended to `state.reactionWindows`. */
  readonly openedReactionWindows: readonly ReactionWindowState[];
  /** Already appended to `state.pendingEffects`. */
  readonly parkedEffects: readonly PendingEffectState[];
  /** `timing: "stored"` effects the hand mechanic must put into a hand. */
  readonly storedEffects: readonly EffectV2[];
  readonly grantedExtraRollPlayerIds: readonly PlayerId[];
  readonly auditPromptPlayerIds: readonly PlayerId[];
  /** Players whose heat crossed `rules.conflict.heatThreshold` on this batch. */
  readonly heatThresholdCrossedPlayerIds: readonly PlayerId[];
};

/** A content character, structurally — enough to find a passive by id. */
export type CharacterPassiveSource = {
  readonly id: string;
  readonly passive?: CharacterAbilityDescriptor;
};

export type EffectsV2Options = {
  /** Matches the `sources` vocabulary of `ignoreNegativeEffect`. Default `"tile"`. */
  readonly origin?: EffectOrigin;
  /** The tile or card that authored these effects, for placement/project bookkeeping. */
  readonly sourceId?: string | null;
  /** Board context for effects whose `tileId` is `null`. Default: the actor's tile. */
  readonly tileId?: TileId | null;
  /**
   * Disambiguates two independent effect batches resolved by one command; every
   * id this resolver mints includes it. Same discipline as
   * `EphemeralRandomPurpose`. Default `"effects"`.
   */
  readonly idScope?: string;
  readonly decks?: readonly DeckConfig[];
  readonly characters?: readonly CharacterPassiveSource[];
  /**
   * True when resolving inside an already-open reaction window, which is the
   * only context a `timing: "reaction"` effect may resolve in.
   */
  readonly insideReactionWindow?: boolean;
  /**
   * The wall-clock instant a window or ballot this batch opens should expire at
   * (§7.1). The engine never computes one — it has no clock — so the caller
   * supplies it or it stays `null` and the server schedules from elsewhere.
   */
  readonly deadlineAt?: LogicalTimestamp | null;
  /** Prefix for the deterministic effect path, for nested resolution. */
  readonly pathPrefix?: string;
  /**
   * The deck the card that authored these effects came from.
   *
   * Provenance for `applyStatus` (§3.5) and for `grantImmunity`'s
   * `scope.sourceDeckId` (§3.4): "ignore one negative Networking card" needs to
   * know which deck the incoming card was drawn from, and that is knowledge only
   * the caller has. Falls back to the effect's own authored `sourceDeckId`.
   */
  readonly sourceDeckId?: string | null;
  /** How deep inside nested outcome/branch/option lists this batch is. */
  readonly nestingDepth?: number;
};

/* ----------------------------------------------------------------- helpers */

type Draft = {
  state: GameState;
  readonly changes: EffectResourceChange[];
  readonly trace: EffectsV2TraceEntry[];
  readonly prompts: PromptState[];
  readonly windows: ReactionWindowState[];
  readonly parked: PendingEffectState[];
  readonly stored: EffectV2[];
  readonly extraRolls: PlayerId[];
  readonly auditPrompts: PlayerId[];
  readonly heatCrossed: PlayerId[];
};

function newDraft(state: GameState): Draft {
  return {
    state,
    changes: [],
    trace: [],
    prompts: [],
    windows: [],
    parked: [],
    stored: [],
    extraRolls: [],
    auditPrompts: [],
    heatCrossed: [],
  };
}

function finish(draft: Draft): EffectsV2Outcome {
  return {
    state: draft.state,
    changes: draft.changes,
    trace: draft.trace,
    openedPrompts: draft.prompts,
    openedReactionWindows: draft.windows,
    parkedEffects: draft.parked,
    storedEffects: draft.stored,
    grantedExtraRollPlayerIds: draft.extraRolls,
    auditPromptPlayerIds: draft.auditPrompts,
    heatThresholdCrossedPlayerIds: draft.heatCrossed,
  };
}

function writePlayer(draft: Draft, player: PlayerState): void {
  draft.state = {
    ...draft.state,
    players: { ...draft.state.players, [player.id]: player },
  };
}

function skip(
  draft: Draft,
  reason: EffectsV2SkipReason,
  path: string,
  playerId: PlayerId | null,
  rule: string | null = null,
): void {
  draft.trace.push({ type: "effect-skipped", reason, rule, path, playerId });
}

/** Moves one resource by `delta`, reporting the change only when a value moved. */
function moveResource(
  player: PlayerState,
  resourceKey: string,
  delta: number,
  clampAtZero = true,
): { readonly player: PlayerState; readonly change: TileEffectChange | null } {
  const resource = player.resources[resourceKey];
  if (resource === undefined || delta === 0) return { player, change: null };

  const floor = clampAtZero ? (resource.minimum ?? 0) : null;
  let next = resource.value + delta;
  if (floor !== null) next = Math.max(floor, next);
  if (resource.maximum !== null) next = Math.min(resource.maximum, next);
  if (next === resource.value) return { player, change: null };

  const updated: ResourceState = { ...resource, value: next };

  return {
    player: { ...player, resources: { ...player.resources, [resourceKey]: updated } },
    change: {
      resource: resourceKey as ResourceKey,
      previousValue: resource.value,
      newValue: next,
    },
  };
}

function recordChange(draft: Draft, playerId: PlayerId, change: TileEffectChange | null): void {
  if (change === null) return;
  draft.changes.push({ ...change, playerId });
  draft.trace.push({ type: "resource-changed", playerId, change });
}

/**
 * Content's `TileId` is the template literal `` `tile.board.${string}` ``;
 * the engine's is a *branded* string minted by `createStableId`. They name the
 * same thing and are the same bytes at runtime, but neither is assignable to the
 * other, so the crossing is made once, here, rather than at each of the five call
 * sites that would otherwise each need their own cast.
 */
function asEngineTileId(raw: string | null | undefined): TileId | null {
  return raw === null || raw === undefined ? null : (raw as TileId);
}

/** The tile an effect means when it says `tileId: null`. */
function contextualTileId(
  state: GameState,
  player: PlayerState | undefined,
  fallback: TileId | null,
): TileId | null {
  if (fallback !== null) return fallback;
  if (player === undefined) return null;

  return state.tileIds[player.position] ?? null;
}

function passiveFor(
  player: PlayerState,
  characters: readonly CharacterPassiveSource[] | undefined,
): CharacterAbilityDescriptor | undefined {
  return characters?.find((candidate) => candidate.id === player.characterId)?.passive;
}

/**
 * `openBallot` and `openReactionWindow` act on the table, not on a player, so
 * they resolve exactly once no matter what `target` says. Resolving them per
 * target would open one ballot per opponent.
 */
function isTableScoped(effect: EffectV2): boolean {
  return effect.type === "openBallot" || effect.type === "openReactionWindow";
}

/**
 * Where an effect lands within its resolved target set.
 *
 * Only `transferResource` with `perTarget: false` needs it — that is the reading
 * where the authored `amount` is a *pot* split across the table rather than a
 * price each seat pays — but it has to be threaded through the applier because
 * nothing downstream can see how many siblings a target had.
 */
type TargetSlot = { readonly index: number; readonly count: number };

const SOLE_TARGET: TargetSlot = { index: 0, count: 1 };

/**
 * The share of `total` that the `index`-th of `count` targets carries.
 *
 * Integer and exact: the remainder goes to the earliest seats in `playerOrder`
 * rather than being rounded away, so a 100 pot across three players moves
 * 34/33/33 and not 33/33/33 with one unit quietly deleted.
 */
function shareOf(total: number, slot: TargetSlot): number {
  if (slot.count <= 1) return total;

  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const base = Math.floor(magnitude / slot.count);
  const remainder = magnitude % slot.count;

  return sign * (base + (slot.index < remainder ? 1 : 0));
}

/* -------------------------------------------------------- the v2 appliers */

function applyNewEffect(
  draft: Draft,
  effect: NewEffectV2,
  actorId: PlayerId,
  targetId: PlayerId,
  path: string,
  random: RandomSource,
  options: EffectsV2Options,
  slot: TargetSlot = SOLE_TARGET,
): void {
  const state = draft.state;
  const rules = state.rules;
  const target = state.players[targetId];
  const actor = state.players[actorId];
  if (target === undefined || actor === undefined) {
    skip(draft, "no-target", path, targetId);

    return;
  }

  switch (effect.type) {
    case "transferResource": {
      if (targetId === actorId) {
        // Moving a resource from yourself to yourself is a no-op, not an error:
        // an `all-players` transfer legitimately includes the actor.
        return;
      }

      // §3.8. `perTarget` defaults to true — the authored amount is what *each*
      // resolved target moves, which is what makes an `@all-opponents` transfer
      // correct at three players and at six. `false` reads the amount as one pot
      // shared across the table.
      const perTarget = effect.perTarget ?? true;
      const wanted = Math.max(0, perTarget ? effect.amount : shareOf(effect.amount, slot));
      if (wanted === 0) return;

      // §3.8 again: `target-to-actor` is the steal, `actor-to-target` the gift.
      // The payer is whoever the resource leaves, and the shortfall rule is
      // stated on the payer for both directions.
      const toActor = (effect.direction ?? "target-to-actor") === "target-to-actor";
      const payer = toActor ? target : actor;
      const payee = toActor ? actor : target;
      const payerId = toActor ? targetId : actorId;
      const payeeId = toActor ? actorId : targetId;

      const available = payer.resources[effect.resource]?.value ?? 0;
      if (effect.insufficientFunds === "all-or-nothing" && available < wanted) {
        skip(draft, "insufficient-resources", path, payerId);

        return;
      }
      // Default is `transfer-up-to-available`, matching `payResource`'s
      // `pay-up-to-available`: a transfer that cannot be paid in full moves what
      // is there rather than failing outright.
      const moved = Math.min(wanted, available);
      if (moved === 0) {
        skip(draft, "insufficient-resources", path, payerId);

        return;
      }

      const taken = moveResource(payer, effect.resource, -moved);
      const given = moveResource(payee, effect.resource, moved, false);
      writePlayer(draft, taken.player);
      writePlayer(draft, given.player);
      recordChange(draft, payerId, taken.change);
      recordChange(draft, payeeId, given.change);

      return;
    }
    case "modifyHeat": {
      const previous = target.heat.value;
      const next = Math.max(0, previous + effect.amount);
      if (next === previous) return;

      const crossed = previous < target.heat.threshold && next >= target.heat.threshold;
      writePlayer(draft, {
        ...target,
        heat: {
          ...target.heat,
          value: next,
          investigationsOpened: crossed
            ? target.heat.investigationsOpened + 1
            : target.heat.investigationsOpened,
          lastIncrementedAtRound:
            effect.amount > 0 ? state.turn.round : target.heat.lastIncrementedAtRound,
        },
      });
      draft.trace.push({
        type: "heat-changed",
        playerId: targetId,
        previousValue: previous,
        newValue: next,
        thresholdCrossed: crossed,
      });
      if (crossed && !draft.heatCrossed.includes(targetId)) {
        draft.heatCrossed.push(targetId);
      }

      return;
    }
    case "placeObject": {
      const tileId = contextualTileId(state, target, asEngineTileId(effect.tileId) ?? options.tileId ?? null);
      if (tileId === null) {
        skip(draft, "tile-unknown", path, targetId);

        return;
      }
      const owned = state.placements.filter((placement) => placement.ownerId === targetId).length;
      if (owned >= rules.board.maxPlacementsPerPlayer) {
        skip(draft, "placement-cap-reached", path, targetId, "board.maxPlacementsPerPlayer");

        return;
      }

      const placement: PlacementState = {
        id: createStableId(
          "PlacementId",
          `${state.gameId}:placement:${state.revision}:${options.idScope ?? "effects"}:${path}`,
        ),
        kind: effect.placementKind,
        tileId,
        ownerId: targetId,
        charges: Math.max(1, effect.charges ?? 1),
        visibility: effect.visibility ?? "public",
        placedAtRound: state.turn.round,
        data: effect.data ?? {},
      };
      draft.state = { ...draft.state, placements: [...draft.state.placements, placement] };
      draft.trace.push({ type: "placement-created", placement });

      return;
    }
    case "claimTile": {
      const tileId = contextualTileId(state, target, asEngineTileId(effect.tileId) ?? options.tileId ?? null);
      if (tileId === null) {
        skip(draft, "tile-unknown", path, targetId);

        return;
      }
      if (state.tileOwnership[tileId] !== undefined) {
        skip(draft, "tile-already-owned", path, targetId);

        return;
      }
      const cost = Math.round(Math.max(0, effect.baseCost) * rules.board.claimCostMultiplier);
      const money = target.resources["money"]?.value ?? 0;
      if (money < cost) {
        skip(draft, "insufficient-resources", path, targetId);

        return;
      }

      const paid = moveResource(target, "money", -cost);
      writePlayer(draft, paid.player);
      recordChange(draft, targetId, paid.change);
      draft.state = {
        ...draft.state,
        tileOwnership: {
          ...draft.state.tileOwnership,
          [tileId]: {
            tileId,
            ownerId: targetId,
            level: 0,
            claimedAtRound: state.turn.round,
            tollPaidCount: 0,
          },
        },
      };
      draft.trace.push({ type: "tile-claimed", tileId, ownerId: targetId, cost });

      return;
    }
    case "releaseTile": {
      const tileId = contextualTileId(state, target, asEngineTileId(effect.tileId) ?? options.tileId ?? null);
      const ownership = tileId === null ? undefined : state.tileOwnership[tileId];
      if (tileId === null || ownership === undefined || ownership.ownerId !== targetId) {
        skip(draft, "tile-not-owned", path, targetId);

        return;
      }

      // Key iteration is safe *here* and nowhere else in this module: this is a
      // filter, so the result is the same mapping whatever order the keys come
      // out in. The determinism rule bites when key order decides an *outcome* —
      // which player gets picked, which entry wins a tie — and nothing like that
      // happens in a copy-minus-one.
      const remaining: Record<string, (typeof state.tileOwnership)[string]> = {};
      for (const candidate of Object.keys(state.tileOwnership)) {
        if (candidate === tileId) continue;
        const entry = state.tileOwnership[candidate];
        if (entry !== undefined) remaining[candidate] = entry;
      }
      draft.state = { ...draft.state, tileOwnership: remaining };
      draft.trace.push({ type: "tile-released", tileId, previousOwnerId: targetId });

      return;
    }
    case "startProject": {
      const led = state.projects.filter(
        (project) =>
          project.leadPlayerId === targetId &&
          (project.status === "open" || project.status === "funded"),
      ).length;
      if (led >= rules.projects.maxConcurrentPerPlayer) {
        skip(draft, "project-cap-reached", path, targetId, "projects.maxConcurrentPerPlayer");

        return;
      }

      const project: ProjectState = {
        id: createStableId(
          "ProjectId",
          `${state.gameId}:project:${state.revision}:${options.idScope ?? "effects"}:${path}`,
        ),
        definitionId: effect.definitionId,
        leadPlayerId: targetId,
        tileId: contextualTileId(state, target, asEngineTileId(effect.tileId) ?? options.tileId ?? null),
        status: "open",
        requiredMoney: Math.max(0, effect.requiredMoney),
        requiredWork: Math.max(0, effect.requiredWork),
        contributions: [],
        sabotage: [],
        deadlineRound:
          state.turn.round + Math.max(1, effect.deadlineRounds ?? rules.projects.deadlineRounds),
        payout: effect.payout,
        // A mode that forbids joining forbids it however the project was
        // authored: the flag is a rule, not a suggestion.
        openToJoin: rules.projects.joinable && (effect.openToJoin ?? true),
        leadBonusBasisPoints: Math.max(0, effect.leadBonusBasisPoints ?? 0),
      };
      draft.state = { ...draft.state, projects: [...draft.state.projects, project] };
      draft.trace.push({ type: "project-started", project });

      return;
    }
    case "contributeToProject": {
      const project = findContributionTarget(state, effect.projectId ?? null, targetId);
      if (project === null) {
        skip(draft, "project-not-found", path, targetId);

        return;
      }
      if (!project.openToJoin && project.leadPlayerId !== targetId) {
        skip(draft, "project-not-found", path, targetId, "projects.joinable");

        return;
      }
      const money = Math.max(0, effect.money);
      const work = Math.max(0, effect.work);
      const heldMoney = target.resources["money"]?.value ?? 0;
      const heldWork = target.resources["work-counter"]?.value ?? 0;
      if (heldMoney < money || heldWork < work) {
        skip(draft, "insufficient-resources", path, targetId);

        return;
      }

      const afterMoney = moveResource(target, "money", -money);
      const afterWork = moveResource(afterMoney.player, "work-counter", -work);
      writePlayer(draft, afterWork.player);
      recordChange(draft, targetId, afterMoney.change);
      recordChange(draft, targetId, afterWork.change);
      draft.state = {
        ...draft.state,
        projects: draft.state.projects.map((candidate) =>
          candidate.id === project.id
            ? {
                ...candidate,
                contributions: [
                  ...candidate.contributions,
                  { playerId: targetId, money, work, atRound: state.turn.round },
                ],
              }
            : candidate,
        ),
      };
      draft.trace.push({
        type: "project-contributed",
        projectId: project.id,
        playerId: targetId,
        money,
        work,
      });

      return;
    }
    case "sabotageProject": {
      const project = findSabotageTarget(state, effect.projectId ?? null, actorId);
      if (project === null) {
        skip(draft, "project-not-found", path, targetId);

        return;
      }
      const amount = Math.max(0, effect.amount);
      if (amount === 0) return;

      const hidden = effect.hidden ?? false;
      draft.state = {
        ...draft.state,
        projects: draft.state.projects.map((candidate) =>
          candidate.id === project.id
            ? {
                ...candidate,
                sabotage: [
                  ...candidate.sabotage,
                  { playerId: actorId, amount, hidden, atRound: state.turn.round },
                ],
              }
            : candidate,
        ),
      };
      draft.trace.push({
        type: "project-sabotaged",
        projectId: project.id,
        playerId: actorId,
        amount,
        hidden,
      });

      return;
    }
    case "openBallot": {
      const ballot: BallotState = {
        id: createStableId(
          "BallotId",
          `${state.gameId}:ballot:${state.revision}:${options.idScope ?? "effects"}:${path}`,
        ),
        kind: effect.ballotKind,
        subjectId: effect.subjectId,
        subject: effect.subject ?? {},
        audience: livePlayerIds(state),
        castBy: {},
        deadlineAt: options.deadlineAt ?? null,
        closesAtRound: state.turn.round + Math.max(1, effect.closesInRounds ?? 1),
        visibility: effect.visibility ?? "open",
        resolution: null,
      };
      draft.state = { ...draft.state, ballots: [...draft.state.ballots, ballot] };
      draft.trace.push({ type: "ballot-opened", ballot });

      return;
    }
    case "grantImmunity": {
      // Re-cut plan §3.4's declared shape. Exactly one of `count` / `duration`
      // is set: "ignore one negative Networking card" is a count, "ignore all
      // Energy loss this turn" is a duration and cannot be written as a count
      // without inventing a number.
      const rounds = effect.duration?.count ?? null;
      const charges = rounds === null ? Math.max(1, effect.count ?? 1) : 1;
      const scope = effect.scope;
      const scoped = Object.keys(scope).length > 0;

      // Two immunities with *different* scopes are two different protections, so
      // they get their own status rows rather than merging into one stack — a
      // reputation shield must not be spent absorbing an energy loss. Same-scope
      // grants still stack, or a second defensive card would silently do nothing.
      const encodedScope = toStableScope(scope);
      const key = JSON.stringify(encodedScope);
      const existing = target.statuses.find(
        (status) =>
          status.id === IMMUNITY_STATUS_ID &&
          JSON.stringify(status.data[IMMUNITY_SCOPE_KEY] ?? {}) === key,
      );
      const statuses = [
        ...target.statuses.filter((status) => status !== existing),
        {
          id: brandStatusId(IMMUNITY_STATUS_ID),
          sourceId: options.sourceId ?? null,
          stacks: (existing?.stacks ?? 0) + charges,
          remainingTurns: rounds,
          expiresAtRound: rounds === null ? null : state.turn.round + rounds,
          visibility: "public" as const,
          data: { [IMMUNITY_SCOPE_KEY]: encodedScope } as JsonObject,
        },
      ];
      writePlayer(draft, { ...target, statuses });
      draft.trace.push({
        type: "immunity-granted",
        playerId: targetId,
        charges,
        rounds,
        scoped,
      });

      return;
    }
    case "removeStatuses": {
      // The only verb that *removes* state, and the one that made provenance
      // necessary — see `statuses.ts`. Removal is fail-closed: a filter naming a
      // polarity never strips a status that did not declare one.
      const { statuses, removed } = removeMatchingStatuses(
        target.statuses,
        effect.filter,
        effect.limit,
      );
      if (removed.length === 0) {
        skip(draft, "no-status-to-remove", path, targetId);

        return;
      }

      writePlayer(draft, { ...target, statuses });
      draft.trace.push({ type: "statuses-removed", playerId: targetId, statusIds: removed });

      return;
    }
    case "opposedRoll": {
      if (targetId === actorId) {
        // Rolling against yourself has no defined winner. `chosen-opponent` is
        // the default opponent for exactly this reason.
        skip(draft, "no-target", path, targetId);

        return;
      }

      const dice = effect.dice ?? { count: 2, sides: 6 };
      const rollTotal = (): number => {
        let total = 0;
        for (let die = 0; die < dice.count; die += 1) total += rollDie(random, dice.sides);

        return total;
      };
      // The actor rolls first, always. Both totals come from the caller's
      // deterministic source, so a replay re-derives the same contest.
      const actorTotal = rollTotal();
      const opponentTotal = rollTotal();

      draft.trace.push({
        type: "opposed-roll",
        actorId,
        opponentId: targetId,
        actorTotal,
        opponentTotal,
        path,
      });

      const branch =
        actorTotal > opponentTotal
          ? effect.onWin
          : actorTotal < opponentTotal
            ? effect.onLose
            : (effect.onTie ?? []);

      // §3.9 rule 2: the branch inherits the opponent as its target, not the
      // actor. A bet whose payout landed on the person who proposed it would pay
      // the winner and the loser alike.
      resolveNested(draft, branch, actorId, [targetId], `${path}:opposed`, random, options);

      return;
    }
    case "noEffect":
      // Declared, on purpose. Two Clock Deck cards exist precisely to burn a
      // draw, and an empty `effects` array is indistinguishable from an
      // authoring mistake. Doing nothing here is the implementation.
      return;
    case "chooseOne":
      // Resolved in `resolveOne`, which opens the prompt, and in
      // `resumePendingEffect`, which applies the answered branch. Reaching this
      // applier means an already-decided choice was routed per target, which
      // would re-ask the question once per recipient.
      skip(draft, "choice-not-decided", path, targetId);

      return;
    case "forceDiscard": {
      const count = Math.max(0, effect.count);
      // From the front of the hand: oldest first, deterministic, and identical
      // after a JSON round trip. Letting the target choose would need a prompt
      // of its own — see the gap noted in this module's docstring.
      const discarded = target.hand.slice(0, count);
      if (discarded.length === 0) {
        skip(draft, "no-cards-to-discard", path, targetId);

        return;
      }

      let cards = draft.state.cards;
      let decks = draft.state.decks;
      for (const cardId of discarded) {
        const card = cards[cardId];
        if (card === undefined) continue;
        cards = { ...cards, [cardId]: { ...card, zone: "discard-pile", ownerId: null } };
        const deck = decks[card.deckId];
        if (deck !== undefined) {
          decks = {
            ...decks,
            [card.deckId]: { ...deck, discardPile: [...deck.discardPile, cardId] },
          };
        }
      }
      writePlayer(draft, { ...target, hand: target.hand.slice(discarded.length) });
      draft.state = { ...draft.state, cards, decks };
      draft.trace.push({ type: "cards-discarded", playerId: targetId, cardIds: [...discarded] });

      return;
    }
    case "swapBoardPositions": {
      if (targetId === actorId) return;

      const actorPosition = actor.position;
      const targetPosition = target.position;
      if (actorPosition === targetPosition) return;

      // No traversal: neither player passes the receptionist, so no salary is
      // paid and no tile in between resolves. A swap is a relocation, not a move.
      writePlayer(draft, { ...actor, position: targetPosition });
      writePlayer(draft, { ...target, position: actorPosition });
      draft.trace.push({
        type: "positions-swapped",
        playerIds: [actorId, targetId],
        positions: [targetPosition, actorPosition],
      });

      return;
    }
    case "teleport": {
      const destination =
        effect.destination.kind === "tileIndex"
          ? effect.destination.index
          : state.tileIds.indexOf(effect.destination.tileId as TileId);
      if (destination < 0 || destination >= state.boardSize) {
        skip(draft, "tile-unknown", path, targetId);

        return;
      }
      if (destination === target.position) return;

      writePlayer(draft, { ...target, position: destination });
      draft.trace.push({
        type: "teleported",
        playerId: targetId,
        from: target.position,
        to: destination,
      });

      return;
    }
    case "modifyUpkeep": {
      const previous = target.upkeep.perRound;
      const next = Math.max(0, previous + effect.amount);
      if (next === previous) return;

      writePlayer(draft, { ...target, upkeep: { ...target.upkeep, perRound: next } });
      draft.trace.push({
        type: "upkeep-changed",
        playerId: targetId,
        previousPerRound: previous,
        newPerRound: next,
      });

      return;
    }
    case "openReactionWindow": {
      const eligible = livePlayerIds(state).filter((playerId) => playerId !== actorId);
      if (eligible.length === 0) {
        skip(draft, "no-target", path, null);

        return;
      }

      const window: ReactionWindowState = {
        id: effectWindowId(state, options.idScope ?? "effects", path),
        frameId: effectFrameId(state, options.idScope ?? "effects", path),
        kind: effect.windowKind,
        eligiblePlayerIds: eligible,
        priorityPlayerId: eligible[0] ?? null,
        passedPlayerIds: [],
        playedByPlayerIds: [],
        deadlineAt: options.deadlineAt ?? null,
        pendingEffectId: null,
      };
      draft.state = { ...draft.state, reactionWindows: [...draft.state.reactionWindows, window] };
      draft.windows.push(window);
      draft.trace.push({ type: "reaction-window-opened", window });

      return;
    }
    case "grantIncomeStream": {
      const stream: IncomeStreamState = {
        id: createStableId(
          "IncomeStreamId",
          `${state.gameId}:income:${state.revision}:${options.idScope ?? "effects"}:${path}`,
        ),
        kind: effect.streamKind,
        perRound: effect.perRound,
        remainingRounds: effect.remainingRounds,
        sourceId: effect.sourceId ?? options.sourceId ?? null,
      };
      writePlayer(draft, { ...target, incomeStreams: [...target.incomeStreams, stream] });
      draft.trace.push({ type: "income-stream-granted", playerId: targetId, stream });

      return;
    }
    default:
      return effect satisfies never;
  }
}

/** The project a `contributeToProject` with no explicit id means. */
function findContributionTarget(
  state: GameState,
  projectId: string | null,
  contributorId: PlayerId,
): ProjectState | null {
  if (projectId !== null) {
    return (
      state.projects.find(
        (project) => project.id === projectId && project.status === "open",
      ) ?? null
    );
  }

  // Array order, which is insertion order and stable across a JSON round trip.
  const own = state.projects.find(
    (project) => project.status === "open" && project.leadPlayerId === contributorId,
  );
  if (own !== undefined) return own;

  const player = state.players[contributorId];
  const tileId = player === undefined ? null : (state.tileIds[player.position] ?? null);

  return (
    state.projects.find(
      (project) => project.status === "open" && tileId !== null && project.tileId === tileId,
    ) ?? null
  );
}

/** The project a `sabotageProject` with no explicit id means. */
function findSabotageTarget(
  state: GameState,
  projectId: string | null,
  saboteurId: PlayerId,
): ProjectState | null {
  if (projectId !== null) {
    return (
      state.projects.find(
        (project) => project.id === projectId && project.status === "open",
      ) ?? null
    );
  }

  return (
    state.projects.find(
      (project) => project.status === "open" && project.leadPlayerId !== saboteurId,
    ) ?? null
  );
}

/* ---------------------------------------------------------- the main walk */

function applyLegacyToTarget(
  draft: Draft,
  effect: EffectDescriptor,
  targetId: PlayerId,
  random: RandomSource,
  options: EffectsV2Options,
): void {
  const target = draft.state.players[targetId];
  if (target === undefined) return;

  const origin = options.origin ?? "tile";
  // The shield belongs to whoever is being hit, not to whoever is hitting: an
  // opponent's `ignoreNegativeEffect` allowance is what absorbs a steal aimed at
  // them, and it has to be spent from *their* per-lap budget.
  const shield = negativeEffectShieldFor(target, passiveFor(target, options.characters));
  const result = applySelfEffects(
    target,
    [effect],
    random,
    options.decks ?? [],
    origin,
    shield,
  );

  const ignored = result.ignoredNegativeEffects;
  writePlayer(draft, {
    ...result.player,
    negativeEffectsIgnoredThisLap: result.player.negativeEffectsIgnoredThisLap + ignored,
  });

  for (const entry of result.trace) {
    switch (entry.type) {
      case "resource-changed":
        draft.changes.push({ ...entry.change, playerId: targetId });
        draft.trace.push({ type: "resource-changed", playerId: targetId, change: entry.change });
        break;
      case "card-drawn":
        draft.trace.push({ type: "card-drawn", playerId: targetId, card: entry.card });
        break;
      case "negative-effect-ignored":
        draft.trace.push({
          type: "negative-effect-ignored",
          playerId: targetId,
          ignored: entry.ignored,
        });
        break;
    }
  }

  if (result.grantedExtraRoll && !draft.extraRolls.includes(targetId)) {
    draft.extraRolls.push(targetId);
    draft.trace.push({ type: "extra-roll-granted", playerId: targetId });
  }
  if (result.openAuditPrompt && !draft.auditPrompts.includes(targetId)) {
    draft.auditPrompts.push(targetId);
    draft.trace.push({ type: "audit-opened", playerId: targetId });
  }
}

/**
 * Writes an `applyStatus` **with provenance**, instead of letting the v1 applier
 * drop it.
 *
 * `polarity` and `sourceDeckId` are authored on the effect and are the only
 * thing that makes `removeStatuses`' filter evaluable (§3.5). The v1 path's
 * `applyStatusEffect` predates both fields and writes neither, so a status
 * applied through it is untagged — which the filter reads as "unknown", and
 * fails closed on. Routing through here is what gives a card-applied status the
 * provenance a later card can act on.
 */
function applyStatusWithProvenance(
  draft: Draft,
  effect: Extract<EffectV2, { type: "applyStatus" }>,
  targetId: PlayerId,
  options: EffectsV2Options,
): void {
  const target = draft.state.players[targetId];
  if (target === undefined) return;

  const status = {
    id: brandStatusId(effect.statusId),
    sourceId: options.sourceId ?? null,
    stacks: effect.duration.kind === "uses" ? effect.duration.count : 1,
    remainingTurns: effect.duration.kind === "turns" ? effect.duration.count : null,
    expiresAtRound: null,
    visibility: "private" as const,
    data: statusData(
      effect.parameters,
      effect.polarity,
      effect.sourceDeckId ?? options.sourceDeckId ?? null,
    ),
  };

  writePlayer(draft, {
    ...target,
    statuses: [
      ...target.statuses.filter((existing) => existing.id !== status.id),
      status,
    ],
  });
}

function applyToTarget(
  draft: Draft,
  effect: EffectV2,
  actorId: PlayerId,
  targetId: PlayerId,
  path: string,
  random: RandomSource,
  options: EffectsV2Options,
  slot: TargetSlot = SOLE_TARGET,
): void {
  // §3.7. Scaling happens at the moment the effect *lands*, not when it is
  // resolved, so a parked effect that resumes several commands later scales off
  // the state it actually lands in — and, on an `@all-players` effect, off each
  // recipient's own metric rather than the drawer's once.
  const scaled = withScaledAmount(draft.state, effect, actorId, targetId);

  if (scaled.type === "applyStatus") {
    applyStatusWithProvenance(draft, scaled, targetId, options);

    return;
  }

  if (isLegacyEffect(scaled)) {
    applyLegacyToTarget(draft, scaled, targetId, random, options);

    return;
  }

  applyNewEffect(draft, scaled, actorId, targetId, path, random, options, slot);
}

/**
 * Resolves a nested effect list — a `rollCheck` outcome, an `opposedRoll`
 * branch, a `chooseOne` option.
 *
 * Re-cut plan §3.9 rule 2: **an un-targeted nested effect inherits the target of
 * the effect it is nested inside, never the actor.** Without that,
 * `card.annual-event.sports-day-champion` pays one player six times, and so do
 * the already-shipped `globalEvent.reorg` and `globalEvent.merger-rumour`. A
 * nested effect that *does* carry its own `target` re-targets from scratch,
 * which is what makes `@highest-rank` inside a roll outcome mean what it says.
 *
 * `depth` mirrors the v1 resolver's recursion cap for the same reason: authored
 * content that nests without bound would otherwise be a stack overflow rather
 * than a validation failure.
 */
const MAX_NESTED_DEPTH = 3;

function resolveNested(
  draft: Draft,
  effects: readonly EffectDescriptor[],
  actorId: PlayerId,
  inheritedTargetIds: readonly PlayerId[],
  path: string,
  random: RandomSource,
  options: EffectsV2Options,
): void {
  const depth = options.nestingDepth ?? 0;
  if (depth >= MAX_NESTED_DEPTH) return;

  const nestedOptions: EffectsV2Options = { ...options, nestingDepth: depth + 1 };

  effects.forEach((authored, index) => {
    const nested = authored as EffectV2;
    const nestedPath = `${path}:${index}`;

    if (nested.target !== undefined) {
      resolveOne(draft, nested, actorId, nestedPath, random, nestedOptions);

      return;
    }

    for (const [slotIndex, targetId] of inheritedTargetIds.entries()) {
      applyToTarget(draft, nested, actorId, targetId, nestedPath, random, nestedOptions, {
        index: slotIndex,
        count: inheritedTargetIds.length,
      });
    }
  });
}

/**
 * A scope, normalised to a JSON object with its keys in a fixed order.
 *
 * Two immunities are "the same protection" when their scopes are equal, and that
 * comparison is done on the serialised form — so key order has to be the
 * resolver's, not the author's. Otherwise `{resource, direction}` and
 * `{direction, resource}` would stack as two separate shields.
 */
function toStableScope(scope: {
  readonly resource?: string;
  readonly direction?: string;
  readonly effectTypes?: readonly string[];
  readonly sourceDeckId?: string;
}): JsonObject {
  const stable: Record<string, JsonValue> = {};
  if (scope.resource !== undefined) stable["resource"] = scope.resource;
  if (scope.direction !== undefined) stable["direction"] = scope.direction;
  if (scope.effectTypes !== undefined) stable["effectTypes"] = [...scope.effectTypes].sort();
  if (scope.sourceDeckId !== undefined) stable["sourceDeckId"] = scope.sourceDeckId;

  return stable;
}

/**
 * Parks an effect that cannot resolve yet, writing the `PendingEffectState` the
 * reactions / prompt mechanics resume from.
 */
function park(
  draft: Draft,
  effect: EffectV2,
  actorId: PlayerId,
  targetPlayerIds: readonly PlayerId[],
  path: string,
  reason: "reaction-window" | "chosen-opponent" | "choose-one",
  options: EffectsV2Options,
): PendingEffectState {
  const state = draft.state;
  const scope = options.idScope ?? "effects";
  const payload: PendingEffectPayload = {
    // Target resolution already happened; re-deriving it on resume against a
    // later state would silently re-aim the effect.
    effect: { ...effect, target: "self" },
    actorId,
    targetPlayerIds,
    origin: options.origin ?? "tile",
    sourceId: options.sourceId ?? null,
    tileId: options.tileId ?? null,
    idScope: scope,
    path,
  };
  const pending: PendingEffectState = {
    id: pendingEffectId(state, scope, path),
    frameId: effectFrameId(state, scope, path),
    sourceId: options.sourceId ?? null,
    affectedPlayerIds: targetPlayerIds,
    effect: encodePendingEffect(payload),
    preventionEligible: isPreventable(effect),
    visibility: "public",
  };

  draft.state = { ...draft.state, pendingEffects: [...draft.state.pendingEffects, pending] };
  draft.parked.push(pending);
  draft.trace.push({ type: "effect-parked", reason, pendingEffectId: pending.id, path });

  return pending;
}

/**
 * Spends a `grantImmunity` charge if one covers this effect. Returns true when
 * the effect was absorbed and must not land.
 *
 * There are two readings of "immune", and the declared scope of §3.4 is what
 * tells them apart:
 *
 * - **A scoped immunity** — every authored one — blocks any effect its scope
 *   matches, whoever caused it and whether or not it is `preventable`. "Ignore
 *   all Energy loss this turn" has to absorb the energy line of a card the
 *   holder drew themselves, or it protects against nothing a player would
 *   notice.
 * - **An unscoped immunity** (`scope: {}`) is the blanket shield this resolver
 *   had before the shape was declared, and keeps exactly its old semantics: it
 *   absorbs a `preventable` effect aimed at the holder by somebody else.
 *
 * Consumption is real in both cases. A count-based charge is spent and the
 * status disappears once exhausted; a duration-based one is *not* spent, because
 * "all Energy loss this turn" is a window, not a quantity — it expires when
 * `remainingTurns` runs out.
 */
function consumeImmunity(
  draft: Draft,
  effect: EffectV2,
  actorId: PlayerId,
  targetId: PlayerId,
  path: string,
  options: EffectsV2Options,
): boolean {
  const target = draft.state.players[targetId];
  if (target === undefined) return false;
  if (findActiveStatus(target, IMMUNITY_STATUS_ID) === null) return false;

  const sourceDeckId =
    (effect.type === "applyStatus" ? effect.sourceDeckId : undefined) ??
    options.sourceDeckId ??
    null;

  const match = target.statuses.find((status) => {
    if (status.id !== IMMUNITY_STATUS_ID || status.stacks <= 0) return false;

    const scope = immunityScope(status);
    const unscoped = scope === null || Object.keys(scope).length === 0;
    if (unscoped) return isPreventable(effect) && targetId !== actorId;

    return immunityCovers(scope, effect, sourceDeckId);
  });
  if (match === undefined) return false;

  const durationBased = match.remainingTurns !== null;
  if (!durationBased) {
    const statuses = target.statuses
      .map((status) => (status === match ? { ...status, stacks: status.stacks - 1 } : status))
      .filter((status) => status.stacks > 0);
    writePlayer(draft, { ...target, statuses });
  }

  draft.trace.push({
    type: "immunity-consumed",
    playerId: targetId,
    effectType: effect.type,
    chargeSpent: !durationBased,
  });
  skip(draft, "immune", path, targetId);

  return true;
}

function resolveOne(
  draft: Draft,
  effect: EffectV2,
  actorId: PlayerId,
  path: string,
  random: RandomSource,
  options: EffectsV2Options,
): void {
  const rules = draft.state.rules;
  const timing = effectTiming(effect);

  // 1. Timing. A mode that has switched a timing off must not resolve it at all;
  //    §10.2 says such a card should not even have entered its deck, so reaching
  //    here means something upstream skipped `isCardPlayableUnderRules`.
  if (!isEffectTimingEnabled(rules, timing)) {
    skip(
      draft,
      "timing-disabled",
      path,
      null,
      timing === "stored" ? "agency.handEnabled" : "interaction.reactionWindows",
    );

    return;
  }
  if (timing === "stored") {
    draft.stored.push(effect);
    draft.trace.push({ type: "effect-stored", path, effect });

    return;
  }
  if (timing === "reaction" && options.insideReactionWindow !== true) {
    // Not an error: a reaction effect simply waits for a window. The hand
    // mechanic holds it; nothing here mutates.
    draft.stored.push(effect);
    draft.trace.push({ type: "effect-stored", path, effect });

    return;
  }

  // 2. Targets. `chosen-opponent` opens a prompt and stops — an effect that
  //    resolves a choice on the player's behalf is a bug (§10.1).
  // Hostility for *pool* purposes is the effect's own shape plus the fact that
  // it aims away from the actor; which particular opponent it lands on is
  // exactly what the pool is about to decide, so the id-free predicate is the
  // right one here. The id-aware `isAggressiveEffect` runs later, per target,
  // inside the mode gate.
  //    `opposedRoll` aims through `opponent` rather than `target`: `target` on a
  //    contest would mean "who does the whole bet happen to", which is not a
  //    question the card asks. Its default is `chosen-opponent`, so an
  //    un-annotated bet asks who it is against instead of rolling against the
  //    proposer.
  const aimedAt =
    effect.type === "opposedRoll" ? (effect.opponent ?? "chosen-opponent") : effectTarget(effect);
  const hostile = aimedAt !== "self" && isAggressiveEffectShape(effect);
  const targeting = isTableScoped(effect)
    ? ({ kind: "resolved", playerIds: [actorId] } as const)
    : resolveEffectTargets({ state: draft.state, actorId, target: aimedAt, hostile });

  if (targeting.kind === "choice-required") {
    if (targeting.candidateIds.length === 0) {
      skip(draft, "no-target", path, null);

      return;
    }

    // The mode gate runs *before* the question is asked. Hostility is a property
    // of the effect and of aiming away from the actor, both of which are already
    // known — so a mode with `targetedAttacks` off refuses the attack outright
    // rather than opening a prompt whose every answer would then be refused.
    const representative = targeting.candidateIds[0];
    if (representative !== undefined) {
      const gate = isEffectEnabled(rules, effect, actorId, representative);
      if (!gate.enabled) {
        skip(draft, "mode-disabled", path, null, gate.rule);

        return;
      }
    }

    const scope = options.idScope ?? "effects";
    const pending = park(draft, effect, actorId, [], path, "chosen-opponent", options);
    const legalResponses = targeting.candidateIds.map((candidateId) => ({
      id: createStableId("PromptOptionId", candidateId),
      value: candidateId as string,
    }));
    const first = legalResponses[0];
    if (first === undefined) return;

    const prompt: PromptState = {
      id: effectPromptId(draft.state, scope, path),
      // Shares the parked effect's frame: that is the link between the answer
      // and the effect it unblocks, since `PromptState` has no effect id field.
      frameId: pending.frameId,
      kind: CHOOSE_OPPONENT_PROMPT_KIND,
      audience: [actorId],
      legalResponses,
      deadlineAt: options.deadlineAt ?? null,
      // The first eligible opponent in `playerOrder` — deterministic, and not
      // something a stalling actor can steer.
      defaultResponse: { optionId: first.id, value: first.value },
      visibility: "public",
      responses: {},
    };
    draft.state = { ...draft.state, prompts: [...draft.state.prompts, prompt] };
    draft.prompts.push(prompt);

    return;
  }

  if (targeting.playerIds.length === 0) {
    skip(draft, "no-target", path, null);

    return;
  }

  // 3–5. Per target: mode gate, condition, immunity.
  const survivors: PlayerId[] = [];
  for (const targetId of targeting.playerIds) {
    const gate = isEffectEnabled(rules, effect, actorId, targetId);
    if (!gate.enabled) {
      skip(draft, "mode-disabled", path, targetId, gate.rule);
      continue;
    }

    if (effect.condition !== undefined && effect.condition !== null) {
      const condition = parseEffectCondition(effect.condition);
      if (condition === null) {
        skip(draft, "condition-unparseable", path, targetId);
        continue;
      }
      if (!evaluateEffectCondition(draft.state, condition, actorId, targetId)) {
        skip(draft, "condition-failed", path, targetId);
        continue;
      }
    }

    if (consumeImmunity(draft, effect, actorId, targetId, path, options)) continue;

    survivors.push(targetId);
  }

  if (survivors.length === 0) return;

  // 6. Preventable effects raise a window instead of landing, so somebody has a
  //    chance to cancel them. `openReactionWindow` is excluded: it *is* the
  //    window, and parking it behind another one would never terminate.
  if (
    isPreventable(effect) &&
    rules.interaction.reactionWindows &&
    effect.type !== "openReactionWindow"
  ) {
    const eligible = survivors.filter((playerId) => playerId !== actorId);
    if (eligible.length > 0) {
      const scope = options.idScope ?? "effects";
      const pending = park(draft, effect, actorId, survivors, path, "reaction-window", options);
      const window: ReactionWindowState = {
        id: effectWindowId(draft.state, scope, path),
        frameId: pending.frameId,
        kind: "prevention",
        eligiblePlayerIds: eligible,
        priorityPlayerId: eligible[0] ?? null,
        passedPlayerIds: [],
        playedByPlayerIds: [],
        deadlineAt: options.deadlineAt ?? null,
        pendingEffectId: pending.id,
      };
      draft.state = {
        ...draft.state,
        reactionWindows: [...draft.state.reactionWindows, window],
      };
      draft.windows.push(window);
      draft.trace.push({ type: "reaction-window-opened", window });

      return;
    }
  }

  // 7. A `chooseOne` is not applied to anybody — it *asks*, exactly as
  //    `chosen-opponent` does, and the answer is what lands.
  if (effect.type === "chooseOne") {
    openChoicePrompt(draft, effect, actorId, survivors, path, options);

    return;
  }

  // 8. `resolution: "shared"` — the default — means one roll for the whole
  //    target set. The v1 applier rolls inside itself, once per player it is
  //    handed, so delegating a multi-target `rollCheck` to it silently makes
  //    every card `per-target`: the field validated and did nothing, because
  //    both of its values behaved the same. A single target is left on the v1
  //    path deliberately, so `rerollEligible` and the Lucky Employee doubles
  //    passive keep working for the overwhelmingly common case.
  if (
    effect.type === "rollCheck" &&
    (effect.resolution ?? "shared") === "shared" &&
    survivors.length > 1
  ) {
    resolveSharedRollCheck(draft, effect, actorId, survivors, path, random, options);

    return;
  }

  // 9. Land it.
  for (const [index, targetId] of survivors.entries()) {
    applyToTarget(draft, effect, actorId, targetId, path, random, options, {
      index,
      count: survivors.length,
    });
  }
}

/**
 * One roll, one matched outcome, applied to every target — §3.9 rule 3's
 * `"shared"` resolution.
 *
 * The nested outcome effects inherit the roll's whole target set (rule 2), so a
 * six-seat table gets one result applied six times rather than one player being
 * paid six times.
 */
function resolveSharedRollCheck(
  draft: Draft,
  effect: Extract<EffectV2, { type: "rollCheck" }>,
  actorId: PlayerId,
  targetIds: readonly PlayerId[],
  path: string,
  random: RandomSource,
  options: EffectsV2Options,
): void {
  const first = rollDie(random, effect.dice.sides);
  const second = effect.dice.count === 2 ? rollDie(random, effect.dice.sides) : null;
  const total = first + (second ?? 0);
  const doubles = second !== null && second === first;

  draft.trace.push({
    type: "roll-check",
    total,
    doubles,
    resolution: "shared",
    playerIds: [...targetIds],
    path,
  });

  const outcome = matchRollOutcome(effect.outcomes, total, doubles);
  if (outcome === null) return;

  resolveNested(draft, outcome.effects, actorId, targetIds, `${path}:roll`, random, options);
}

/**
 * Opens the prompt a `chooseOne` resolves through.
 *
 * `chooser` (§3.3's amendment) decides *who picks*, independently of who the
 * branch effects land on: "the drawer picks after targeting" and "the target
 * picks the lesser evil" are different cards, and the workbook does not say
 * which unless the field does. `chosen-opponent` as a chooser resolves to the
 * eligible-opponent set as a **multi-audience** prompt — `PromptState.audience`
 * has always modelled that and has never been populated — rather than chaining a
 * second pick-an-opponent prompt in front of it.
 */
function openChoicePrompt(
  draft: Draft,
  effect: Extract<EffectV2, { type: "chooseOne" }>,
  actorId: PlayerId,
  targetIds: readonly PlayerId[],
  path: string,
  options: EffectsV2Options,
): void {
  if (effect.options.length === 0) {
    skip(draft, "choice-not-decided", path, null);

    return;
  }

  const chooserTargeting = resolveEffectTargets({
    state: draft.state,
    actorId,
    target: effect.chooser ?? "self",
    hostile: false,
  });
  const audience =
    chooserTargeting.kind === "choice-required"
      ? chooserTargeting.candidateIds
      : chooserTargeting.playerIds;
  if (audience.length === 0) {
    skip(draft, "no-target", path, null);

    return;
  }

  const scope = options.idScope ?? "effects";
  const pending = park(draft, effect, actorId, targetIds, path, "choose-one", options);
  const legalResponses = effect.options.map((option) => ({
    id: createStableId("PromptOptionId", option.id),
    value: option.id,
  }));
  const first = legalResponses[0];
  if (first === undefined) return;

  const prompt: PromptState = {
    id: effectPromptId(draft.state, scope, path),
    frameId: pending.frameId,
    kind: CHOOSE_ONE_PROMPT_KIND,
    audience: [...audience],
    legalResponses,
    deadlineAt: options.deadlineAt ?? null,
    // The first authored option, so a stalled choice is the one the author wrote
    // first rather than whichever happens to be cheapest to compute.
    defaultResponse: { optionId: first.id, value: first.value },
    visibility: "public",
    responses: {},
  };
  draft.state = { ...draft.state, prompts: [...draft.state.prompts, prompt] };
  draft.prompts.push(prompt);
  draft.trace.push({
    type: "choice-opened",
    playerIds: [...audience],
    optionIds: effect.options.map((option) => option.id),
    path,
  });
}

export type EffectsV2Input = {
  readonly state: GameState;
  /**
   * Whose effects these are. **Authorisation is the caller's job** — this
   * resolver treats `actorId` as already-verified, exactly as the engine's
   * existing transitions treat `command.actorId` after their own guard. It does
   * enforce the *game-legality* half: an effect can only reach a player the
   * targeting rules actually select, and a parked `chosen-opponent` effect can
   * only be aimed at a currently-eligible opponent.
   */
  readonly actorId: PlayerId;
  readonly effects: readonly EffectV2[];
  readonly random: RandomSource;
  readonly options?: EffectsV2Options;
};

/**
 * Resolve a batch of v2 effects against canonical state.
 *
 * Pure: no clock, no `Math.random`, no timers. Every draw comes from `random`
 * (the caller supplies an ephemeral source seeded from server-owned state — see
 * `ephemeral-random.ts`), every id is derived from `gameId` + `revision` + the
 * effect's position in the authored tree, and every ordering decision reads
 * `playerOrder`.
 *
 * Known gap, recorded rather than faked: `forceDiscard` discards from the front
 * of the target's hand rather than letting them choose. Choosing needs a second
 * prompt kind addressed to the *target*, which is the hand mechanic's to own.
 */
export function resolveEffectsV2(input: EffectsV2Input): EffectsV2Outcome {
  const options = input.options ?? {};
  const prefix = options.pathPrefix ?? "";
  const draft = newDraft(input.state);

  input.effects.forEach((effect, index) => {
    resolveOne(draft, effect, input.actorId, `${prefix}${index}`, input.random, options);
  });

  return finish(draft);
}

/* ------------------------------------------------------- resume / cancel */

export type ResumeResult =
  | { readonly ok: true; readonly outcome: EffectsV2Outcome }
  | {
      readonly ok: false;
      readonly reason:
        | "not-parked"
        | "not-effects-v2"
        | "actor-mismatch"
        | "target-not-eligible"
        | "option-not-offered";
    };

export type ResumePendingEffectOptions = {
  /**
   * The answer to a `chosen-opponent` prompt. Validated against the *current*
   * eligible-opponent set, so an answer cannot aim an effect at a player who was
   * never offered — or who has since been eliminated — even if the prompt layer
   * let it through.
   */
  readonly chosenPlayerIds?: readonly PlayerId[] | null;
  /**
   * The session identity the caller has already authenticated, checked against
   * the actor recorded when the effect was parked.
   *
   * Defence in depth for §6.3, and specifically for the case that matters: a
   * `chosen-opponent` prompt is answered by a *command*, and the identity that
   * submits that command must be the actor whose effect is waiting. Without this
   * check the route-level guard is the only thing standing between "player B
   * answers player A's prompt" and player B choosing who player A steals from.
   */
  readonly expectedActorId?: PlayerId | null;
  /**
   * The answer to a `chooseOne` prompt: the authored option id the chooser
   * picked. Validated against the parked effect's own option list, so a response
   * naming a branch this card never offered is refused rather than silently
   * falling through to the first one.
   */
  readonly chosenOptionId?: string | null;
  readonly effectOptions?: Partial<EffectsV2Options>;
};

function withoutPending(state: GameState, pending: PendingEffectState): GameState {
  return {
    ...state,
    pendingEffects: state.pendingEffects.filter((candidate) => candidate.id !== pending.id),
    reactionWindows: state.reactionWindows.filter(
      (window) => window.pendingEffectId !== pending.id,
    ),
  };
}

/**
 * Applies a parked effect now that whatever blocked it has resolved.
 *
 * **Idempotent by construction** (§7.1): the pending effect is looked up in
 * `state.pendingEffects` by id, so a second call — a duplicate `window.expire`,
 * a retried submit — finds nothing and returns `not-parked` rather than applying
 * the effect twice.
 *
 * Both authorisation checks of §6.3 run **before** anything mutates: the
 * resuming identity must be the actor the effect was parked for, and a chosen
 * target must be one this actor is currently entitled to pick.
 */
export function resumePendingEffect(
  state: GameState,
  pendingEffectRef: EffectId,
  random: RandomSource,
  resumeOptions: ResumePendingEffectOptions = {},
): ResumeResult {
  const pending = state.pendingEffects.find((candidate) => candidate.id === pendingEffectRef);
  if (pending === undefined) return { ok: false, reason: "not-parked" };

  const payload = decodePendingEffect(pending.effect);
  if (payload === null) return { ok: false, reason: "not-effects-v2" };

  const expectedActorId = resumeOptions.expectedActorId ?? null;
  if (expectedActorId !== null && expectedActorId !== payload.actorId) {
    return { ok: false, reason: "actor-mismatch" };
  }

  const chosenPlayerIds = resumeOptions.chosenPlayerIds ?? null;
  let targetPlayerIds = payload.targetPlayerIds;
  if (chosenPlayerIds !== null) {
    const eligible = resolveEffectTargets({
      state,
      actorId: payload.actorId,
      target: "chosen-opponent",
      hostile: true,
    });
    const candidates =
      eligible.kind === "choice-required" ? eligible.candidateIds : ([] as readonly PlayerId[]);
    if (
      chosenPlayerIds.length === 0 ||
      chosenPlayerIds.some((playerId) => !candidates.includes(playerId))
    ) {
      return { ok: false, reason: "target-not-eligible" };
    }
    // Kept in `playerOrder`, not in whatever order the answer listed them.
    targetPlayerIds = candidates.filter((playerId) => chosenPlayerIds.includes(playerId));
  }

  const cleared = withoutPending(state, pending);
  const draft = newDraft(cleared);
  const options: EffectsV2Options = {
    origin: payload.origin,
    sourceId: payload.sourceId,
    tileId: payload.tileId,
    idScope: payload.idScope,
    ...(resumeOptions.effectOptions ?? {}),
  };
  const resumedPath = `${payload.path}:resumed`;

  // A parked `chooseOne` resumes into *one branch*, not into itself: the answer
  // selects an effect list, and that list lands on the targets the choice was
  // parked with (§3.3). Validating the option id here rather than trusting the
  // prompt layer is the same defence-in-depth as `expectedActorId` — a response
  // naming a branch this card never offered must not fall through to the first.
  if (payload.effect.type === "chooseOne") {
    const options_ = payload.effect.options;
    const requested = resumeOptions.chosenOptionId ?? null;
    const chosen =
      requested === null
        ? options_[0]
        : options_.find((option) => option.id === requested);
    if (chosen === undefined) return { ok: false, reason: "option-not-offered" };

    draft.trace.push({ type: "choice-resolved", optionId: chosen.id, path: resumedPath });
    resolveNested(
      draft,
      chosen.effects,
      payload.actorId,
      targetPlayerIds,
      resumedPath,
      random,
      options,
    );

    return { ok: true, outcome: finish(draft) };
  }

  for (const [index, targetId] of targetPlayerIds.entries()) {
    applyToTarget(
      draft,
      payload.effect,
      payload.actorId,
      targetId,
      resumedPath,
      random,
      options,
      { index, count: targetPlayerIds.length },
    );
  }

  return { ok: true, outcome: finish(draft) };
}

/**
 * Drops a parked effect without applying it — what a *successful* prevention
 * does. Also idempotent: cancelling twice is a no-op.
 */
export function cancelPendingEffect(
  state: GameState,
  pendingEffectRef: EffectId,
): { readonly state: GameState; readonly cancelled: boolean } {
  const pending = state.pendingEffects.find((candidate) => candidate.id === pendingEffectRef);
  if (pending === undefined) return { state, cancelled: false };

  return { state: withoutPending(state, pending), cancelled: true };
}
