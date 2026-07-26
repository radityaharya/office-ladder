import { describe, expect, it } from "vitest";

import type {
  CardInstanceId,
  CardState,
  CommandId,
  DecisionPointId,
  FrameId,
  GameState,
  PayAuditFineCommand,
  PromptOptionId,
  PromptState,
  ShuffleManagementDeckCommand,
} from "../src";
import { auditFineAmount, payAuditFine, shuffleManagementDeck } from "../src/execution/agency";
import { freeActionsRemaining } from "../src/execution/free-action";
import {
  accepted,
  agencyContext,
  agencyIds,
  agencyState,
  branded,
  commandBase,
  expectRoundTrips,
  rejected,
  resourceValue,
} from "./agency-fixtures";
import { fixtureIds } from "./fixtures";

/* ------------------------------------------------------------------ *
 * audit.pay-fine
 * ------------------------------------------------------------------ */

function auditPrompt(): PromptState {
  return {
    id: branded<DecisionPointId>("prompt-audit-release"),
    frameId: branded<FrameId>("frame-audit-release"),
    kind: "audit-release",
    audience: [agencyIds.owner],
    legalResponses: [
      { id: branded<PromptOptionId>("pay-fine"), value: null },
      { id: branded<PromptOptionId>("attempt-roll"), value: null },
    ],
    deadlineAt: null,
    defaultResponse: { optionId: branded<PromptOptionId>("attempt-roll"), value: null },
    visibility: "public",
    responses: {},
  };
}

function confinedState(money = 1000): GameState {
  const state = agencyState({ owner: { money, inAudit: true } });

  return { ...state, prompts: [auditPrompt()] };
}

function payFine(
  state: GameState,
  overrides: Partial<PayAuditFineCommand> = {},
): PayAuditFineCommand {
  return {
    ...commandBase(state, "audit-pay-fine"),
    type: "audit.pay-fine",
    payload: {},
    ...overrides,
  };
}

describe("audit.pay-fine", () => {
  it("Given a confined player who can pay, When they pay the fine, Then they are released, the prompt closes and the turn moves on", () => {
    const state = confinedState(1000);
    // The amount is authored on the board's audit tile, not a constant in the
    // engine.
    expect(auditFineAmount(agencyContext())).toBe(500);

    const { state: next, events } = accepted(
      payAuditFine(state, payFine(state), agencyContext()),
    );

    expect(resourceValue(next, agencyIds.owner, "money")).toBe(500);
    expect(next.players[agencyIds.owner]?.inAudit).toBe(false);
    expect(next.prompts).toHaveLength(0);
    // Paying it off is what the turn was for; releasing *and* rolling would make
    // this command strictly better than the prompt branch it mirrors.
    expect(next.turn.activePlayerId).toBe(agencyIds.hiddenOpponent);
    expect(events.at(-1)?.type).toBe("TurnStarted");
    expectRoundTrips(next);
  });

  it("Given a confined player who cannot pay, When they try, Then it is refused and they stay confined", () => {
    const state = confinedState(100);

    rejected(payAuditFine(state, payFine(state), agencyContext()), "INSUFFICIENT_RESOURCE");
    expect(state.players[agencyIds.owner]?.inAudit).toBe(true);
  });

  it("Given a player who is not confined, When they pay a fine, Then there is nothing to pay off", () => {
    const state = agencyState({ owner: { money: 1000, inAudit: false } });

    rejected(payAuditFine(state, payFine(state), agencyContext()), "ILLEGAL_ACTION");
  });

  it("Given a player who is not the active one, When they pay a fine, Then it is refused as not their turn", () => {
    const state = confinedState();

    rejected(
      payAuditFine(state, payFine(state, { actorId: agencyIds.hiddenOpponent }), agencyContext()),
      "NOT_ACTOR_TURN",
    );
  });

  it("Given confinement with no prompt still open, When the fine is paid, Then the release still works", () => {
    const state = { ...confinedState(), prompts: [] };

    const { state: next } = accepted(payAuditFine(state, payFine(state), agencyContext()));

    expect(next.players[agencyIds.owner]?.inAudit).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * management.shuffle-deck
 * ------------------------------------------------------------------ */

const SHUFFLE_CARD_COUNT = 8;

/** A deck with enough cards for a shuffle to be observable. */
function shuffleState(overrides: Parameters<typeof agencyState>[0] = {}): GameState {
  const state = agencyState({
    rules: { hidden: { rolesEnabled: true } },
    owner: { role: "role.management" },
    ...overrides,
  });
  const deck = state.decks[fixtureIds.deck];
  if (deck === undefined) throw new Error("fixture missing deck");

  const drawPile = Array.from({ length: SHUFFLE_CARD_COUNT }, (_, index) =>
    branded<CardInstanceId>(`card-shuffle-${index}`),
  );
  const cards: Record<string, CardState> = { ...state.cards };
  for (const cardId of deck.drawPile) delete cards[cardId];
  for (const cardId of drawPile) {
    cards[cardId] = {
      id: cardId,
      definitionId: branded(`definition-${cardId}`),
      deckId: fixtureIds.deck,
      zone: "draw-pile",
      ownerId: null,
      faceUp: false,
      data: {},
    };
  }

  return {
    ...state,
    decks: { ...state.decks, [fixtureIds.deck]: { ...deck, drawPile } },
    cards,
  };
}

function shuffleCommand(
  state: GameState,
  overrides: Partial<ShuffleManagementDeckCommand> = {},
): ShuffleManagementDeckCommand {
  return {
    ...commandBase(state, "shuffle-deck"),
    type: "management.shuffle-deck",
    payload: { deckId: fixtureIds.deck },
    ...overrides,
  };
}

describe("management.shuffle-deck", () => {
  it("Given a Management player, When they shuffle an eligible deck, Then the pile is reordered, counted and paid for with a turn action", () => {
    const state = shuffleState();
    const before = state.decks[fixtureIds.deck]?.drawPile ?? [];

    const { state: next } = accepted(
      shuffleManagementDeck(state, shuffleCommand(state), agencyContext()),
    );

    const after = next.decks[fixtureIds.deck]?.drawPile ?? [];
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
    expect(next.decks[fixtureIds.deck]?.shuffleCount).toBe(
      (state.decks[fixtureIds.deck]?.shuffleCount ?? 0) + 1,
    );
    const owner = next.players[agencyIds.owner];
    if (owner === undefined) throw new Error("missing owner");
    expect(freeActionsRemaining(next, owner)).toBe(0);
    expect(next.turn).toEqual(state.turn);
    expectRoundTrips(next);
  });

  it("Given the same state and command, When the shuffle is replayed, Then the resulting order is identical", () => {
    const state = shuffleState();

    const first = accepted(shuffleManagementDeck(state, shuffleCommand(state), agencyContext()));
    const second = accepted(shuffleManagementDeck(state, shuffleCommand(state), agencyContext()));

    expect(second.state.decks[fixtureIds.deck]?.drawPile).toEqual(
      first.state.decks[fixtureIds.deck]?.drawPile,
    );
  });

  it("Given a command id chosen by the client, When it changes, Then the shuffle does not — the seed is server-owned state", () => {
    const state = shuffleState();

    const first = accepted(shuffleManagementDeck(state, shuffleCommand(state), agencyContext()));
    const second = accepted(
      shuffleManagementDeck(
        state,
        shuffleCommand(state, { commandId: branded<CommandId>("shuffle-deck-other-id") }),
        agencyContext(),
      ),
    );

    expect(second.state.decks[fixtureIds.deck]?.drawPile).toEqual(
      first.state.decks[fixtureIds.deck]?.drawPile,
    );
  });

  it("Given a player who is not Management, When they shuffle, Then the power is refused", () => {
    const state = shuffleState({ owner: { role: "role.worker" } });

    rejected(
      shuffleManagementDeck(state, shuffleCommand(state), agencyContext()),
      "ACTOR_NOT_AUTHORIZED",
    );
  });

  it("Given a mode with no Management role, When a shuffle is attempted, Then the whole power is off", () => {
    const state = shuffleState({ rules: { hidden: { rolesEnabled: false } } });

    rejected(
      shuffleManagementDeck(state, shuffleCommand(state), agencyContext()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a mode that grants no turn actions, When a shuffle is attempted, Then it has no budget to spend", () => {
    const state = shuffleState({ rules: { agency: { freeActionsPerTurn: 0 } } });

    rejected(
      shuffleManagementDeck(state, shuffleCommand(state), agencyContext()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a deck that does not exist, When it is shuffled, Then the command is refused", () => {
    const state = shuffleState();

    rejected(
      shuffleManagementDeck(
        state,
        shuffleCommand(state, { payload: { deckId: branded("deck-invented") } }),
        agencyContext(),
      ),
      "CARD_NOT_AVAILABLE",
    );
  });

  it("Given a deck Management may not touch, When it is shuffled, Then the command is refused", () => {
    const base = shuffleState();
    const deck = base.decks[fixtureIds.deck];
    if (deck === undefined) throw new Error("fixture missing deck");
    const state: GameState = {
      ...base,
      decks: { ...base.decks, [fixtureIds.deck]: { ...deck, managementShuffleEligible: false } },
    };

    rejected(
      shuffleManagementDeck(state, shuffleCommand(state), agencyContext()),
      "ILLEGAL_ACTION",
    );
  });

  it("Given a player who is not the active one, When they shuffle, Then it is refused as not their turn", () => {
    const state = shuffleState();

    rejected(
      shuffleManagementDeck(
        state,
        shuffleCommand(state, { actorId: agencyIds.hiddenOpponent }),
        agencyContext(),
      ),
      "NOT_ACTOR_TURN",
    );
  });
});
