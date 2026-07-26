import { describe, expect, it } from "vitest";

import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";

import { deserializeGameState, serializeGameState, stableStringify } from "../src";
import type { CardInstanceId, GameState, PlayerState } from "../src";
import {
  discardFromHand,
  drawnCardDisposition,
  findHandDiscardPrompt,
  findHeldCard,
  handOverLimitBy,
  HAND_DISCARD_PROMPT_KIND,
  resolveHandLimit,
  storeCardInHand,
} from "../src/execution/hand";
import { playableCardIds, playCard } from "../src/execution/play-card";
import { fixtureIds } from "./fixtures";
import { logicalTimestamp, withRules } from "./turn-loop-fixtures";
import {
  cardIds,
  EXPENSE_REPORT_REJECTED,
  handCard,
  handState,
  OVERTIME_BONUS,
  playCardCommand,
  workDeck,
  WORK_DECK_ID,
} from "./cards-hand-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

function transitionContext(timestamp = logicalTimestamp) {
  return { logicalTimestamp: timestamp, content: deadlineDashContent };
}

function ownerOf(state: GameState): PlayerState {
  const player = state.players[fixtureIds.owner];
  if (player === undefined) throw new Error("fixture is missing the owner");

  return player;
}

function accept(result: ReturnType<typeof playCard>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);

  return result.value;
}

function rejection(result: ReturnType<typeof playCard>): string {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected the command to be rejected");

  return result.error.code;
}

describe("turn.play-card", () => {
  it("Given a held card, When the active player plays it, Then its effects resolve, it is discarded, and the turn does not move", () => {
    const state = handState({ ownerMoney: 500 });

    const { state: next, events } = accept(
      playCard(state, playCardCommand(state), transitionContext()),
    );

    // card.work.overtime-bonus is +150 money.
    expect(ownerOf(next).resources.money?.value).toBe(650);
    expect(ownerOf(next).hand).toEqual([]);
    expect(next.cards[cardIds.ownerOvertime]?.zone).toBe("discard-pile");
    expect(next.cards[cardIds.ownerOvertime]?.ownerId).toBeNull();
    expect(next.decks[WORK_DECK_ID]?.discardPile).toEqual([cardIds.ownerOvertime]);
    expect(events.map((event) => event.type)).toEqual(["CardPlayed", "ResourceChanged"]);
    // A card is a free action: the actor keeps their turn and their roll.
    expect(next.turn).toEqual(state.turn);
    expect(next.revision).toBe(state.revision + 1);
    expect(next.lastCommandId).toBe("command-play-card");
  });

  it("Given another player's card, When the active player names it, Then the command is rejected as unauthorised and nothing moves", () => {
    const state = handState();

    const result = playCard(
      state,
      playCardCommand(state, { payload: { cardId: cardIds.opponentOvertime } }),
      transitionContext(),
    );

    expect(rejection(result)).toBe("ACTOR_NOT_AUTHORIZED");
    expect(state.players[fixtureIds.hiddenOpponent]?.hand).toEqual([cardIds.opponentOvertime]);
    expect(state.cards[cardIds.opponentOvertime]?.zone).toBe("hand");
  });

  it("Given a player whose turn it is not, When they play their own card, Then the command is rejected", () => {
    const state = handState();

    const result = playCard(
      state,
      playCardCommand(state, {
        actorId: fixtureIds.hiddenOpponent,
        payload: { cardId: cardIds.opponentOvertime },
      }),
      transitionContext(),
    );

    expect(rejection(result)).toBe("NOT_ACTOR_TURN");
  });

  it("Given a mode with hands switched off, When a card is played, Then the command is rejected", () => {
    const state = withRules(handState(), { agency: { handEnabled: false } });

    expect(rejection(playCard(state, playCardCommand(state), transitionContext()))).toBe(
      "ILLEGAL_ACTION",
    );
  });

  it("Given a card that is not in the actor's hand, When it is played, Then the command is rejected as unavailable", () => {
    const state = handState({ ownerHand: [] });

    expect(rejection(playCard(state, playCardCommand(state), transitionContext()))).toBe(
      "CARD_NOT_AVAILABLE",
    );
  });

  it("Given a card the actor cannot fully pay for, When it is played, Then the charge clamps at zero rather than going negative", () => {
    // card.work.expense-report-rejected pays 100 with `pay-up-to-available`.
    const state = handState({
      ownerMoney: 40,
      ownerHand: [cardIds.ownerExpense],
      cards: {
        [cardIds.ownerExpense]: handCard(
          cardIds.ownerExpense,
          EXPENSE_REPORT_REJECTED,
          "hand",
          fixtureIds.owner,
        ),
      },
    });

    const { state: next } = accept(
      playCard(
        state,
        playCardCommand(state, { payload: { cardId: cardIds.ownerExpense } }),
        transitionContext(),
      ),
    );

    expect(ownerOf(next).resources.money?.value).toBe(0);
  });

  it("Given targets on the payload, When a card is played, Then it is refused rather than silently resolving on the actor", () => {
    const state = handState();

    const result = playCard(
      state,
      playCardCommand(state, {
        payload: { targetPlayerIds: [fixtureIds.hiddenOpponent] },
      }),
      transitionContext(),
    );

    expect(rejection(result)).toBe("ILLEGAL_ACTION");
  });

  it("Given a card whose definition is not in the pack, When it is played, Then the command is rejected as a content mismatch", () => {
    const state = handState({
      cards: {
        [cardIds.ownerOvertime]: handCard(
          cardIds.ownerOvertime,
          "card.work.does-not-exist",
          "hand",
          fixtureIds.owner,
        ),
      },
    });

    expect(rejection(playCard(state, playCardCommand(state), transitionContext()))).toBe(
      "CONTENT_MISMATCH",
    );
  });

  it("Given an open prompt for the actor, When they play a card, Then pending engine work blocks it", () => {
    const base = handState();
    const state: GameState = {
      ...base,
      prompts: [
        {
          id: brand("prompt-blocking"),
          frameId: brand("frame-blocking"),
          kind: "audit-release",
          audience: [fixtureIds.owner],
          legalResponses: [{ id: brand("pay-fine"), value: null }],
          deadlineAt: null,
          defaultResponse: { optionId: brand("pay-fine"), value: null },
          visibility: "public",
          responses: {},
        },
      ],
    };

    expect(rejection(playCard(state, playCardCommand(state), transitionContext()))).toBe(
      "ILLEGAL_ACTION",
    );
  });

  it("Given an eliminated actor, When they play a card, Then it is refused even though the turn pointer is on them", () => {
    const base = handState();
    const state: GameState = { ...base, eliminatedPlayerIds: [fixtureIds.owner] };

    expect(rejection(playCard(state, playCardCommand(state), transitionContext()))).toBe(
      "ILLEGAL_ACTION",
    );
    expect(playableCardIds(state, fixtureIds.owner, deadlineDashContent)).toEqual([]);
  });

  it("Given the same play applied twice to the same state, Then the events and next state are identical and JSON round-trips", () => {
    const state = handState();
    const command = playCardCommand(state);

    const first = accept(playCard(state, command, transitionContext()));
    const second = accept(playCard(state, command, transitionContext()));

    expect(stableStringify(second.events)).toBe(stableStringify(first.events));
    expect(stableStringify(second.state)).toBe(stableStringify(first.state));
    expect(deserializeGameState(serializeGameState(first.state))).toEqual(first.state);
  });

  it("Given a state that has been through the jsonb boundary, When the same card is played, Then the result is identical", () => {
    const state = handState();
    const restored = deserializeGameState(serializeGameState(state));

    const live = accept(playCard(state, playCardCommand(state), transitionContext()));
    const resumed = accept(playCard(restored, playCardCommand(restored), transitionContext()));

    expect(stableStringify(resumed.state)).toBe(stableStringify(live.state));
    expect(stableStringify(resumed.events)).toBe(stableStringify(live.events));
  });

  it("Given a hand, When legal actions are enumerated, Then only cards the actor really holds are offered", () => {
    const state = handState();

    expect(playableCardIds(state, fixtureIds.owner, deadlineDashContent)).toEqual([
      cardIds.ownerOvertime,
    ]);
    expect(playableCardIds(state, fixtureIds.hiddenOpponent, deadlineDashContent)).toEqual([]);
    expect(
      playableCardIds(
        withRules(state, { agency: { handEnabled: false } }),
        fixtureIds.owner,
        deadlineDashContent,
      ),
    ).toEqual([]);
  });
});

describe("hand management", () => {
  it("Given a hand within the limit, When a card is stored, Then it enters the hand with no discard decision", () => {
    const state = handState({ ownerHand: [] });
    const cards = {
      ...state.cards,
      [cardIds.ownerPrinterJam]: handCard(
        cardIds.ownerPrinterJam,
        OVERTIME_BONUS,
        "resolving",
        fixtureIds.owner,
      ),
    };

    const outcome = storeCardInHand({
      player: ownerOf(state),
      cards,
      cardId: cardIds.ownerPrinterJam,
      rules: state.rules,
      handLimit: 1,
      gameId: state.gameId,
      promptSequence: 42,
    });

    expect(outcome.kind).toBe("stored");
    if (outcome.kind !== "stored") return;
    expect(outcome.player.hand).toEqual([cardIds.ownerPrinterJam]);
    expect(outcome.cards[cardIds.ownerPrinterJam]?.zone).toBe("hand");
    expect(outcome.cards[cardIds.ownerPrinterJam]?.ownerId).toBe(fixtureIds.owner);
    expect(outcome.overLimitBy).toBe(0);
    expect(outcome.discardPrompt).toBeNull();
  });

  it("Given a full hand, When another card is drawn, Then the card is kept and a discard decision is raised — never a silent drop", () => {
    const state = handState();
    const cards = {
      ...state.cards,
      [cardIds.ownerPrinterJam]: handCard(
        cardIds.ownerPrinterJam,
        OVERTIME_BONUS,
        "resolving",
        fixtureIds.owner,
      ),
    };

    const outcome = storeCardInHand({
      player: ownerOf(state),
      cards,
      cardId: cardIds.ownerPrinterJam,
      rules: state.rules,
      handLimit: 1,
      gameId: state.gameId,
      promptSequence: 7,
    });

    expect(outcome.kind).toBe("stored");
    if (outcome.kind !== "stored") return;
    // The drawn card is really in hand; the player chooses what to lose.
    expect(outcome.player.hand).toEqual([cardIds.ownerOvertime, cardIds.ownerPrinterJam]);
    expect(outcome.overLimitBy).toBe(1);
    expect(outcome.discardPrompt?.kind).toBe(HAND_DISCARD_PROMPT_KIND);
    expect(outcome.discardPrompt?.audience).toEqual([fixtureIds.owner]);
    expect(outcome.discardPrompt?.legalResponses.map((option) => option.id)).toEqual([
      cardIds.ownerOvertime,
      cardIds.ownerPrinterJam,
    ]);
    // The default drops what was just drawn, restoring the status quo.
    expect(outcome.discardPrompt?.defaultResponse.optionId).toBe(cardIds.ownerPrinterJam);
    expect(outcome.discardPrompt?.id).toBe(`${state.gameId}:prompt:7:hand-discard`);
  });

  it("Given hidden hands, When a discard decision is raised, Then it is private and held cards are face down", () => {
    const open = handState();
    const hidden = withRules(open, { hidden: { hiddenHands: true } });
    const store = (state: GameState) =>
      storeCardInHand({
        player: ownerOf(state),
        cards: {
          ...state.cards,
          [cardIds.ownerPrinterJam]: handCard(
            cardIds.ownerPrinterJam,
            OVERTIME_BONUS,
            "resolving",
            fixtureIds.owner,
          ),
        },
        cardId: cardIds.ownerPrinterJam,
        rules: state.rules,
        handLimit: 1,
        gameId: state.gameId,
        promptSequence: 3,
      });

    const openOutcome = store(open);
    const hiddenOutcome = store(hidden);

    expect(openOutcome.kind === "stored" && openOutcome.discardPrompt?.visibility).toBe("public");
    expect(openOutcome.kind === "stored" && openOutcome.cards[cardIds.ownerPrinterJam]?.faceUp).toBe(
      true,
    );
    expect(hiddenOutcome.kind === "stored" && hiddenOutcome.discardPrompt?.visibility).toBe(
      "private",
    );
    expect(
      hiddenOutcome.kind === "stored" && hiddenOutcome.cards[cardIds.ownerPrinterJam]?.faceUp,
    ).toBe(false);
  });

  it("Given a mode with hands switched off, When a card would be stored, Then storing is refused outright", () => {
    const state = withRules(handState({ ownerHand: [] }), { agency: { handEnabled: false } });

    const outcome = storeCardInHand({
      player: ownerOf(state),
      cards: state.cards,
      cardId: cardIds.ownerOvertime,
      rules: state.rules,
      handLimit: 3,
      gameId: state.gameId,
      promptSequence: 1,
    });

    expect(outcome.kind).toBe("hand-disabled");
  });

  it("Given an over-full hand, When the player discards, Then the card reaches its deck's discard pile and the decision closes", () => {
    const state = handState({
      ownerHand: [cardIds.ownerOvertime, cardIds.ownerPrinterJam],
      cards: {
        [cardIds.ownerOvertime]: handCard(
          cardIds.ownerOvertime,
          OVERTIME_BONUS,
          "hand",
          fixtureIds.owner,
        ),
        [cardIds.ownerPrinterJam]: handCard(
          cardIds.ownerPrinterJam,
          OVERTIME_BONUS,
          "hand",
          fixtureIds.owner,
        ),
      },
    });

    const outcome = discardFromHand({
      player: ownerOf(state),
      cards: state.cards,
      decks: state.decks,
      cardId: cardIds.ownerPrinterJam,
      handLimit: 1,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.player.hand).toEqual([cardIds.ownerOvertime]);
    expect(outcome.decks[WORK_DECK_ID]?.discardPile).toEqual([cardIds.ownerPrinterJam]);
    expect(outcome.cards[cardIds.ownerPrinterJam]?.zone).toBe("discard-pile");
    expect(outcome.overLimitBy).toBe(0);
  });

  it("Given two cards over the limit, When one is discarded, Then the decision stays open", () => {
    const hand: readonly CardInstanceId[] = [
      cardIds.ownerOvertime,
      cardIds.ownerPrinterJam,
      cardIds.ownerExpense,
    ];
    const state = handState({
      ownerHand: hand,
      cards: Object.fromEntries(
        hand.map((cardId) => [cardId, handCard(cardId, OVERTIME_BONUS, "hand", fixtureIds.owner)]),
      ),
    });

    const outcome = discardFromHand({
      player: ownerOf(state),
      cards: state.cards,
      decks: state.decks,
      cardId: cardIds.ownerExpense,
      handLimit: 1,
    });

    expect(outcome.ok && outcome.overLimitBy).toBe(1);
  });

  it("Given a card the player is not holding, When they try to discard it, Then it is refused", () => {
    const state = handState();

    const outcome = discardFromHand({
      player: ownerOf(state),
      cards: state.cards,
      decks: state.decks,
      cardId: cardIds.opponentOvertime,
      handLimit: 1,
    });

    expect(outcome).toEqual({ ok: false, reason: "not-held" });
    expect(state.players[fixtureIds.hiddenOpponent]?.hand).toEqual([cardIds.opponentOvertime]);
  });

  it("Given a hand whose card map disagrees with the player's hand, When the card is looked up, Then it does not count as held", () => {
    const state = handState({
      cards: {
        // Same id, but the card map says another player owns it.
        [cardIds.ownerOvertime]: handCard(
          cardIds.ownerOvertime,
          OVERTIME_BONUS,
          "hand",
          fixtureIds.hiddenOpponent,
        ),
      },
    });

    expect(findHeldCard(state, fixtureIds.owner, cardIds.ownerOvertime)).toBeNull();
  });

  it("Given each shipped mode, When the hand limit is resolved, Then it matches the mode config and an unknown mode fails closed", () => {
    const state = handState();
    for (const mode of Object.values(deadlineDashModes)) {
      const modeState: GameState = { ...state, modeId: brand(mode.id) };
      expect(resolveHandLimit(modeState, deadlineDashContent)).toBe(mode.handLimit);
    }

    const unknown: GameState = { ...state, modeId: brand("mode.not-in-the-pack") };
    expect(resolveHandLimit(unknown, deadlineDashContent)).toBe(0);
  });

  it("Given a drawn card's timing, When its disposition is resolved, Then a disabled timing is discarded rather than resolved", () => {
    const state = handState();
    const handsOn = state.rules;
    const handsOff = withRules(state, { agency: { handEnabled: false } }).rules;

    expect(drawnCardDisposition("immediate", handsOn)).toBe("resolve");
    expect(drawnCardDisposition("stored", handsOn)).toBe("store");
    expect(drawnCardDisposition("reaction", handsOn)).toBe("store");
    expect(drawnCardDisposition("immediate", handsOff)).toBe("resolve");
    expect(drawnCardDisposition("stored", handsOff)).toBe("discard");
    expect(drawnCardDisposition("reaction", handsOff)).toBe("discard");
  });

  it("Given an open hand-discard prompt, When it is looked up, Then only its own audience finds it", () => {
    const base = handState();
    const outcome = storeCardInHand({
      player: ownerOf(base),
      cards: {
        ...base.cards,
        [cardIds.ownerPrinterJam]: handCard(
          cardIds.ownerPrinterJam,
          OVERTIME_BONUS,
          "resolving",
          fixtureIds.owner,
        ),
      },
      cardId: cardIds.ownerPrinterJam,
      rules: base.rules,
      handLimit: 1,
      gameId: base.gameId,
      promptSequence: 11,
    });
    if (outcome.kind !== "stored" || outcome.discardPrompt === null) {
      throw new Error("expected a discard prompt");
    }
    const state: GameState = { ...base, prompts: [outcome.discardPrompt] };

    expect(findHandDiscardPrompt(state, fixtureIds.owner)?.id).toBe(outcome.discardPrompt.id);
    expect(findHandDiscardPrompt(state, fixtureIds.hiddenOpponent)).toBeNull();
  });

  it("Given a hand and a limit, When the overage is measured, Then it never reports a negative surplus", () => {
    const state = handState({ ownerHand: [] });

    expect(handOverLimitBy(ownerOf(state), 3)).toBe(0);
    expect(handOverLimitBy(ownerOf(handState()), 0)).toBe(1);
  });

  it("Given a stored hand, When the state is serialized, Then it round-trips unchanged", () => {
    const state = handState({ decks: { [WORK_DECK_ID]: workDeck({ shuffleCount: 4 }) } });

    expect(deserializeGameState(serializeGameState(state))).toEqual(state);
  });
});
