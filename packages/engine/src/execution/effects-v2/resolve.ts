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
import type { RandomSource } from "../../random";
import { findActiveStatus } from "../player-status";
import {
  applySelfEffects,
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
  | "no-cards-to-discard";

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
      readonly reason: "reaction-window" | "chosen-opponent";
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

/* -------------------------------------------------------- the v2 appliers */

function applyNewEffect(
  draft: Draft,
  effect: NewEffectV2,
  actorId: PlayerId,
  targetId: PlayerId,
  path: string,
  options: EffectsV2Options,
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
        // Stealing from yourself is a no-op, not an error: an `all-players`
        // steal legitimately includes the actor.
        return;
      }
      const available = target.resources[effect.resource]?.value ?? 0;
      const wanted = Math.max(0, effect.amount);
      if (effect.insufficientFunds === "all-or-nothing" && available < wanted) {
        skip(draft, "insufficient-resources", path, targetId);

        return;
      }
      const moved = Math.min(wanted, available);
      if (moved === 0) {
        skip(draft, "insufficient-resources", path, targetId);

        return;
      }

      const taken = moveResource(target, effect.resource, -moved);
      const given = moveResource(actor, effect.resource, moved, false);
      writePlayer(draft, taken.player);
      writePlayer(draft, given.player);
      recordChange(draft, targetId, taken.change);
      recordChange(draft, actorId, given.change);

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
      const tileId = contextualTileId(state, target, effect.tileId ?? options.tileId ?? null);
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
      const tileId = contextualTileId(state, target, effect.tileId ?? options.tileId ?? null);
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
      const tileId = contextualTileId(state, target, effect.tileId ?? options.tileId ?? null);
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
        tileId: contextualTileId(state, target, effect.tileId ?? options.tileId ?? null),
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
      const charges = Math.max(1, effect.charges ?? 1);
      const rounds = effect.rounds ?? null;
      const existing = findActiveStatus(target, IMMUNITY_STATUS_ID);
      const statuses = [
        ...target.statuses.filter((status) => status.id !== IMMUNITY_STATUS_ID),
        {
          id: createStableId("StatusId", IMMUNITY_STATUS_ID),
          sourceId: options.sourceId ?? null,
          // Stacked, not replaced: two defensive cards must give two blocks, or
          // the second one silently does nothing.
          stacks: (existing?.stacks ?? 0) + charges,
          remainingTurns: rounds,
          expiresAtRound: rounds === null ? null : state.turn.round + rounds,
          visibility: "public" as const,
          data: {} as JsonObject,
        },
      ];
      writePlayer(draft, { ...target, statuses });
      draft.trace.push({ type: "immunity-granted", playerId: targetId, charges, rounds });

      return;
    }
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
          : state.tileIds.indexOf(effect.destination.tileId);
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

function applyToTarget(
  draft: Draft,
  effect: EffectV2,
  actorId: PlayerId,
  targetId: PlayerId,
  path: string,
  random: RandomSource,
  options: EffectsV2Options,
): void {
  if (isLegacyEffect(effect)) {
    applyLegacyToTarget(draft, effect, targetId, random, options);

    return;
  }

  applyNewEffect(draft, effect, actorId, targetId, path, options);
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
  reason: "reaction-window" | "chosen-opponent",
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
  const hostile = effectTarget(effect) !== "self" && isAggressiveEffectShape(effect);
  const targeting = isTableScoped(effect)
    ? ({ kind: "resolved", playerIds: [actorId] } as const)
    : resolveEffectTargets({ state: draft.state, actorId, target: effectTarget(effect), hostile });

  if (targeting.kind === "choice-required") {
    if (targeting.candidateIds.length === 0) {
      skip(draft, "no-target", path, null);

      return;
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

    if (isPreventable(effect) && targetId !== actorId) {
      const target = draft.state.players[targetId];
      const immunity = target === undefined ? null : findActiveStatus(target, IMMUNITY_STATUS_ID);
      if (target !== undefined && immunity !== null) {
        // Real consumption: one charge is spent and the status disappears once
        // exhausted, so an immunity that blocked something cannot block again.
        const statuses = target.statuses
          .map((status) =>
            status.id === IMMUNITY_STATUS_ID ? { ...status, stacks: status.stacks - 1 } : status,
          )
          .filter((status) => status.stacks > 0);
        writePlayer(draft, { ...target, statuses });
        skip(draft, "immune", path, targetId);
        continue;
      }
    }

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

  // 7. Land it.
  for (const targetId of survivors) {
    applyToTarget(draft, effect, actorId, targetId, path, random, options);
  }
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
        | "target-not-eligible";
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

  for (const targetId of targetPlayerIds) {
    applyToTarget(
      draft,
      payload.effect,
      payload.actorId,
      targetId,
      `${payload.path}:resumed`,
      random,
      options,
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
