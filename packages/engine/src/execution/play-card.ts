import type { DeckCard, DeckConfig } from "@office-ladder/content";

import type { PlayCardCommand, SpendTokenCommand } from "../commands";
import type {
  CardDrawnEvent,
  CardPlayedEvent,
  GameEvent,
  ResourceChangedEvent,
  StatusAppliedEvent,
} from "../events";
import type {
  CardInstanceId,
  CardState,
  GameState,
  PlayerId,
  PlayerState,
  TokenId,
  TokenState,
} from "../model";
import { createStableId } from "../model";
import { cardTiming, createCardRandom, discardCard } from "./deck-depletion";
import { rejectCommand } from "./errors";
import { createEventMetadata } from "./events";
import { findHeldCard } from "./hand";
import { applyStatusEffect, findActiveStatus } from "./player-status";
import { applyEffectDescriptors } from "./resolve-tile-effects";
import type { TransitionContext, TransitionResult } from "./types";

/**
 * The status a spent move token writes. Already consumed by `roll-turn.ts`,
 * which adds `data.spaces` to the next die and then clears the status — so
 * spending a token needs no change to the roll transition at all.
 */
const EXTRA_MOVEMENT_STATUS_ID = "status.next-roll-extra-movement";

/**
 * The closed vocabulary of `turn.spend-token` uses.
 *
 * One entry, and deliberately so: every other conversion anyone might want
 * (tokens into money, tokens into reputation, tokens into a card draw) needs an
 * exchange rate, and there is nowhere in `ModeRules` to put one. Inventing a rate
 * here would be exactly the hardcoded constant the spec forbids. `extra-movement`
 * needs no rate — one move token moves you one space — and its bound and its off
 * switch both already exist as `agency.maxPipAdjust` and `agency.diceAdjustEnabled`.
 */
export const TOKEN_SPEND_USES = ["extra-movement"] as const;

export type TokenSpendUse = (typeof TOKEN_SPEND_USES)[number];

type CardDefinitionContent = { readonly decks: readonly DeckConfig[] };

/** The authored card behind a card instance. */
export function findCardDefinition(
  decks: readonly DeckConfig[],
  deckId: string,
  definitionId: string,
): DeckCard | null {
  const deck = decks.find((candidate) => candidate.id === deckId);

  return deck?.cards.find((candidate) => candidate.id === definitionId) ?? null;
}

function heldByAnotherPlayer(
  state: GameState,
  actorId: PlayerId,
  cardId: CardInstanceId,
): boolean {
  const card: CardState | undefined = state.cards[cardId];
  if (card !== undefined && card.ownerId !== null && card.ownerId !== actorId) return true;

  // `playerOrder` rather than object keys: key order is not stable across the
  // repository's JSON round trip, and this decides which rejection a player sees.
  return state.playerOrder.some(
    (playerId) => playerId !== actorId && state.players[playerId]?.hand.includes(cardId) === true,
  );
}

/**
 * Blocking engine work that has to finish before a player may act. Mirrors the
 * guard in `apply-command.ts` so these transitions are correct even when called
 * directly (tests, replays, a future batch path) rather than only through it.
 */
function hasBlockingWork(state: GameState, actorId: PlayerId): boolean {
  return (
    state.resolutionStack.length > 0 ||
    state.pendingEffects.length > 0 ||
    state.reactionWindows.length > 0 ||
    state.prompts.some((prompt) => prompt.audience.includes(actorId))
  );
}

/**
 * An eliminated player is out, whatever the turn pointer says. Checked here
 * rather than trusted to the turn walk: `next-turn.ts` skips on `skipTurns`, not
 * on elimination, so a mode with `conflict.elimination` on could otherwise leave
 * a removed player still able to spend and play.
 */
function isEliminated(state: GameState, actorId: PlayerId): boolean {
  return state.eliminatedPlayerIds.includes(actorId);
}

/**
 * Plays a stored card out of the actor's own hand.
 *
 * Authorisation is settled before anything is mutated, in this order: the game is
 * running, it is the actor's turn, the mode has hands at all, no engine work is
 * pending, the card is one the actor is really holding, and the card's timing
 * allows it to be played now. Only then are the effects applied.
 *
 * Playing a card does **not** end the turn — it is a free action taken before the
 * roll, which is the whole point of a hand. `agency.freeActionsPerTurn` is not
 * enforced here because nothing in `TurnState` counts actions yet; see the gaps in
 * this task's report.
 */
export function playCard(
  state: GameState,
  command: PlayCardCommand,
  context: TransitionContext,
): TransitionResult {
  if (state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Cards can only be played in an active game",
    });
  }
  if (state.turn.activePlayerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "Only the active player can play a card",
    });
  }
  const player = state.players[command.actorId];
  if (player === undefined) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_FOUND",
      message: "Command actor is not a player in this game",
    });
  }
  if (isEliminated(state, command.actorId)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An eliminated player cannot play cards",
    });
  }
  if (!state.rules.agency.handEnabled) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode has no hand to play cards from",
    });
  }
  if (state.turn.phase !== "pre-roll") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "Cards are played before the roll",
    });
  }
  if (hasBlockingWork(state, command.actorId)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Pending engine work blocks playing a card",
    });
  }
  if (command.payload.targetPlayerIds.length > 0) {
    // Effects have no `target` yet (spec §10.1), so a card cannot reach another
    // player. Accepting the targets and ignoring them would report an attack that
    // never happened; refusing is the honest answer until targeting exists.
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Targeted card play is not supported yet",
    });
  }

  const card = findHeldCard(state, command.actorId, command.payload.cardId);
  if (card === null) {
    return heldByAnotherPlayer(state, command.actorId, command.payload.cardId)
      ? rejectCommand(state, command, {
          code: "ACTOR_NOT_AUTHORIZED",
          message: "That card is in another player's hand",
        })
      : rejectCommand(state, command, {
          code: "CARD_NOT_AVAILABLE",
          message: "The actor is not holding that card",
        });
  }

  const definition = findCardDefinition(context.content.decks, card.deckId, card.definitionId);
  if (definition === null) {
    return rejectCommand(state, command, {
      code: "CONTENT_MISMATCH",
      message: "The played card has no authored definition in this content pack",
    });
  }
  if (cardTiming(definition) === "reaction") {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "A reaction card can only be played into an open reaction window",
    });
  }

  // Seeded from server-owned canonical state, under this mechanic's own domain
  // separator, so a card's `rollCheck` cannot be ground for a favourable outcome
  // by choosing a command id and cannot correlate with the turn's tile roll.
  const random = createCardRandom(state, "card-play");
  const applied = applyEffectDescriptors(player, definition.effects, random, context.content.decks);
  const piles = discardCard({
    decks: state.decks,
    cards: state.cards,
    cardId: card.id,
  });
  const updatedPlayer: PlayerState = {
    ...applied.player,
    hand: applied.player.hand.filter((candidate) => candidate !== card.id),
  };

  const allEvents: GameEvent[] = [];
  const eventMetadata = () =>
    createEventMetadata(
      state,
      command,
      context.logicalTimestamp,
      state.eventSequence + allEvents.length + 1,
    );

  const cardPlayed: CardPlayedEvent = {
    ...eventMetadata(),
    type: "CardPlayed",
    payload: { playerId: player.id, cardId: card.id, targets: [] },
  };
  allEvents.push(cardPlayed);

  for (const entry of applied.trace) {
    if (entry.type === "card-drawn") {
      const cardDrawn: CardDrawnEvent = {
        ...eventMetadata(),
        type: "CardDrawn",
        payload: {
          playerId: player.id,
          cardId: createStableId("CardDefinitionId", entry.card.id),
          deckId: createStableId("DeckId", entry.card.deckId),
          nameKey: entry.card.nameKey,
        },
      };
      allEvents.push(cardDrawn);
      continue;
    }
    if (entry.type !== "resource-changed") continue;

    const resource = updatedPlayer.resources[entry.change.resource];
    if (resource === undefined) continue;
    const resourceChanged: ResourceChangedEvent = {
      ...eventMetadata(),
      type: "ResourceChanged",
      payload: {
        playerId: player.id,
        resourceId: resource.id,
        previousValue: entry.change.previousValue,
        newValue: entry.change.newValue,
        reason: "card-played",
      },
    };
    allEvents.push(resourceChanged);
  }

  const lastEvent = allEvents[allEvents.length - 1];
  if (lastEvent === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "Playing a card did not emit an event",
    });
  }

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: lastEvent.sequence,
        players: { ...state.players, [player.id]: updatedPlayer },
        decks: piles.decks,
        cards: piles.cards,
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: allEvents,
    },
  };
}

function findOwnToken(player: PlayerState, tokenId: TokenId): TokenState | null {
  return Object.values(player.tokens).find((token) => token.id === tokenId) ?? null;
}

function tokenBelongsToAnotherPlayer(
  state: GameState,
  actorId: PlayerId,
  tokenId: TokenId,
): boolean {
  return state.playerOrder.some((playerId) => {
    if (playerId === actorId) return false;
    const other = state.players[playerId];

    return other !== undefined && findOwnToken(other, tokenId) !== null;
  });
}

function pendingExtraMovement(player: PlayerState): number {
  const status = findActiveStatus(player, EXTRA_MOVEMENT_STATUS_ID);
  const spaces = status?.data["spaces"];

  return typeof spaces === "number" && Number.isFinite(spaces) && spaces > 0
    ? Math.floor(spaces)
    : 0;
}

/**
 * Spends the actor's own tokens.
 *
 * The authorisation surface here is small and sharp: the token is looked up in
 * the *actor's own* token map by id, so naming another player's token id can
 * never reach their pool — it is rejected as unauthorised rather than silently
 * spending the actor's equivalent token.
 *
 * The one supported use converts move tokens into extra movement on the actor's
 * next roll, gated on `agency.diceAdjustEnabled` and bounded by
 * `agency.maxPipAdjust` — including movement already banked this turn, so
 * repeated small spends cannot walk past the cap.
 */
export function spendToken(
  state: GameState,
  command: SpendTokenCommand,
  context: TransitionContext,
): TransitionResult {
  if (state.status !== "active") {
    return rejectCommand(state, command, {
      code: "GAME_NOT_ACTIVE",
      message: "Tokens can only be spent in an active game",
    });
  }
  if (state.turn.activePlayerId !== command.actorId) {
    return rejectCommand(state, command, {
      code: "NOT_ACTOR_TURN",
      message: "Only the active player can spend a token",
    });
  }
  const player = state.players[command.actorId];
  if (player === undefined) {
    return rejectCommand(state, command, {
      code: "ACTOR_NOT_FOUND",
      message: "Command actor is not a player in this game",
    });
  }
  if (isEliminated(state, command.actorId)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "An eliminated player cannot spend tokens",
    });
  }
  if (state.turn.phase !== "pre-roll") {
    return rejectCommand(state, command, {
      code: "INVALID_PHASE",
      message: "Tokens are spent before the roll",
    });
  }
  if (hasBlockingWork(state, command.actorId)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Pending engine work blocks spending a token",
    });
  }
  if (!TOKEN_SPEND_USES.includes(command.payload.use as TokenSpendUse)) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Unsupported token use",
    });
  }
  if (!state.rules.agency.diceAdjustEnabled) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "This mode does not allow adjusting the roll",
    });
  }

  const quantity = command.payload.quantity;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return rejectCommand(state, command, {
      code: "INVALID_COMMAND",
      message: "Token quantity must be a positive whole number",
    });
  }

  const token = findOwnToken(player, command.payload.tokenId);
  if (token === null) {
    return tokenBelongsToAnotherPlayer(state, command.actorId, command.payload.tokenId)
      ? rejectCommand(state, command, {
          code: "ACTOR_NOT_AUTHORIZED",
          message: "That token belongs to another player",
        })
      : rejectCommand(state, command, {
          code: "ILLEGAL_ACTION",
          message: "The actor holds no such token",
        });
  }
  if (token.kind !== "token.move") {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "Extra movement is bought with move tokens",
    });
  }
  if (token.count < quantity) {
    return rejectCommand(state, command, {
      code: "INSUFFICIENT_RESOURCE",
      message: "The actor does not hold that many tokens",
    });
  }

  const banked = pendingExtraMovement(player);
  const spaces = banked + quantity;
  if (spaces > state.rules.agency.maxPipAdjust) {
    return rejectCommand(state, command, {
      code: "ILLEGAL_ACTION",
      message: "That would shift the roll further than this mode allows",
      details: {
        requestedSpaces: spaces,
        maxPipAdjust: state.rules.agency.maxPipAdjust,
      },
    });
  }

  const tokenKey = Object.keys(player.tokens).find(
    (key) => player.tokens[key]?.id === token.id,
  );
  if (tokenKey === undefined) {
    return rejectCommand(state, command, {
      code: "INVARIANT_VIOLATION",
      message: "The spent token is missing from canonical token state",
    });
  }

  const spent: PlayerState = {
    ...player,
    tokens: {
      ...player.tokens,
      [tokenKey]: { ...token, count: token.count - quantity },
    },
  };
  const updatedPlayer = applyStatusEffect(spent, {
    statusId: EXTRA_MOVEMENT_STATUS_ID,
    duration: { kind: "uses", count: 1 },
    parameters: { spaces },
  });

  const statusApplied: StatusAppliedEvent = {
    ...createEventMetadata(state, command, context.logicalTimestamp, state.eventSequence + 1),
    type: "StatusApplied",
    payload: {
      playerId: player.id,
      statusId: createStableId("StatusId", EXTRA_MOVEMENT_STATUS_ID),
      stacks: 1,
      data: { spaces, spentTokens: quantity, use: command.payload.use },
    },
  };

  return {
    ok: true,
    value: {
      state: {
        ...state,
        revision: state.revision + 1,
        eventSequence: statusApplied.sequence,
        players: { ...state.players, [player.id]: updatedPlayer },
        lastCommandId: command.commandId,
        stateHash: null,
      },
      events: [statusApplied],
    },
  };
}

/**
 * The cards this player could legally play right now.
 *
 * Shaped for `legal-actions.ts`: it answers the same question the transition
 * does, so an advertised action is never one `playCard` would refuse. `content`
 * is optional because the legal-action enumerator has no content parameter today
 * — without it the timing filter is skipped, which can only ever over-offer a
 * reaction card, never a card the player does not hold.
 */
export function playableCardIds(
  state: GameState,
  actorId: PlayerId,
  content?: CardDefinitionContent,
): readonly CardInstanceId[] {
  const player = state.players[actorId];
  if (
    player === undefined ||
    state.status !== "active" ||
    !state.rules.agency.handEnabled ||
    state.turn.activePlayerId !== actorId ||
    state.turn.phase !== "pre-roll" ||
    isEliminated(state, actorId) ||
    hasBlockingWork(state, actorId)
  ) {
    return [];
  }

  return player.hand.filter((cardId) => {
    const card = findHeldCard(state, actorId, cardId);
    if (card === null) return false;
    if (content === undefined) return true;

    const definition = findCardDefinition(content.decks, card.deckId, card.definitionId);

    return definition !== null && cardTiming(definition) !== "reaction";
  });
}

export type SpendableToken = {
  readonly tokenId: TokenId;
  readonly use: TokenSpendUse;
  /** The largest quantity `spendToken` would accept for this token right now. */
  readonly maxQuantity: number;
};

/** The token spends this player could legally make right now. */
export function spendableTokens(
  state: GameState,
  actorId: PlayerId,
): readonly SpendableToken[] {
  const player = state.players[actorId];
  if (
    player === undefined ||
    state.status !== "active" ||
    !state.rules.agency.diceAdjustEnabled ||
    state.turn.activePlayerId !== actorId ||
    state.turn.phase !== "pre-roll" ||
    isEliminated(state, actorId) ||
    hasBlockingWork(state, actorId)
  ) {
    return [];
  }

  const headroom = state.rules.agency.maxPipAdjust - pendingExtraMovement(player);
  if (headroom <= 0) return [];

  // Iterated in the key order of the player's own token record, which the setup
  // path writes in a fixed order and the JSON boundary preserves.
  return Object.keys(player.tokens)
    .map((key) => player.tokens[key])
    .filter((token): token is TokenState => token !== undefined && token.kind === "token.move")
    .filter((token) => token.count > 0)
    .map((token) => ({
      tokenId: token.id,
      use: "extra-movement" as const,
      maxQuantity: Math.min(token.count, headroom),
    }));
}
