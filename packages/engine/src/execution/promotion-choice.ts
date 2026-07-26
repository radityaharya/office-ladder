import type {
  AttemptPromotionCommand,
  BlockPromotionCommand,
  DeclinePromotionCommand,
  GameCommand,
} from "../commands";
import type {
  ManagementRevealedEvent,
  MatchEndedEvent,
  PlayerPromotedEvent,
  PromotionAttemptedEvent,
  PromotionBlockedEvent,
  ReactionWindowOpenedEvent,
} from "../events";
import type {
  DecisionPointId,
  EffectId,
  FrameId,
  GameState,
  JsonObject,
  MatchOutcome,
  ModeRules,
  PendingEffectState,
  PlayerId,
  PlayerState,
  ReactionWindowState,
  UpkeepState,
} from "../model";
import { createStableId } from "../model";
import {
  AGENCY_STATUS_IDS,
  commit,
  createEventCollector,
  type EventCollector,
  findResourceEntry,
  pushMarker,
  pushResourceChanged,
  raiseHeat,
  readStatusData,
  removeStatus,
  requireSeatedActor,
  requireTurnActor,
  setStatus,
  writeResource,
} from "./agency";
import { rejectCommand } from "./errors";
import { resolvePromotion } from "./roll-promotion";
import type { TransitionContent, TransitionContext, TransitionResult } from "./types";

const PROMOTION_BLOCK_WINDOW_KIND = "promotion-block";

/**
 * Whether the roll transition should still promote a player behind their back.
 *
 * **This is the switch `roll-turn.ts` has to read.** Its automatic
 * `resolvePromotion` step must be guarded by this: when a mode makes promotion a
 * choice, climbing silently as a side effect of landing on a tile is exactly the
 * decision the mode is trying to hand to the player.
 */
export function promotionIsAutomatic(rules: ModeRules): boolean {
  return !rules.agency.promotionIsChoice;
}

/**
 * The upkeep seam.
 *
 * Promotion is only a *decision* if climbing can hurt. With
 * `agency.promotionRaisesUpkeep` the new rank's row of
 * `economy.upkeepByRankIndex` becomes the player's recurring charge, so taking
 * the title early is a bet that your income keeps up with it — and a player can
 * rationally decline. With the flag off, or with upkeep disabled entirely, this
 * is the identity function and promotion stays strictly good.
 *
 * Exported for the economy mechanic to reuse: whatever charges upkeep each round
 * must read the same `perRound` this writes, and `lastChargedRound` /
 * `missedPayments` are carried through untouched so a promotion never quietly
 * forgives a debt.
 */
export function upkeepAfterPromotion(
  upkeep: UpkeepState,
  rules: ModeRules,
  newRankIndex: number,
): UpkeepState {
  if (!rules.agency.promotionRaisesUpkeep || !rules.economy.upkeepEnabled) {
    return upkeep;
  }

  const ladder = rules.economy.upkeepByRankIndex;
  if (ladder.length === 0) return upkeep;

  const index = Math.min(Math.max(0, newRankIndex), ladder.length - 1);
  const perRound = ladder[index] ?? upkeep.perRound;
  if (perRound === upkeep.perRound) return upkeep;

  return { ...upkeep, perRound };
}

export type PromotionOffer = {
  readonly playerId: PlayerId;
  /** Raw content rank identifier, e.g. `"rank.staff"`. */
  readonly toRankId: string;
  readonly toTier: number;
  readonly toRankIndex: number;
  readonly cost: number;
  readonly moneyKey: string;
  readonly reputationKey: string;
  readonly isFinalRank: boolean;
  readonly upkeepBefore: number;
  readonly upkeepAfter: number;
  /**
   * The player has waved this rung off with `promotion.decline`. The offer is
   * still legal to take — declining is a preference, not a lock — but a legal
   * action list or a UI should stop pushing it until something changes.
   */
  readonly declined: boolean;
};

/**
 * The promotion available to a player right now, or null when there is none.
 *
 * Pure and cheap, so `legal-actions.ts` can call it to decide whether to
 * advertise `promotion.attempt`, and a panel can call it to show what the
 * climb would cost — including what it would do to upkeep, which is the whole
 * reason the choice exists.
 */
export function canAttemptPromotion(
  state: GameState,
  playerId: PlayerId,
  content: TransitionContent,
): PromotionOffer | null {
  const player = state.players[playerId];
  if (player === undefined) return null;

  const resolved = resolvePromotion(player, content, state.modeId, state.rules);
  if (!resolved.promoted) return null;

  const toRankIndex = player.rank.index + 1;
  const declinedAt = readStatusData(player, AGENCY_STATUS_IDS.promotionDeclined);
  const declinedRank = declinedAt === null ? null : declinedAt["atRankIndex"];

  return {
    playerId,
    toRankId: resolved.toRankId,
    toTier: resolved.toTier,
    toRankIndex,
    cost: resolved.cost,
    moneyKey: resolved.moneyKey,
    reputationKey: resolved.reputationKey,
    isFinalRank: resolved.isFinalRank,
    upkeepBefore: player.upkeep.perRound,
    upkeepAfter: upkeepAfterPromotion(player.upkeep, state.rules, toRankIndex).perRound,
    declined: declinedRank === player.rank.index,
  };
}

/** Why a promotion is unavailable, so the rejection can say something true. */
function promotionUnavailableReason(
  player: PlayerState,
  content: TransitionContent,
): "no-higher-rank" | "unaffordable" {
  const currentRank = content.ranks.find((rank) => rank.id === player.rank.kind);
  if (currentRank === undefined) return "no-higher-rank";

  const nextRank = content.ranks.find((rank) => rank.tier === currentRank.tier + 1);

  return nextRank === undefined || nextRank.promotionFromPrevious === null
    ? "no-higher-rank"
    : "unaffordable";
}

/* ------------------------------------------------------------------ *
 * Applying a promotion
 * ------------------------------------------------------------------ */

type PromotionApplication = {
  readonly player: PlayerState;
  readonly outcome: MatchOutcome | null;
};

/**
 * Charge the rung and hand over the title.
 *
 * Emits the pair the roll transition already emits — `PlayerPromoted` plus the
 * `ResourceChanged` for the money it cost — because a read model folding
 * `ResourceChanged` must never end a match richer than the snapshot.
 */
function applyPromotion(
  state: GameState,
  collector: EventCollector,
  player: PlayerState,
  offer: PromotionOffer,
  context: TransitionContext,
): PromotionApplication | null {
  const money = player.resources[offer.moneyKey];
  if (money === undefined) return null;

  const toRankId = createStableId("RankId", offer.toRankId);
  const paid = writeResource(player, offer.moneyKey, money, money.value - offer.cost);
  const promoted: PlayerState = {
    ...paid.player,
    rank: {
      id: toRankId,
      kind: offer.toRankId as PlayerState["rank"]["kind"],
      index: offer.toRankIndex,
    },
    upkeep: upkeepAfterPromotion(player.upkeep, state.rules, offer.toRankIndex),
    // The wave-off applied to the rung they just took; it says nothing about the
    // next one.
    statuses: removeStatus(paid.player, AGENCY_STATUS_IDS.promotionDeclined).statuses,
  };

  const promotedEvent: PlayerPromotedEvent = {
    ...collector.metadata(),
    type: "PlayerPromoted",
    payload: {
      playerId: promoted.id,
      fromRankId: createStableId("RankId", player.rank.kind ?? offer.toRankId),
      toRankId,
      cost: offer.cost,
    },
  };
  collector.events.push(promotedEvent);
  pushResourceChanged(
    collector,
    promoted.id,
    paid.resource,
    paid.previousValue,
    paid.newValue,
    "promotion-cost",
  );

  if (!offer.isFinalRank) {
    return { player: promoted, outcome: null };
  }

  const outcome: MatchOutcome = {
    reason: "director-reached",
    winnerPlayerIds: [promoted.id],
    winningRole: null,
    endedAt: context.logicalTimestamp,
    data: {},
    // Scoring (spec §5.6) has its own owner; fabricating a breakdown here would
    // be worse than an empty one.
    scores: [],
    winPath: "promotion",
  };
  const ended: MatchEndedEvent = {
    ...collector.metadata(),
    type: "MatchEnded",
    payload: { outcome },
  };
  collector.events.push(ended);

  return { player: promoted, outcome };
}

/* ------------------------------------------------------------------ *
 * The block window
 * ------------------------------------------------------------------ */

function windowIds(
  state: GameState,
  sequence: number,
): {
  readonly decisionPointId: DecisionPointId;
  readonly frameId: FrameId;
  readonly effectId: EffectId;
} {
  // Every id is derived from the game's own monotonic event counter, never from
  // the client-supplied command id: a client that chooses a decision-point id
  // chooses which window it is answering.
  return {
    decisionPointId: createStableId(
      "DecisionPointId",
      `${state.gameId}:promotion-block:${sequence}`,
    ),
    frameId: createStableId("FrameId", `${state.gameId}:frame:${sequence}`),
    effectId: createStableId("EffectId", `${state.gameId}:effect:${sequence}`),
  };
}

function pendingPromotionEffect(offer: PromotionOffer): JsonObject {
  return {
    kind: "promotion",
    playerId: offer.playerId,
    toRankId: offer.toRankId,
    toTier: offer.toTier,
    toRankIndex: offer.toRankIndex,
    cost: offer.cost,
    moneyKey: offer.moneyKey,
    reputationKey: offer.reputationKey,
    isFinalRank: offer.isFinalRank,
  };
}

function offerFromPendingEffect(effect: JsonObject): PromotionOffer | null {
  const playerId = effect["playerId"];
  const toRankId = effect["toRankId"];
  const cost = effect["cost"];
  const moneyKey = effect["moneyKey"];
  const reputationKey = effect["reputationKey"];
  if (
    effect["kind"] !== "promotion" ||
    typeof playerId !== "string" ||
    typeof toRankId !== "string" ||
    typeof cost !== "number" ||
    typeof moneyKey !== "string" ||
    typeof reputationKey !== "string"
  ) {
    return null;
  }

  const toTier = effect["toTier"];
  const toRankIndex = effect["toRankIndex"];

  return {
    playerId: playerId as PlayerId,
    toRankId,
    toTier: typeof toTier === "number" ? toTier : 0,
    toRankIndex: typeof toRankIndex === "number" ? toRankIndex : 0,
    cost,
    moneyKey,
    reputationKey,
    isFinalRank: effect["isFinalRank"] === true,
    upkeepBefore: 0,
    upkeepAfter: 0,
    declined: false,
  };
}

/** Every other seat that could conceivably answer a promotion-block window. */
function blockAudience(state: GameState, actorId: PlayerId): readonly PlayerId[] {
  return state.playerOrder.filter(
    (id) => id !== actorId && !state.eliminatedPlayerIds.includes(id),
  );
}

/**
 * Whether opening a block window would put the question to anybody real.
 *
 * The window's `eligiblePlayerIds` is deliberately *every* other seat rather
 * than the Management players: an eligibility list that named the blockers
 * would publish the hidden role to the whole table through the projection.
 * Authorisation is enforced at `management.block-promotion` instead, where the
 * answer is private.
 */
function hasManagementOpponent(state: GameState, actorId: PlayerId): boolean {
  return blockAudience(state, actorId).some(
    (id) => state.players[id]?.role.kind === "role.management",
  );
}

export type AttemptPromotionOptions = {
  /**
   * Open a `promotion-block` reaction window instead of resolving the promotion
   * on the spot.
   *
   * **Off by default, deliberately.** A reaction window is only safe once
   * something closes it: `applyCommand` and `rollTurn` both refuse every command
   * while `reactionWindows` is non-empty, so a window nobody expires freezes the
   * match. Spec §7.1 puts that expiry in the *server* (`window.expire`), and
   * until that producer exists this stays opt-in. It is still gated on
   * `interaction.reactionWindows`, on `hidden.rolesEnabled`, and on there
   * actually being a Management opponent, so switching it on cannot enable it in
   * a mode that turned reactions or roles off.
   */
  readonly openBlockWindow?: boolean;
};

/**
 * `promotion.attempt` — climbing, on purpose, because you decided to.
 *
 * Only legal while `rules.agency.promotionIsChoice`; in an automatic mode the
 * roll transition still does it for you and this command would double-charge.
 */
export function attemptPromotion(
  state: GameState,
  command: AttemptPromotionCommand,
  context: TransitionContext,
  options: AttemptPromotionOptions = {},
): TransitionResult {
  const guard = requireTurnActor(state, command);
  if (!guard.ok) return guard.rejection;

  if (promotionIsAutomatic(state.rules)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode promotes automatically, so promotion cannot be chosen",
    });
  }

  const player = guard.player;
  const offer = canAttemptPromotion(state, command.actorId, context.content);
  if (offer === null) {
    const reason = promotionUnavailableReason(player, context.content);

    return rejectCommand(state, command, {
      code: reason === "no-higher-rank" ? "ILLEGAL_ACTION" : "INSUFFICIENT_RESOURCE",
      message:
        reason === "no-higher-rank"
          ? "There is no rank above the actor's"
          : "The actor cannot yet afford the next rank",
    });
  }

  const collector = createEventCollector(state, command, context);
  const attempted: PromotionAttemptedEvent = {
    ...collector.metadata(),
    type: "PromotionAttempted",
    payload: {
      playerId: player.id,
      fromRankId: createStableId("RankId", player.rank.kind ?? offer.toRankId),
      toRankId: createStableId("RankId", offer.toRankId),
    },
  };
  collector.events.push(attempted);

  const opensWindow =
    options.openBlockWindow === true &&
    state.rules.interaction.reactionWindows &&
    state.rules.hidden.rolesEnabled &&
    hasManagementOpponent(state, command.actorId);

  if (opensWindow) {
    const ids = windowIds(state, collector.nextSequence());
    const pendingEffect: PendingEffectState = {
      id: ids.effectId,
      frameId: ids.frameId,
      sourceId: "promotion.attempt",
      affectedPlayerIds: [player.id],
      effect: pendingPromotionEffect(offer),
      preventionEligible: true,
      visibility: "public",
    };
    const window: ReactionWindowState = {
      id: ids.decisionPointId,
      frameId: ids.frameId,
      kind: PROMOTION_BLOCK_WINDOW_KIND,
      eligiblePlayerIds: blockAudience(state, command.actorId),
      priorityPlayerId: null,
      passedPlayerIds: [],
      playedByPlayerIds: [],
      // The engine never reads a clock. The server owns the scheduler that
      // fires `window.expire` and is what fills this in (spec §7.1).
      deadlineAt: null,
      pendingEffectId: ids.effectId,
    };
    const opened: ReactionWindowOpenedEvent = {
      ...collector.metadata(),
      type: "ReactionWindowOpened",
      payload: { reactionWindow: window },
    };
    collector.events.push(opened);

    return commit(
      state,
      command,
      collector,
      {},
      {
        pendingEffects: [...state.pendingEffects, pendingEffect],
        reactionWindows: [...state.reactionWindows, window],
      },
    );
  }

  const applied = applyPromotion(state, collector, player, offer, context);
  if (applied === null) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Promotion resolved without canonical money state",
    });
  }

  return commit(
    state,
    command,
    collector,
    { [applied.player.id]: applied.player },
    applied.outcome === null
      ? {}
      : { status: "ended", outcome: applied.outcome },
  );
}

/**
 * `promotion.decline` — say no, and mean it until something changes.
 *
 * Declining is only a real move where climbing can cost you something
 * (`agency.promotionRaisesUpkeep`), which is why it is gated on the same flag
 * that makes promotion a choice at all. It records the wave-off against the
 * *current* rank so the offer stops being pushed at the player, withdraws a
 * block window they had opened, and takes nothing from them: a later
 * `promotion.attempt` at the same rank is still legal.
 */
export function declinePromotion(
  state: GameState,
  command: DeclinePromotionCommand,
  context: TransitionContext,
): TransitionResult {
  const guard = requireTurnActor(state, command);
  if (!guard.ok) return guard.rejection;

  if (promotionIsAutomatic(state.rules)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode promotes automatically, so there is nothing to decline",
    });
  }

  const player = guard.player;
  const collector = createEventCollector(state, command, context);
  const updated = setStatus(player, AGENCY_STATUS_IDS.promotionDeclined, {
    atRankIndex: player.rank.index,
  });

  pushMarker(
    state,
    collector,
    { kind: "promotion.decline", atRankIndex: player.rank.index },
    [player.id],
  );

  return commit(state, command, collector, { [player.id]: updated });
}

/* ------------------------------------------------------------------ *
 * management.block-promotion
 * ------------------------------------------------------------------ */

type WindowLookup =
  | {
      readonly ok: true;
      readonly window: ReactionWindowState;
      readonly pendingEffect: PendingEffectState;
      readonly offer: PromotionOffer;
    }
  | { readonly ok: false; readonly rejection: TransitionResult };

function findPromotionWindow(
  state: GameState,
  command: GameCommand,
  decisionPointId: DecisionPointId,
): WindowLookup {
  const window = state.reactionWindows.find(
    (candidate) => candidate.id === decisionPointId,
  );
  if (window === undefined) {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "DECISION_POINT_NOT_FOUND",
        message: "No open reaction window for this decisionPointId",
      }),
    };
  }
  if (window.kind !== PROMOTION_BLOCK_WINDOW_KIND) {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "DECISION_POINT_STALE",
        message: "That window is not a promotion block",
      }),
    };
  }

  const pendingEffect = state.pendingEffects.find(
    (candidate) => candidate.id === window.pendingEffectId,
  );
  if (pendingEffect === undefined) {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "INVARIANT_VIOLATION",
        message: "The promotion window has no pending promotion",
      }),
    };
  }

  const offer = offerFromPendingEffect(pendingEffect.effect);
  if (offer === null) {
    return {
      ok: false,
      rejection: rejectCommand(state, command, {
        code: "INVARIANT_VIOLATION",
        message: "The pending promotion is malformed",
      }),
    };
  }

  return { ok: true, window, pendingEffect, offer };
}

function withoutWindow(
  state: GameState,
  window: ReactionWindowState,
  pendingEffect: PendingEffectState,
): Partial<GameState> {
  return {
    reactionWindows: state.reactionWindows.filter(
      (candidate) => candidate.id !== window.id,
    ),
    pendingEffects: state.pendingEffects.filter(
      (candidate) => candidate.id !== pendingEffect.id,
    ),
  };
}

/**
 * `management.block-promotion` — the Management role's one real power.
 *
 * Three checks, in this order, and all three matter. The window must exist and
 * still be open (a stale decision-point id must not cancel a promotion that has
 * already resolved). The actor must be in the window's audience — which is every
 * other seat, so the audience itself leaks nothing. And the actor must actually
 * hold `role.management`: that is the check that stops any player at the table
 * from vetoing any promotion, and it is why the eligibility list can afford to
 * be public.
 *
 * Blocking costs the blocker their cover — the role is revealed and announced —
 * and raises their heat where the mode models it. A veto nobody can price is a
 * veto everyone uses.
 */
export function blockPromotion(
  state: GameState,
  command: BlockPromotionCommand,
  context: TransitionContext,
): TransitionResult {
  const guard = requireSeatedActor(state, command);
  if (!guard.ok) return guard.rejection;

  if (!state.rules.interaction.reactionWindows || !state.rules.hidden.rolesEnabled) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode has no Management block",
    });
  }

  const lookup = findPromotionWindow(state, command, command.decisionPointId);
  if (!lookup.ok) return lookup.rejection;

  const { window, pendingEffect, offer } = lookup;
  if (!window.eligiblePlayerIds.includes(command.actorId)) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "The actor is not eligible to answer this window",
    });
  }
  if (
    window.passedPlayerIds.includes(command.actorId) ||
    window.playedByPlayerIds.includes(command.actorId)
  ) {
    return rejectCommand(state, command, {
      code: "DECISION_POINT_STALE",
      message: "The actor has already answered this window",
    });
  }

  const blocker = guard.player;
  if (blocker.role.kind !== "role.management") {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "Only a Management player can block a promotion",
    });
  }

  const collector = createEventCollector(state, command, context);
  const blocked: PromotionBlockedEvent = {
    ...collector.metadata(),
    type: "PromotionBlocked",
    payload: { playerId: offer.playerId, blockedByPlayerId: blocker.id },
  };
  collector.events.push(blocked);

  let updatedBlocker: PlayerState = blocker;
  if (!blocker.role.revealed) {
    updatedBlocker = { ...blocker, role: { ...blocker.role, revealed: true } };
    const revealed: ManagementRevealedEvent = {
      ...collector.metadata(),
      type: "ManagementRevealed",
      payload: { playerId: blocker.id, role: "role.management" },
    };
    collector.events.push(revealed);
  }
  updatedBlocker = raiseHeat(updatedBlocker, state.rules, state.turn.round);

  return commit(
    state,
    command,
    collector,
    { [updatedBlocker.id]: updatedBlocker },
    withoutWindow(state, window, pendingEffect),
  );
}

/**
 * Close a promotion-block window that nobody blocked, and let the promotion
 * through.
 *
 * **The `window.expire` seam** (spec §7.1): the server's scheduler submits an
 * expiry through the ordinary command path and this is what it calls. It is also
 * what a "everyone passed" resolution calls.
 *
 * Affordability is re-checked *here*, not trusted from when the window opened —
 * the promoting player may have been schemed against or charged upkeep in the
 * meantime, and a stale offer must not be cashable. An unaffordable promotion
 * closes the window and charges nothing rather than failing the command, so a
 * missed or duplicated fire can never wedge the match. Firing twice is safe by
 * construction: the second call finds no window and is rejected with
 * `DECISION_POINT_NOT_FOUND` instead of promoting again.
 */
export function resolvePendingPromotion(
  state: GameState,
  command: GameCommand,
  decisionPointId: DecisionPointId,
  context: TransitionContext,
): TransitionResult {
  // Nobody at the table gets to close their own block window. Only the two
  // command types that legitimately end a reaction window may drive this — the
  // server's expiry and the last eligible player passing — so a promoting
  // player cannot force their promotion through before Management can answer.
  // `window.expire` is itself server-injected only, refused at the route
  // (spec §7.1, §11.1).
  if (command.type !== "window.expire" && command.type !== "reaction.pass") {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_AUTHORIZED",
      message: "A pending promotion resolves only when its window closes",
    });
  }

  const lookup = findPromotionWindow(state, command, decisionPointId);
  if (!lookup.ok) return lookup.rejection;

  const { window, pendingEffect, offer } = lookup;
  const player = state.players[offer.playerId];
  if (player === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The pending promotion names an unknown player",
    });
  }

  const collector = createEventCollector(state, command, context);
  const patch = withoutWindow(state, window, pendingEffect);
  const money = findResourceEntry(player, "resource.money");
  const reputation = findResourceEntry(player, "resource.reputation");
  const current = canAttemptPromotion(state, offer.playerId, context.content);

  if (
    money === null ||
    reputation === null ||
    current === null ||
    current.toRankId !== offer.toRankId ||
    money[1].value < offer.cost
  ) {
    pushMarker(
      state,
      collector,
      { kind: "promotion.lapsed", playerId: offer.playerId, toRankId: offer.toRankId },
      [offer.playerId],
    );

    return commit(state, command, collector, {}, patch);
  }

  const applied = applyPromotion(state, collector, player, current, context);
  if (applied === null) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Promotion resolved without canonical money state",
    });
  }

  return commit(
    state,
    command,
    collector,
    { [applied.player.id]: applied.player },
    applied.outcome === null
      ? patch
      : { ...patch, status: "ended", outcome: applied.outcome },
  );
}
