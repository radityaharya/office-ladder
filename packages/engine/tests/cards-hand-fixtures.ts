import { deadlineDashContent } from "@office-ladder/content";

import type {
  CardInstanceId,
  CardState,
  CommandId,
  DeckState,
  GameState,
  PlayCardCommand,
  PlayerState,
  ResourceState,
  SpendTokenCommand,
  TokenId,
  TokenState,
} from "../src";
import { fixtureIds } from "./fixtures";
import { rollState } from "./turn-loop-fixtures";

const branded = <Id extends string>(value: string) => value as Id;

/** Two real authored `deck.work` cards, so effects resolve against the shipped pack. */
export const OVERTIME_BONUS = "card.work.overtime-bonus";
export const PRINTER_JAM = "card.work.printer-jam";
export const EXPENSE_REPORT_REJECTED = "card.work.expense-report-rejected";

export const WORK_DECK_ID = "deck.work";

export const cardIds = {
  ownerOvertime: branded<CardInstanceId>("card-owner-overtime"),
  ownerPrinterJam: branded<CardInstanceId>("card-owner-printer-jam"),
  ownerExpense: branded<CardInstanceId>("card-owner-expense"),
  opponentOvertime: branded<CardInstanceId>("card-opponent-overtime"),
} as const;

export const tokenIds = {
  ownerMove: branded<TokenId>("token-owner-move"),
  ownerMomentum: branded<TokenId>("token-owner-momentum"),
  opponentMove: branded<TokenId>("token-opponent-move"),
} as const;

export function handCard(
  id: CardInstanceId,
  definitionId: string,
  zone: CardState["zone"],
  ownerId: CardState["ownerId"],
): CardState {
  return {
    id,
    definitionId: branded(definitionId),
    deckId: branded(WORK_DECK_ID),
    zone,
    ownerId,
    faceUp: false,
    data: {},
  };
}

export function workDeck(overrides: Partial<DeckState> = {}): DeckState {
  return {
    id: branded(WORK_DECK_ID),
    kind: "deck.work",
    drawPile: [],
    discardPile: [],
    visibleCards: [],
    reshufflesWhenEmpty: true,
    managementShuffleEligible: true,
    shuffleCount: 1,
    ...overrides,
  };
}

function resource(id: string, kind: ResourceState["kind"], value: number, maximum: number | null): ResourceState {
  return { id: branded(id), kind, value, minimum: 0, maximum };
}

function token(id: TokenId, kind: TokenState["kind"], count: number): TokenState {
  return { id, kind, count, maximum: 5 };
}

export type HandStateOptions = {
  readonly ownerHand?: readonly CardInstanceId[];
  readonly ownerMoney?: number;
  readonly ownerMoveTokens?: number;
  readonly cards?: Readonly<Record<string, CardState>>;
  readonly decks?: Readonly<Record<string, DeckState>>;
};

/**
 * A pre-roll state whose cards and decks are real: the owner holds authored
 * `deck.work` cards, an opponent holds one of their own, and the deck exists in
 * canonical state so a played card has somewhere to be discarded to.
 *
 * Built on `rollState`, so it carries the Quick preset's ruleset — hands on,
 * dice-adjust on, `maxPipAdjust` 2, hidden hands off. Tests for the other side of
 * any of those gates use `withRules`.
 */
export function handState(options: HandStateOptions = {}): GameState {
  const state = rollState(0);
  const owner = state.players[fixtureIds.owner];
  const opponent = state.players[fixtureIds.hiddenOpponent];
  const bystander = state.players[fixtureIds.revealedOpponent];
  if (owner === undefined || opponent === undefined || bystander === undefined) {
    throw new Error("fixture is missing a player");
  }

  const ownerPlayer: PlayerState = {
    ...owner,
    hand: options.ownerHand ?? [cardIds.ownerOvertime],
    resources: {
      money: resource("resource-owner-money", "resource.money", options.ownerMoney ?? 500, null),
      reputation: resource("resource-owner-reputation", "resource.reputation", 2, null),
      energy: resource("resource-owner-energy", "resource.energy", 4, 5),
      "work-counter": resource("resource-owner-work-counter", "resource.work-counter", 0, null),
    },
    tokens: {
      move: token(tokenIds.ownerMove, "token.move", options.ownerMoveTokens ?? 2),
      momentum: token(tokenIds.ownerMomentum, "token.momentum", 1),
    },
    statuses: [],
  };
  const opponentPlayer: PlayerState = {
    ...opponent,
    hand: [cardIds.opponentOvertime],
    tokens: { move: token(tokenIds.opponentMove, "token.move", 2) },
    skipTurns: 0,
    inAudit: false,
  };

  return {
    ...state,
    players: {
      ...state.players,
      [fixtureIds.owner]: ownerPlayer,
      [fixtureIds.hiddenOpponent]: opponentPlayer,
      // The base fixture's third player holds a card from a deck this state does
      // not carry, and the serializer refuses a hand that references a missing
      // card. They are a bystander in every test here.
      [fixtureIds.revealedOpponent]: { ...bystander, hand: [] },
    },
    decks: options.decks ?? { [WORK_DECK_ID]: workDeck() },
    cards:
      options.cards ?? {
        [cardIds.ownerOvertime]: handCard(
          cardIds.ownerOvertime,
          OVERTIME_BONUS,
          "hand",
          fixtureIds.owner,
        ),
        [cardIds.opponentOvertime]: handCard(
          cardIds.opponentOvertime,
          OVERTIME_BONUS,
          "hand",
          fixtureIds.hiddenOpponent,
        ),
      },
  };
}

export function playCardCommand(
  state: GameState,
  overrides: Omit<Partial<PlayCardCommand>, "payload"> & {
    readonly payload?: Partial<PlayCardCommand["payload"]>;
  } = {},
): PlayCardCommand {
  const { payload, ...rest } = overrides;

  return {
    commandId: branded<CommandId>("command-play-card"),
    gameId: state.gameId,
    actorId: fixtureIds.owner,
    expectedRevision: state.revision,
    type: "turn.play-card",
    payload: {
      cardId: cardIds.ownerOvertime,
      targetPlayerIds: [],
      choice: null,
      ...payload,
    },
    ...rest,
  };
}

export function spendTokenCommand(
  state: GameState,
  overrides: Omit<Partial<SpendTokenCommand>, "payload"> & {
    readonly payload?: Partial<SpendTokenCommand["payload"]>;
  } = {},
): SpendTokenCommand {
  const { payload, ...rest } = overrides;

  return {
    commandId: branded<CommandId>("command-spend-token"),
    gameId: state.gameId,
    actorId: fixtureIds.owner,
    expectedRevision: state.revision,
    type: "turn.spend-token",
    payload: {
      tokenId: tokenIds.ownerMove,
      quantity: 1,
      use: "extra-movement",
      ...payload,
    },
    ...rest,
  };
}

/** The authored effects of a card definition, for assertions about magnitudes. */
export function authoredCard(definitionId: string) {
  const deck = deadlineDashContent.decks.find((candidate) => candidate.id === WORK_DECK_ID);
  const card = deck?.cards.find((candidate) => candidate.id === definitionId);
  if (card === undefined) throw new Error(`no authored card ${definitionId}`);

  return card;
}
