import { describe, expect, it } from "vitest";

import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";
import type { DeckCard, DeckConfig, ModeRules } from "@office-ladder/content";

import { createSeededRandomSource, deserializeGameState, serializeGameState } from "../src";
import type { CardInstanceId, GameState, PlayerState } from "../src";
import {
  buildDecks,
  cardTiming,
  clockDeckExhaustionOutcome,
  clockDeckRemaining,
  discardCard,
  drawCards,
  isClockDeckExhausted,
  isDeckDepleted,
  resolveClockDeckIds,
  timingAllowed,
} from "../src/execution/deck-depletion";
import { fixtureIds } from "./fixtures";
import { logicalTimestamp, withRules } from "./turn-loop-fixtures";
import { handState } from "./cards-hand-fixtures";

const brand = <Id extends string>(value: string) => value as Id;

const quick = deadlineDashModes["mode.quick"];
const marathon = deadlineDashModes["mode.marathon"];


/** A card carrying a `timing` the content schema does not declare yet (spec §10.2). */
function timedCard(id: string, timing: string): DeckCard {
  return {
    id,
    nameKey: `deadlineDash.card.${id}.name`,
    timing,
    effects: [{ type: "modifyResource", resource: "money", amount: 10, clampAtZero: true }],
  } as unknown as DeckCard;
}

function plainCard(id: string): DeckCard {
  return {
    id,
    nameKey: `deadlineDash.card.${id}.name`,
    effects: [{ type: "modifyResource", resource: "money", amount: 10, clampAtZero: true }],
  } as unknown as DeckCard;
}

function testDeck(cards: readonly DeckCard[], id = "deck.work"): DeckConfig {
  return { id: brand(id), cards };
}

function build(
  decks: readonly DeckConfig[],
  quantities: Readonly<Record<string, number>>,
  rules: ModeRules,
  clockDeckIds: readonly string[] = [],
  seed = "seed-a",
) {
  return buildDecks({
    decks,
    quantities,
    rules,
    clockDeckIds,
    random: createSeededRandomSource(seed),
  });
}

describe("deck construction", () => {
  it("Given the shipped pack and a mode's quantities, When decks are built, Then each deck holds exactly the mode's card count", () => {
    const piles = build(
      deadlineDashContent.decks,
      quick.deckQuantities,
      quick.rules,
      quick.clockDeck.deckIds,
    );

    for (const [deckId, quantity] of Object.entries(quick.deckQuantities)) {
      expect(piles.decks[deckId]?.drawPile).toHaveLength(quantity);
    }
    const allCardIds = Object.values(piles.decks).flatMap((deck) => deck.drawPile);
    expect(new Set(allCardIds).size).toBe(allCardIds.length);
    expect(Object.keys(piles.cards)).toHaveLength(allCardIds.length);
    expect(
      Object.values(piles.cards).every(
        (card) => card.zone === "draw-pile" && card.ownerId === null && !card.faceUp,
      ),
    ).toBe(true);
  });

  it("Given a mode's clock decks, When decks are built, Then only the clock decks refuse to reshuffle", () => {
    const piles = build(
      deadlineDashContent.decks,
      quick.deckQuantities,
      quick.rules,
      quick.clockDeck.deckIds,
    );

    for (const deckId of quick.clockDeck.deckIds) {
      expect(piles.decks[deckId]?.reshufflesWhenEmpty).toBe(false);
      // A management shuffle would fold the discard pile back in and un-count
      // the clock, so it is not eligible for one either.
      expect(piles.decks[deckId]?.managementShuffleEligible).toBe(false);
    }
    expect(piles.decks["deck.work"]?.reshufflesWhenEmpty).toBe(true);
    expect(piles.decks["deck.networking"]?.reshufflesWhenEmpty).toBe(true);
  });

  it("Given the same seed, When decks are built twice, Then the piles are identical, and a different seed shuffles differently", () => {
    const first = build(deadlineDashContent.decks, quick.deckQuantities, quick.rules, [], "seed-a");
    const same = build(deadlineDashContent.decks, quick.deckQuantities, quick.rules, [], "seed-a");
    const other = build(deadlineDashContent.decks, quick.deckQuantities, quick.rules, [], "seed-b");

    expect(same.decks["deck.work"]?.drawPile).toEqual(first.decks["deck.work"]?.drawPile);
    expect(other.decks["deck.work"]?.drawPile).not.toEqual(first.decks["deck.work"]?.drawPile);
  });

  it("Given a mode with hands switched off, When decks are built, Then stored cards never enter the deck", () => {
    const deck = testDeck([plainCard("card.work.plain"), timedCard("card.work.stored", "stored")]);
    const handsOff = withRules(handState(), { agency: { handEnabled: false } }).rules;

    const withoutHands = build([deck], { "deck.work": 10 }, handsOff);
    const withHands = build([deck], { "deck.work": 10 }, quick.rules);

    const definitions = (piles: ReturnType<typeof build>) =>
      new Set(Object.values(piles.cards).map((card) => card.definitionId as string));
    expect(definitions(withoutHands)).toEqual(new Set(["card.work.plain"]));
    expect(definitions(withHands)).toEqual(
      new Set(["card.work.plain", "card.work.stored"]),
    );
    // Filtered at construction, not drawn-then-discarded: the deck is still the
    // mode's full size, made up only of cards the mode allows.
    expect(withoutHands.decks["deck.work"]?.drawPile).toHaveLength(10);
  });

  it("Given a mode with reaction windows switched off, When decks are built, Then reaction cards never enter the deck", () => {
    const deck = testDeck([
      plainCard("card.work.plain"),
      timedCard("card.work.reaction", "reaction"),
    ]);
    const noWindows = withRules(handState(), { interaction: { reactionWindows: false } }).rules;

    const piles = build([deck], { "deck.work": 8 }, noWindows);

    expect(
      Object.values(piles.cards).some((card) => card.definitionId === "card.work.reaction"),
    ).toBe(false);
  });

  it("Given a deck whose every card is filtered out, When it is built, Then it is empty rather than padded", () => {
    const deck = testDeck([timedCard("card.work.stored", "stored")]);
    const handsOff = withRules(handState(), { agency: { handEnabled: false } }).rules;

    const piles = build([deck], { "deck.work": 12 }, handsOff);

    expect(piles.decks["deck.work"]?.drawPile).toEqual([]);
    expect(Object.keys(piles.cards)).toHaveLength(0);
  });

  it("Given a card with no authored timing, When its timing is read, Then it is immediate — today's behaviour, unchanged", () => {
    const authored = deadlineDashContent.decks[0]?.cards[0];
    if (authored === undefined) throw new Error("the pack has no authored cards");

    expect(cardTiming(authored)).toBe("immediate");
    expect(cardTiming(timedCard("card.x", "stored"))).toBe("stored");
    expect(cardTiming(timedCard("card.x", "reaction"))).toBe("reaction");
    // An unrecognised timing degrades to immediate rather than deleting the card.
    expect(cardTiming(timedCard("card.x", "whenever"))).toBe("immediate");
  });

  it("Given each timing, When it is checked against a ruleset, Then enablement comes from the rules and never from a constant", () => {
    const on = quick.rules;
    const handsOff = withRules(handState(), { agency: { handEnabled: false } }).rules;
    const noWindows = withRules(handState(), { interaction: { reactionWindows: false } }).rules;

    expect(timingAllowed("immediate", handsOff)).toBe(true);
    expect(timingAllowed("stored", on)).toBe(true);
    expect(timingAllowed("stored", handsOff)).toBe(false);
    expect(timingAllowed("reaction", on)).toBe(true);
    expect(timingAllowed("reaction", noWindows)).toBe(false);
    // A reaction card needs somewhere to wait, so no hand means no reaction card.
    expect(timingAllowed("reaction", handsOff)).toBe(false);
  });
});

describe("drawing without replacement", () => {
  const threeCardDeck = () =>
    build(
      [testDeck([plainCard("card.a"), plainCard("card.b"), plainCard("card.c")])],
      { "deck.work": 3 },
      quick.rules,
      ["deck.work"],
    );

  it("Given a deck, When cards are drawn, Then each card leaves the draw pile exactly once", () => {
    const piles = threeCardDeck();

    const outcome = drawCards({
      decks: piles.decks,
      cards: piles.cards,
      deckId: "deck.work",
      count: 3,
      drawnBy: fixtureIds.owner,
      random: createSeededRandomSource("draw"),
    });

    expect(outcome.drawn).toHaveLength(3);
    expect(new Set(outcome.drawn.map((card) => card.cardId)).size).toBe(3);
    expect(outcome.decks["deck.work"]?.drawPile).toEqual([]);
    expect(
      outcome.drawn.every(
        (card) =>
          outcome.cards[card.cardId]?.zone === "resolving" &&
          outcome.cards[card.cardId]?.ownerId === fixtureIds.owner,
      ),
    ).toBe(true);
    expect(outcome.depleted).toBe(true);
    expect(outcome.reshuffles).toBe(0);
  });

  it("Given an exhausted non-reshuffling deck, When another card is drawn, Then nothing is produced and depletion is reported", () => {
    const piles = threeCardDeck();
    const emptied = drawCards({
      decks: piles.decks,
      cards: piles.cards,
      deckId: "deck.work",
      count: 3,
      drawnBy: null,
      random: createSeededRandomSource("draw"),
    });

    const outcome = drawCards({
      decks: emptied.decks,
      cards: emptied.cards,
      deckId: "deck.work",
      count: 1,
      drawnBy: null,
      random: createSeededRandomSource("draw"),
    });

    expect(outcome.drawn).toEqual([]);
    expect(outcome.depleted).toBe(true);
  });

  it("Given a reshuffling deck with a discard pile, When it runs dry, Then the discards come back and the shuffle is counted", () => {
    const piles = build(
      [testDeck([plainCard("card.a"), plainCard("card.b")])],
      { "deck.work": 2 },
      quick.rules,
      [],
    );
    const drawnFirst = drawCards({
      decks: piles.decks,
      cards: piles.cards,
      deckId: "deck.work",
      count: 1,
      drawnBy: null,
      random: createSeededRandomSource("draw"),
    });
    const firstCardId = drawnFirst.drawn[0]?.cardId;
    if (firstCardId === undefined) throw new Error("expected a drawn card");
    const discarded = discardCard({
      decks: drawnFirst.decks,
      cards: drawnFirst.cards,
      cardId: firstCardId,
    });

    const outcome = drawCards({
      decks: discarded.decks,
      cards: discarded.cards,
      deckId: "deck.work",
      count: 2,
      drawnBy: null,
      random: createSeededRandomSource("draw"),
    });

    expect(outcome.drawn).toHaveLength(2);
    expect(outcome.reshuffles).toBe(1);
    expect(outcome.decks["deck.work"]?.shuffleCount).toBe(2);
    expect(outcome.decks["deck.work"]?.discardPile).toEqual([]);
    expect(outcome.depleted).toBe(true);
  });

  it("Given a deck that is not in state, When a draw is attempted, Then it produces nothing instead of throwing", () => {
    const piles = threeCardDeck();

    const outcome = drawCards({
      decks: piles.decks,
      cards: piles.cards,
      deckId: "deck.does-not-exist",
      count: 2,
      drawnBy: null,
      random: createSeededRandomSource("draw"),
    });

    expect(outcome.drawn).toEqual([]);
    expect(outcome.depleted).toBe(true);
    expect(outcome.decks).toBe(piles.decks);
  });

  it("Given the same deck and seed, When the same draw is replayed, Then it produces the same cards", () => {
    const piles = threeCardDeck();
    const draw = () =>
      drawCards({
        decks: piles.decks,
        cards: piles.cards,
        deckId: "deck.work",
        count: 2,
        drawnBy: fixtureIds.owner,
        random: createSeededRandomSource("draw"),
      }).drawn.map((card) => card.cardId);

    expect(draw()).toEqual(draw());
  });
});

describe("clock deck exhaustion", () => {
  function clockState(overrides: {
    readonly meeting?: number;
    readonly event?: number;
  }): GameState {
    const piles = build(
      [
        testDeck(
          Array.from({ length: overrides.meeting ?? 0 }, (_, index) => plainCard(`m${index}`)),
          "deck.meeting",
        ),
        testDeck(
          Array.from({ length: overrides.event ?? 0 }, (_, index) => plainCard(`e${index}`)),
          "deck.event",
        ),
      ],
      { "deck.meeting": overrides.meeting ?? 0, "deck.event": overrides.event ?? 0 },
      quick.rules,
      ["deck.meeting", "deck.event"],
    );
    const base = handState();

    return {
      ...base,
      players: Object.fromEntries(
        Object.entries(base.players).map(([playerId, player]) => [
          playerId,
          { ...player, hand: [] } satisfies PlayerState,
        ]),
      ),
      decks: piles.decks,
      cards: piles.cards,
    };
  }

  it("Given clock decks with cards left, When exhaustion is checked, Then the match keeps running", () => {
    const state = clockState({ meeting: 1, event: 1 });

    expect(isClockDeckExhausted(state.decks, ["deck.meeting", "deck.event"])).toBe(false);
    expect(clockDeckRemaining(state.decks, ["deck.meeting", "deck.event"])).toEqual({
      remainingMeetingCards: 1,
      remainingEventCards: 1,
      total: 2,
    });
  });

  it("Given one clock deck still holding a card, When exhaustion is checked, Then the clock has not run out", () => {
    const state = clockState({ meeting: 0, event: 1 });

    expect(isClockDeckExhausted(state.decks, ["deck.meeting", "deck.event"])).toBe(false);
  });

  it("Given both clock decks empty, When exhaustion is checked, Then the clock has run out", () => {
    const state = clockState({ meeting: 0, event: 0 });

    expect(isDeckDepleted(state.decks["deck.meeting"])).toBe(true);
    expect(isClockDeckExhausted(state.decks, ["deck.meeting", "deck.event"])).toBe(true);
  });

  it("Given a mode that names no clock decks, When exhaustion is checked, Then the condition is switched off entirely", () => {
    const state = clockState({ meeting: 0, event: 0 });

    expect(isClockDeckExhausted(state.decks, [])).toBe(false);
  });

  it("Given each shipped mode's snapshotted ruleset, When its clock decks are resolved, Then they are exactly the pair that mode authors, and a ruleset with the clock switched off has none", () => {
    const base = handState();
    for (const mode of Object.values(deadlineDashModes)) {
      // Resolved from `state.rules`, so the mode id is set only to prove it is
      // not what the answer comes from. The assertion is still against the
      // *pack's* authored list, which is what stops `CLOCK_DECK_IDS` drifting
      // away from the decks the content release actually ships.
      const state: GameState = { ...base, modeId: brand(mode.id), rules: mode.rules };
      expect(resolveClockDeckIds(state)).toEqual(mode.clockDeck.deckIds);
    }

    const noClock = withRules(base, { endgame: { clockDecksEndMatch: false } });
    expect(resolveClockDeckIds(noClock)).toEqual([]);

    // A pre-v2 snapshot, whose ruleset predates the `endgame` block: fail closed
    // rather than put a match nobody asked to be timed on the clock.
    const legacy: GameState = {
      ...base,
      rules: { ...base.rules, endgame: undefined } as unknown as ModeRules,
    };
    expect(resolveClockDeckIds(legacy)).toEqual([]);
  });

  it("Given role win conditions, When the clock runs out, Then Management wins", () => {
    const state: GameState = { ...clockState({}), rules: marathon.rules };

    const outcome = clockDeckExhaustionOutcome(state, ["deck.meeting", "deck.event"], logicalTimestamp);

    expect(outcome.reason).toBe("clock-deck-exhausted");
    expect(outcome.winningRole).toBe("role.management");
    // Both Management players, listed in playerOrder — never object key order.
    expect(outcome.winnerPlayerIds).toEqual([
      fixtureIds.hiddenOpponent,
      fixtureIds.revealedOpponent,
    ]);
    expect(outcome.endedAt).toBe(logicalTimestamp);
    expect(outcome.scores).toEqual([]);
  });

  it("Given a promotion-path mode without role win conditions, When the clock runs out, Then the highest rank wins", () => {
    const state = clockState({});

    const outcome = clockDeckExhaustionOutcome(state, ["deck.meeting"], logicalTimestamp);

    // The fixture's revealed opponent is a Supervisor; the others are below them.
    expect(outcome.winnerPlayerIds).toEqual([fixtureIds.revealedOpponent]);
    expect(outcome.winPath).toBe("promotion");
    expect(outcome.winningRole).toBeNull();
  });

  it("Given a wealth-path mode, When the clock runs out, Then money decides it", () => {
    const state = withRules(clockState({}), {
      winPaths: { promotion: false, wealth: true, influence: false, survival: false },
    });

    const outcome = clockDeckExhaustionOutcome(state, ["deck.meeting"], logicalTimestamp);

    // Only the owner has any money in the fixture.
    expect(outcome.winnerPlayerIds).toEqual([fixtureIds.owner]);
    expect(outcome.winPath).toBe("wealth");
  });

  it("Given an eliminated leader, When the clock runs out, Then they cannot win", () => {
    const base = clockState({});
    const state: GameState = {
      ...base,
      eliminatedPlayerIds: [fixtureIds.revealedOpponent],
    };

    const outcome = clockDeckExhaustionOutcome(state, ["deck.meeting"], logicalTimestamp);

    expect(outcome.winnerPlayerIds).not.toContain(fixtureIds.revealedOpponent);
  });

  it("Given a mode with no win path enabled, When the clock runs out, Then the match ends with no winner rather than an invented one", () => {
    const state = withRules(clockState({}), {
      winPaths: { promotion: false, wealth: false, influence: false, survival: false },
    });

    const outcome = clockDeckExhaustionOutcome(state, ["deck.meeting"], logicalTimestamp);

    expect(outcome.winnerPlayerIds).toEqual([]);
    expect(outcome.winPath).toBeNull();
  });

  it("Given a state carrying built decks, When it is serialized, Then it round-trips unchanged", () => {
    const state = clockState({ meeting: 3, event: 2 });

    expect(deserializeGameState(serializeGameState(state))).toEqual(state);
  });

  it("Given a drawn-down clock, When the state is serialized, Then the resolving cards still round-trip", () => {
    const state = clockState({ meeting: 2, event: 2 });
    const drawn = drawCards({
      decks: state.decks,
      cards: state.cards,
      deckId: "deck.meeting",
      count: 2,
      drawnBy: fixtureIds.owner,
      random: createSeededRandomSource("draw"),
    });
    const next: GameState = { ...state, decks: drawn.decks, cards: drawn.cards };

    const drawnIds: readonly CardInstanceId[] = drawn.drawn.map((card) => card.cardId);
    expect(drawnIds).toHaveLength(2);
    expect(deserializeGameState(serializeGameState(next))).toEqual(next);
    expect(isClockDeckExhausted(next.decks, ["deck.meeting", "deck.event"])).toBe(false);
  });
});
