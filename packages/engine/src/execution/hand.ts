import type { ModeRules } from "@office-ladder/content";

import type {
  CardInstanceId,
  CardState,
  DeckState,
  DecisionPointId,
  FrameId,
  GameId,
  GameState,
  PlayerId,
  PlayerState,
  PromptState,
} from "../model";
import { createStableId } from "../model";
import { type CardTiming, discardCard } from "./deck-depletion";

/**
 * The prompt raised when a draw puts a player over their hand limit.
 *
 * Spec-mandated shape: going over the limit is a *decision*, never a silent
 * drop. The card is really in the hand while the prompt is open, so the player
 * chooses which of their cards to lose rather than having the newest one
 * discarded for them.
 */
export const HAND_DISCARD_PROMPT_KIND = "hand-discard";

/**
 * The ruleset's hand limit.
 *
 * Read from `GameState.rules` — the ruleset snapshotted at `game.start` and
 * frozen for the match (spec §5.9). It used to be looked up live from
 * `ModeConfig.handLimit` in the content pack, which meant editing a preset
 * changed how many cards a player could hold *in a match already running*, and
 * changed what a replay of a finished match decided. `ModeRules.agency.handLimit`
 * mirrors the same authored number (content validation proves the two agree), so
 * the limit is identical and where it comes from is not.
 *
 * A limit that is not a usable positive integer resolves to 0 — fail closed,
 * because a ruleset that does not say what the limit is should not be granted an
 * unbounded hand. That is also what a pre-v2 snapshot with no `handLimit` field
 * gets.
 */
export function resolveHandLimit(state: GameState): number {
  const limit = (state.rules.agency as { readonly handLimit?: number }).handLimit;

  return typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0 ? limit : 0;
}

/** How many cards over the limit this player is holding; 0 when within it. */
export function handOverLimitBy(player: PlayerState, handLimit: number): number {
  return Math.max(0, player.hand.length - Math.max(0, handLimit));
}

/**
 * The card this player is actually holding, or null.
 *
 * The authorisation primitive for every hand command: a card counts as held only
 * when the player's own `hand` lists it, the card map agrees it is in the `"hand"`
 * zone, **and** its `ownerId` is this player. All three have to agree, so naming
 * another player's card id — the obvious way to try to play someone else's hand —
 * resolves to null here rather than to a playable card.
 */
export function findHeldCard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): CardState | null {
  const player = state.players[playerId];
  if (player === undefined || !player.hand.includes(cardId)) return null;

  const card = state.cards[cardId];
  if (card === undefined || card.zone !== "hand" || card.ownerId !== playerId) return null;

  return card;
}

/** What a mode does with a freshly drawn card of this timing. */
export type DrawnCardDisposition = "resolve" | "store" | "discard";

/**
 * Where a drawn card goes.
 *
 * `"discard"` only happens when a card of a disabled timing reaches a draw at
 * all, which deck construction is supposed to prevent (see `timingAllowed`). It
 * is the fail-closed branch: a stored card in a mode with no hand is binned, never
 * silently resolved as though it had been immediate — resolving it would apply an
 * effect the mode switched off.
 */
export function drawnCardDisposition(
  timing: CardTiming,
  rules: ModeRules,
): DrawnCardDisposition {
  if (timing === "immediate") return "resolve";

  return rules.agency.handEnabled ? "store" : "discard";
}

export type HandDiscardPromptInput = {
  readonly gameId: GameId;
  /** The sequence the accompanying `PromptOpened` event will carry. */
  readonly sequence: number;
  readonly playerId: PlayerId;
  readonly hand: readonly CardInstanceId[];
  readonly rules: ModeRules;
};

/**
 * The "which card do you drop?" prompt.
 *
 * Ids come from `gameId` plus the event sequence, never from the client's command
 * id: a client that chose a prompt id could aim it at another player's open
 * prompt. The default response is the card just drawn (the last one in hand), so
 * a timeout or a naive bot restores the status quo instead of throwing away
 * something the player had chosen to keep earlier.
 *
 * Each option's id **is** the card instance id it discards, so a `prompt.respond`
 * handler maps `optionId` straight back to a `CardInstanceId` for
 * `discardFromHand` — which re-checks that the responder is really holding it.
 */
export function buildHandDiscardPrompt(input: HandDiscardPromptInput): PromptState {
  const decisionPointId: DecisionPointId = createStableId(
    "DecisionPointId",
    `${input.gameId}:prompt:${input.sequence}:${HAND_DISCARD_PROMPT_KIND}`,
  );
  const frameId: FrameId = createStableId("FrameId", `${input.gameId}:frame:${input.sequence}`);
  const options = input.hand.map((cardId) => ({
    id: createStableId("PromptOptionId", cardId),
    value: null,
  }));
  const fallback = createStableId("PromptOptionId", HAND_DISCARD_PROMPT_KIND);

  return {
    id: decisionPointId,
    frameId,
    kind: HAND_DISCARD_PROMPT_KIND,
    audience: [input.playerId],
    legalResponses: options,
    deadlineAt: null,
    defaultResponse: {
      optionId: options[options.length - 1]?.id ?? fallback,
      value: null,
    },
    // The options name this player's own cards, so an open hand may show them and
    // a hidden one must not.
    visibility: input.rules.hidden.hiddenHands ? "private" : "public",
    responses: {},
  };
}

/** This player's open hand-discard prompt, if one is waiting on them. */
export function findHandDiscardPrompt(
  state: GameState,
  playerId: PlayerId,
): PromptState | null {
  return (
    state.prompts.find(
      (prompt) =>
        prompt.kind === HAND_DISCARD_PROMPT_KIND && prompt.audience.includes(playerId),
    ) ?? null
  );
}

export type StoreCardInput = {
  readonly player: PlayerState;
  readonly cards: Readonly<Record<string, CardState>>;
  readonly cardId: CardInstanceId;
  readonly rules: ModeRules;
  readonly handLimit: number;
  readonly gameId: GameId;
  /** The sequence a `PromptOpened` event for the discard decision would carry. */
  readonly promptSequence: number;
};

export type StoreCardOutcome =
  /** `rules.agency.handEnabled` is false: this mode has no hand to store into. */
  | { readonly kind: "hand-disabled" }
  /** The card id is not in the card map — a caller bug, never a player action. */
  | { readonly kind: "unknown-card" }
  | {
      readonly kind: "stored";
      readonly player: PlayerState;
      readonly cards: Readonly<Record<string, CardState>>;
      /** How far over the limit the hand now is; 0 when it fits. */
      readonly overLimitBy: number;
      /** Non-null exactly when `overLimitBy` is positive. */
      readonly discardPrompt: PromptState | null;
    };

/**
 * Puts a drawn card into a player's hand.
 *
 * Over the limit the card still enters the hand and a discard prompt opens: draw
 * first, then choose what to lose. Dropping the card on the floor would make the
 * limit invisible — the player would never learn what they had drawn — and would
 * also quietly change the deck's contents, which the clock depends on.
 *
 * `faceUp` is mode-driven: a mode with `hidden.hiddenHands` off has open hands, so
 * a held card is face up and other players' projections may show it.
 */
export function storeCardInHand(input: StoreCardInput): StoreCardOutcome {
  if (!input.rules.agency.handEnabled) {
    return { kind: "hand-disabled" };
  }

  const card = input.cards[input.cardId];
  if (card === undefined) {
    return { kind: "unknown-card" };
  }

  const hand = input.player.hand.includes(input.cardId)
    ? input.player.hand
    : [...input.player.hand, input.cardId];
  const player: PlayerState = { ...input.player, hand };
  const cards: Readonly<Record<string, CardState>> = {
    ...input.cards,
    [input.cardId]: {
      ...card,
      zone: "hand",
      ownerId: input.player.id,
      faceUp: !input.rules.hidden.hiddenHands,
    },
  };
  const overLimitBy = handOverLimitBy(player, input.handLimit);

  return {
    kind: "stored",
    player,
    cards,
    overLimitBy,
    discardPrompt:
      overLimitBy > 0
        ? buildHandDiscardPrompt({
            gameId: input.gameId,
            sequence: input.promptSequence,
            playerId: input.player.id,
            hand,
            rules: input.rules,
          })
        : null,
  };
}

export type DiscardFromHandInput = {
  readonly player: PlayerState;
  readonly cards: Readonly<Record<string, CardState>>;
  readonly decks: Readonly<Record<string, DeckState>>;
  readonly cardId: CardInstanceId;
  readonly handLimit: number;
};

export type DiscardFromHandOutcome =
  | { readonly ok: false; readonly reason: "not-held" }
  | {
      readonly ok: true;
      readonly player: PlayerState;
      readonly cards: Readonly<Record<string, CardState>>;
      readonly decks: Readonly<Record<string, DeckState>>;
      /**
       * How far over the limit the hand still is. Positive means the discard
       * decision has to stay open — two draws over the limit take two answers.
       */
      readonly overLimitBy: number;
    };

/**
 * Removes a card from a hand and sends it to its deck's discard pile.
 *
 * Refuses any card the player is not holding, which is the same guard
 * `findHeldCard` applies: answering a discard prompt with someone else's card id
 * must not destroy their card.
 */
export function discardFromHand(input: DiscardFromHandInput): DiscardFromHandOutcome {
  const card = input.cards[input.cardId];
  if (
    !input.player.hand.includes(input.cardId) ||
    card === undefined ||
    card.zone !== "hand" ||
    card.ownerId !== input.player.id
  ) {
    return { ok: false, reason: "not-held" };
  }

  const piles = discardCard({
    decks: input.decks,
    cards: input.cards,
    cardId: input.cardId,
  });
  const player: PlayerState = {
    ...input.player,
    hand: input.player.hand.filter((candidate) => candidate !== input.cardId),
  };

  return {
    ok: true,
    player,
    cards: piles.cards,
    decks: piles.decks,
    overLimitBy: handOverLimitBy(player, input.handLimit),
  };
}
