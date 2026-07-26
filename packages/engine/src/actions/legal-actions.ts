import { deadlineDashContent } from "@office-ladder/content";

import type {
  AgreementId,
  BallotId,
  CardInstanceId,
  DecisionPointId,
  GameState,
  LoanId,
  PlacementKind,
  PlayerId,
  PlayerState,
  ProjectId,
  PromptOptionId,
  TileId,
} from "../model";
import {
  abilityAvailability,
  characterActiveAbilityId,
  turnActionBudget,
} from "../execution/agency";
import { canOfferAgreement, openAgreementsAwaiting } from "../execution/agreements";
import { ATTACK_VECTORS } from "../execution/attack";
import { applyLeaderProtection } from "../execution/heat";
import { ROLE_REVEAL_ACTION } from "../execution/apply-command";
import { openBallotsForPlayer } from "../execution/ballots";
import { cardTiming } from "../execution/deck-depletion";
import { enabledFreeActions, freeActionsRemaining } from "../execution/free-action";
import { loanCapacity } from "../execution/loans";
import {
  PLACEMENT_KINDS,
  activePlacementCount,
  placementCost,
} from "../execution/placements";
import { findCardDefinition, playableCardIds, spendableTokens } from "../execution/play-card";
import { canAttemptPromotion, promotionIsAutomatic } from "../execution/promotion-choice";
import {
  affordableProjectDefinitions,
  contributableProjects,
  sabotageableProjects,
} from "../execution/projects";
import { openReactionWindowsFor } from "../execution/reaction-window";
import {
  MAX_TILE_LEVEL,
  findResourceOfKind,
  isClaimableTile,
  spendableAmount,
  tileClaimCost,
  tileUpgradeCost,
} from "../execution/tile-ownership";
import type { TransitionContent } from "../execution/types";

/**
 * What the actor may legally do **right now**.
 *
 * This is the contract between the engine and every UI, bot and turn-timeout
 * policy in the system, and it has one property that matters more than
 * completeness: a command that works but is never reported here is invisible and
 * therefore does not exist. The enumerator is an *advertisement*, not the
 * authority — every transition re-checks its own preconditions — so it is
 * allowed to be slightly conservative, and it must never be optimistic.
 *
 * Two structural changes from the roll-and-move version:
 *
 * 1. **It no longer assumes the reader is the active player.** Reaction windows,
 *    ballots and agreement offers are answered out of turn by design, so they
 *    are enumerated before anything that looks at `turn.activePlayerId`. A
 *    spectator seat with a ballot to cast is the entire point of §7.3.
 * 2. **A blocked actor is not a silent one.** The old shape returned `[]` for
 *    anyone the pending-work guard would refuse. It still refuses them the
 *    turn-scoped verbs, but the answers to the block itself stay on the list.
 *
 * Server-injected commands (`window.expire`, `quarter.advance`, `turn.timeout`)
 * are deliberately absent: they are never legal for a player, and advertising
 * them would be advertising an exploit.
 */

type LegalActionBase = {
  readonly gameId: GameState["gameId"];
  readonly actorId: PlayerId;
  readonly expectedRevision: number;
};

/** What a reaction could be played *with*, so the UI can offer real choices. */
export type ReactionResources = {
  readonly cardIds: readonly CardInstanceId[];
  readonly abilityIds: readonly string[];
};

export type LegalAction =
  | (LegalActionBase & { readonly type: "game.start"; readonly payload: Record<string, never> })
  | (LegalActionBase & { readonly type: "turn.roll"; readonly payload: Record<string, never> })
  | (LegalActionBase & {
      readonly type: "prompt.respond";
      readonly decisionPointId: GameState["prompts"][number]["id"];
      readonly kind: string;
      readonly options: readonly PromptOptionId[];
    })
  | (LegalActionBase & {
      readonly type: "reaction.play";
      readonly decisionPointId: DecisionPointId;
      readonly kind: GameState["reactionWindows"][number]["kind"];
      readonly cardIds: readonly CardInstanceId[];
      readonly abilityIds: readonly string[];
    })
  | (LegalActionBase & {
      readonly type: "reaction.pass";
      readonly decisionPointId: DecisionPointId;
      readonly kind: GameState["reactionWindows"][number]["kind"];
    })
  | (LegalActionBase & {
      readonly type: "management.block-promotion";
      readonly decisionPointId: DecisionPointId;
    })
  | (LegalActionBase & {
      readonly type: "ballot.cast";
      readonly ballotId: BallotId;
      readonly kind: "vote" | "auction";
      readonly subjectId: string;
    })
  | (LegalActionBase & {
      readonly type: "agreement.respond";
      readonly agreementId: AgreementId;
      readonly proposerId: PlayerId;
    })
  | (LegalActionBase & {
      readonly type: "agreement.offer";
      readonly payload: Record<string, never>;
    })
  | (LegalActionBase & {
      readonly type: "turn.adjust-roll";
      readonly maxPips: number;
      readonly energyPerPip: number;
    })
  | (LegalActionBase & {
      readonly type: "turn.action";
      readonly actions: readonly string[];
      readonly remaining: number;
    })
  | (LegalActionBase & {
      readonly type: "turn.play-card";
      readonly cardIds: readonly CardInstanceId[];
    })
  | (LegalActionBase & {
      readonly type: "turn.spend-token";
      readonly tokens: readonly {
        readonly tokenId: string;
        readonly use: string;
        readonly maxQuantity: number;
      }[];
    })
  | (LegalActionBase & {
      readonly type: "turn.activate-character";
      readonly abilityId: string;
    })
  | (LegalActionBase & {
      readonly type: "promotion.attempt";
      readonly toRankId: string;
      readonly cost: number;
      readonly declined: boolean;
    })
  | (LegalActionBase & {
      readonly type: "promotion.decline";
      readonly payload: Record<string, never>;
    })
  | (LegalActionBase & {
      readonly type: "audit.pay-fine";
      readonly payload: Record<string, never>;
    })
  | (LegalActionBase & {
      readonly type: "management.shuffle-deck";
      readonly deckIds: readonly string[];
    })
  | (LegalActionBase & {
      readonly type: "tile.claim";
      readonly tileId: TileId;
      readonly cost: number;
    })
  | (LegalActionBase & {
      readonly type: "tile.upgrade";
      readonly tileId: TileId;
      readonly level: number;
      readonly cost: number;
    })
  | (LegalActionBase & {
      readonly type: "placement.place";
      readonly kinds: readonly { readonly kind: PlacementKind; readonly cost: number }[];
    })
  | (LegalActionBase & {
      readonly type: "project.start";
      readonly definitionIds: readonly string[];
    })
  | (LegalActionBase & {
      readonly type: "project.contribute";
      readonly projectIds: readonly ProjectId[];
    })
  | (LegalActionBase & {
      readonly type: "project.sabotage";
      readonly projectIds: readonly ProjectId[];
    })
  | (LegalActionBase & {
      readonly type: "attack.target";
      readonly targetPlayerIds: readonly PlayerId[];
      readonly vectors: readonly string[];
    })
  | (LegalActionBase & { readonly type: "loan.take"; readonly capacity: number })
  | (LegalActionBase & {
      readonly type: "loan.repay";
      readonly loans: readonly { readonly loanId: LoanId; readonly outstanding: number }[];
    });

/* ------------------------------------------------------------------ *
 * Shared reads
 * ------------------------------------------------------------------ */

function moneyOf(player: PlayerState): number {
  const handle = findResourceOfKind(player, "resource.money");

  return handle === null ? 0 : spendableAmount(handle);
}

function energyOf(player: PlayerState): number {
  const handle = findResourceOfKind(player, "resource.energy");

  return handle === null ? 0 : spendableAmount(handle);
}

function currentTileId(state: GameState, player: PlayerState): TileId | null {
  return state.tileIds[player.position] ?? null;
}

/**
 * The same predicate `applyCommand` and `requireTurnActor` apply: while the
 * engine is mid-resolution, the turn-scoped verbs are refused. Everything the
 * enumerator offers *despite* this is an answer to the block itself.
 */
function hasBlockingWork(state: GameState, actorId: PlayerId): boolean {
  return (
    state.resolutionStack.length > 0 ||
    state.pendingEffects.length > 0 ||
    state.reactionWindows.length > 0 ||
    state.prompts.some((prompt) => prompt.audience.includes(actorId))
  );
}

/* ------------------------------------------------------------------ *
 * Out-of-turn actions
 * ------------------------------------------------------------------ */

/**
 * Reactions, offered to whoever the window is waiting on — never gated on whose
 * turn it is, because reacting out of turn is the entire mechanic.
 *
 * A `promotion-block` window is answered with `management.block-promotion`
 * rather than `reaction.play`, and only by a player who actually holds
 * `role.management`; the audience is every other seat precisely so the
 * eligibility list itself leaks nothing about who can really block.
 */
function reactionActions(
  state: GameState,
  base: LegalActionBase,
  player: PlayerState,
  content: TransitionContent,
): readonly LegalAction[] {
  const actions: LegalAction[] = [];

  for (const window of openReactionWindowsFor(state, player.id)) {
    if (window.kind === "promotion-block") {
      if (
        state.rules.interaction.reactionWindows &&
        state.rules.hidden.rolesEnabled &&
        player.role.kind === "role.management"
      ) {
        actions.push({ ...base, type: "management.block-promotion", decisionPointId: window.id });
      }
    } else {
      const resources = reactionResources(state, player, content);
      if (resources.cardIds.length > 0 || resources.abilityIds.length > 0) {
        actions.push({
          ...base,
          type: "reaction.play",
          decisionPointId: window.id,
          kind: window.kind,
          cardIds: resources.cardIds,
          abilityIds: resources.abilityIds,
        });
      }
    }

    actions.push({
      ...base,
      type: "reaction.pass",
      decisionPointId: window.id,
      kind: window.kind,
    });
  }

  return actions;
}

/**
 * What this player could answer a window with. Cards need `agency.handEnabled`
 * (the reaction transition refuses them otherwise) and must be authored as
 * reaction-timed; abilities need a use left and no cooldown.
 */
function reactionResources(
  state: GameState,
  player: PlayerState,
  content: TransitionContent,
): ReactionResources {
  const cardIds = state.rules.agency.handEnabled
    ? player.hand.filter((cardId) => {
        const card = state.cards[cardId];
        if (card === undefined || card.zone !== "hand" || card.ownerId !== player.id) {
          return false;
        }
        const definition = findCardDefinition(content.decks, card.deckId, card.definitionId);

        return definition !== null && cardTiming(definition) === "reaction";
      })
    : [];

  const abilityIds = player.abilities
    .filter(
      (ability) =>
        ability.cooldownLapsRemaining <= 0 &&
        (ability.usesRemaining === null || ability.usesRemaining > 0),
    )
    .map((ability) => String(ability.id));

  return { cardIds, abilityIds };
}

/** Ballots and agreements: the two verbs that exist to remove dead time (§7.3). */
function tableActions(
  state: GameState,
  base: LegalActionBase,
  player: PlayerState,
): readonly LegalAction[] {
  const actions: LegalAction[] = [];

  for (const ballot of openBallotsForPlayer(state, player.id)) {
    actions.push({
      ...base,
      type: "ballot.cast",
      ballotId: ballot.id,
      kind: ballot.kind,
      subjectId: ballot.subjectId,
    });
  }

  for (const agreement of openAgreementsAwaiting(state, player.id)) {
    actions.push({
      ...base,
      type: "agreement.respond",
      agreementId: agreement.id,
      proposerId: agreement.proposerId,
    });
  }

  if (canOfferAgreement(state, player.id)) {
    actions.push({ ...base, type: "agreement.offer", payload: {} });
  }

  return actions;
}

/**
 * Loans are the one economic verb that stays available while the actor is
 * blocked by their own prompt: borrowing to afford the fine the prompt is asking
 * for is the case the mechanic exists for. They still require the actor's own
 * turn — `guardLoanCommand` enforces that — so they are not out-of-turn actions.
 */
function loanActions(
  state: GameState,
  base: LegalActionBase,
  player: PlayerState,
): readonly LegalAction[] {
  if (!state.rules.economy.loansEnabled) return [];
  if (state.status !== "active") return [];
  if (state.turn.activePlayerId !== player.id) return [];
  if (state.turn.phase === "not-started" || state.turn.phase === "game-over") return [];

  const actions: LegalAction[] = [];
  const capacity = loanCapacity(player, state.rules);
  if (capacity > 0) {
    actions.push({ ...base, type: "loan.take", capacity });
  }

  const repayable = player.loans
    .filter((loan) => loan.outstanding > 0)
    .map((loan) => ({ loanId: loan.id, outstanding: loan.outstanding }));
  if (repayable.length > 0 && moneyOf(player) > 0) {
    actions.push({ ...base, type: "loan.repay", loans: repayable });
  }

  return actions;
}

/* ------------------------------------------------------------------ *
 * Turn actions
 * ------------------------------------------------------------------ */

function agencyActions(
  state: GameState,
  base: LegalActionBase,
  player: PlayerState,
  content: TransitionContent,
): readonly LegalAction[] {
  const actions: LegalAction[] = [];
  const rules = state.rules;

  if (rules.agency.diceAdjustEnabled && rules.agency.maxPipAdjust > 0) {
    const energyPerPip = Math.max(0, rules.agency.energyPerPip);
    if (energyOf(player) >= energyPerPip) {
      actions.push({
        ...base,
        type: "turn.adjust-roll",
        maxPips: rules.agency.maxPipAdjust,
        energyPerPip,
      });
    }
  }

  const budget = turnActionBudget(state, player);
  const freeActions: string[] = [...enabledFreeActions(rules)];
  const remaining = freeActionsRemaining(state, player);
  // Revealing your own role rides on `turn.action` but spends no budget: it is a
  // social move, not one of the four economic verbs.
  const canReveal =
    rules.hidden.rolesEnabled && player.role.kind !== null && !player.role.revealed;
  const offered = remaining > 0 ? freeActions : [];
  const verbs = canReveal ? [...offered, ROLE_REVEAL_ACTION] : offered;
  if (verbs.length > 0) {
    actions.push({ ...base, type: "turn.action", actions: verbs, remaining });
  }

  const cardIds = playableCardIds(state, player.id, content);
  if (cardIds.length > 0) {
    actions.push({ ...base, type: "turn.play-card", cardIds });
  }

  const tokens = spendableTokens(state, player.id);
  if (tokens.length > 0) {
    actions.push({
      ...base,
      type: "turn.spend-token",
      tokens: tokens.map((token) => ({
        tokenId: String(token.tokenId),
        use: token.use,
        maxQuantity: token.maxQuantity,
      })),
    });
  }

  const character = Object.values(content.characters).find(
    (candidate) => candidate.id === player.characterId,
  );
  if (character !== undefined && budget.perTurn > 0 && budget.remaining > 0) {
    const abilityId = characterActiveAbilityId(character.id);
    const targeted =
      character.active.effect.type === "swapBoardPositions" ||
      character.active.effect.type === "stealResource";
    if (
      abilityAvailability(state, player, abilityId).ready &&
      (!targeted || rules.conflict.targetedAttacks)
    ) {
      actions.push({ ...base, type: "turn.activate-character", abilityId: String(abilityId) });
    }
  }

  return actions;
}

function promotionActions(
  state: GameState,
  base: LegalActionBase,
  player: PlayerState,
  content: TransitionContent,
): readonly LegalAction[] {
  if (promotionIsAutomatic(state.rules)) return [];

  const offer = canAttemptPromotion(state, player.id, content);
  if (offer === null) return [];

  return [
    {
      ...base,
      type: "promotion.attempt",
      toRankId: offer.toRankId,
      cost: offer.cost,
      declined: offer.declined,
    },
    { ...base, type: "promotion.decline", payload: {} },
  ];
}

function boardActions(
  state: GameState,
  base: LegalActionBase,
  player: PlayerState,
  content: TransitionContent,
): readonly LegalAction[] {
  const actions: LegalAction[] = [];
  const rules = state.rules;
  const tileId = currentTileId(state, player);
  const money = moneyOf(player);

  if (rules.board.ownershipEnabled && tileId !== null) {
    const owned = state.tileOwnership[tileId];
    if (owned === undefined) {
      const cost = tileClaimCost(rules);
      if (isClaimableTile(content.board.spaces, tileId) && money >= cost) {
        actions.push({ ...base, type: "tile.claim", tileId, cost });
      }
    } else if (
      rules.board.upgradesEnabled &&
      owned.ownerId === player.id &&
      owned.level < MAX_TILE_LEVEL
    ) {
      const cost = tileUpgradeCost(rules, owned.level);
      if (money >= cost) {
        actions.push({
          ...base,
          type: "tile.upgrade",
          tileId,
          level: owned.level + 1,
          cost,
        });
      }
    }
  }

  if (
    rules.board.placementsEnabled &&
    activePlacementCount(state.placements, player.id) < rules.board.maxPlacementsPerPlayer
  ) {
    const kinds = PLACEMENT_KINDS.map((kind) => ({
      kind,
      cost: placementCost(rules, kind),
    })).filter((entry) => money >= entry.cost);
    if (kinds.length > 0) {
      actions.push({ ...base, type: "placement.place", kinds });
    }
  }

  return actions;
}

function projectActions(
  state: GameState,
  base: LegalActionBase,
  player: PlayerState,
): readonly LegalAction[] {
  const actions: LegalAction[] = [];

  const startable = affordableProjectDefinitions(state, player.id);
  if (startable.length > 0) {
    actions.push({
      ...base,
      type: "project.start",
      definitionIds: startable.map((definition) => definition.id),
    });
  }

  const contributable = contributableProjects(state, player.id);
  if (contributable.length > 0) {
    actions.push({
      ...base,
      type: "project.contribute",
      projectIds: contributable.map((project) => project.id),
    });
  }

  const sabotageable = sabotageableProjects(state, player.id);
  if (sabotageable.length > 0) {
    actions.push({
      ...base,
      type: "project.sabotage",
      projectIds: sabotageable.map((project) => project.id),
    });
  }

  return actions;
}

/**
 * `attack.target`, offered only when there is somebody it could legally reach.
 *
 * Leader protection is asked the same way the transition asks it, so a `hard`
 * ruleset never advertises an attack on the leader that `targetAttack` would
 * then refuse — an offered-then-rejected action is worse than no action at all.
 */
function attackActions(
  state: GameState,
  base: LegalActionBase,
  player: PlayerState,
): readonly LegalAction[] {
  if (!state.rules.conflict.targetedAttacks) return [];

  const energy = energyOf(player);
  const vectors = Object.values(ATTACK_VECTORS)
    .filter((vector) => vector.cost.resource !== "energy" || energy >= vector.cost.amount)
    .map((vector) => vector.id);
  if (vectors.length === 0) return [];

  const targetPlayerIds = state.playerOrder.filter(
    (candidate) =>
      candidate !== player.id &&
      state.players[candidate] !== undefined &&
      !state.eliminatedPlayerIds.includes(candidate) &&
      applyLeaderProtection(state, candidate).kind !== "forbidden",
  );
  if (targetPlayerIds.length === 0) return [];

  return [{ ...base, type: "attack.target", targetPlayerIds, vectors }];
}

function managementActions(
  state: GameState,
  base: LegalActionBase,
  player: PlayerState,
): readonly LegalAction[] {
  if (!state.rules.hidden.rolesEnabled) return [];
  if (player.role.kind !== "role.management") return [];

  const deckIds = Object.values(state.decks)
    .filter((deck) => deck.managementShuffleEligible)
    .map((deck) => String(deck.id))
    .sort();
  if (deckIds.length === 0) return [];

  return [{ ...base, type: "management.shuffle-deck", deckIds }];
}

/* ------------------------------------------------------------------ *
 * enumerateLegalActions
 * ------------------------------------------------------------------ */

export function enumerateLegalActions(
  state: GameState,
  actorId: PlayerId,
  content: TransitionContent = deadlineDashContent,
): readonly LegalAction[] {
  const player = state.players[actorId];
  if (player === undefined) return [];
  if (state.eliminatedPlayerIds.includes(actorId)) return [];

  const base: LegalActionBase = {
    gameId: state.gameId,
    actorId,
    expectedRevision: state.revision,
  };

  // Out-of-turn first, and unconditionally: these are exactly the actions the
  // old enumerator's "is it your turn" shape made unreachable.
  const outOfTurn: LegalAction[] = [
    ...reactionActions(state, base, player, content),
    ...tableActions(state, base, player),
  ];

  const ownPrompt = state.prompts.find((prompt) => prompt.audience.includes(actorId));
  // A prompt outlives the match that opened it: an audit-release prompt stays
  // open while the turn moves on, so another player can reach Director while it
  // is still pending and leave the audited player both active and holding a
  // prompt in an ended game. applyCommand rejects every command at that point
  // (GAME_ALREADY_ENDED), so advertising the response here would offer an action
  // that can only ever fail.
  if (
    ownPrompt !== undefined &&
    state.status === "active" &&
    state.turn.activePlayerId === actorId
  ) {
    // The prompt is the decision. `audit.pay-fine` is deliberately not added
    // alongside it: the audit-release prompt already offers `pay-fine` as one of
    // its own options, and two routes to one choice is two things to keep in
    // step. Loans stay, because affording the fine is the point.
    return [
      ...outOfTurn,
      {
        ...base,
        type: "prompt.respond",
        decisionPointId: ownPrompt.id,
        kind: ownPrompt.kind,
        options: ownPrompt.legalResponses.map((option) => option.id),
      },
      ...loanActions(state, base, player),
    ];
  }

  const blocked = hasBlockingWork(state, actorId);

  if (
    state.status === "setup" &&
    state.turn.phase === "not-started" &&
    state.startAuthorizedPlayerId === actorId &&
    !blocked
  ) {
    return [...outOfTurn, { ...base, type: "game.start", payload: {} }];
  }

  if (
    state.status !== "active" ||
    state.turn.activePlayerId !== actorId ||
    state.turn.phase !== "pre-roll" ||
    blocked
  ) {
    return outOfTurn;
  }

  return [
    ...outOfTurn,
    { ...base, type: "turn.roll", payload: {} },
    ...agencyActions(state, base, player, content),
    ...promotionActions(state, base, player, content),
    ...boardActions(state, base, player, content),
    ...projectActions(state, base, player),
    ...attackActions(state, base, player),
    ...managementActions(state, base, player),
    ...loanActions(state, base, player),
    ...(player.inAudit ? [{ ...base, type: "audit.pay-fine" as const, payload: {} }] : []),
  ];
}
