import { describe, expect, it } from "vitest";

import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";
import type { ModeRules } from "@office-ladder/content";

import {
  applyCommand,
  createGame,
  createSeededRandomSource,
  createStableId,
  deserializeGameState,
  projectPublicView,
  serializeGameState,
} from "../src";
import type { GameSetup, GameState, SetupContent } from "../src";
import {
  clockDeckExhaustionOutcome,
  clockDeckRemaining,
  drawCards,
  isClockDeckExhausted,
  materializeDecksOnLoad,
  resolveClockDeckIds,
} from "../src/execution/deck-depletion";

const brand = <Id extends string>(value: string) => value as Id;

const characterIds = Object.keys(deadlineDashContent.characters);

function setupFor(modeId: string, playerCount = 3): GameSetup {
  const players = Array.from({ length: playerCount }, (_unused, index) => ({
    id: createStableId("PlayerId", `player-${index}`),
    order: index,
    characterId: createStableId("CharacterId", characterIds[index] ?? ""),
    role: {
      id: createStableId("RoleId", `role-${index}`),
      kind: index === 1 ? ("role.management" as const) : ("role.worker" as const),
    },
  }));

  return {
    gameId: createStableId("GameId", "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"),
    modeId: createStableId("ModeId", modeId),
    players,
    authorizedStarterId: players[0]?.id ?? createStableId("PlayerId", "player-0"),
  };
}

function created(modeId: string, seed = "materialization-seed", playerCount = 3): GameState {
  const result = createGame(setupFor(modeId, playerCount), seed, deadlineDashContent);
  if (!result.ok) {
    throw new Error(`${modeId} setup failed: ${result.error.code} ${result.error.message}`);
  }

  return result.value;
}

/**
 * The one thing every deck assertion depends on: the pack really does author
 * cards. If `decks.ts` were ever emptied, every test below would pass vacuously.
 */
describe("the content pack this wires up", () => {
  it("Given the shipped pack, When its decks are read, Then every deck the modes size actually holds cards", () => {
    for (const deckId of Object.keys(deadlineDashModes["mode.quick"].deckQuantities)) {
      const deck = deadlineDashContent.decks.find((candidate) => candidate.id === deckId);
      expect(deck?.cards.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("decks are materialised into the state at setup", () => {
  it.each(Object.keys(deadlineDashModes))(
    "Given a new %s game, When it is created, Then every deck holds exactly the mode's quantity",
    (modeId) => {
      const state = created(modeId);
      const mode = deadlineDashModes[modeId as keyof typeof deadlineDashModes];

      // The defect this replaces: `decks` was `{}` on every started match, so
      // drawing read the content pack and no deck could ever deplete.
      expect(Object.keys(state.decks)).not.toHaveLength(0);
      for (const [deckId, quantity] of Object.entries(mode.deckQuantities)) {
        expect(state.decks[deckId]?.drawPile).toHaveLength(quantity);
      }
    },
  );

  it("Given a new game, When the card map is inspected, Then it matches the piles exactly, with no orphans either way", () => {
    const state = created("mode.standard");

    const pileIds = Object.values(state.decks).flatMap((deck) => [
      ...deck.drawPile,
      ...deck.discardPile,
      ...deck.visibleCards,
    ]);
    expect(new Set(pileIds).size).toBe(pileIds.length);
    expect(new Set(pileIds)).toEqual(new Set(Object.keys(state.cards)));
    for (const card of Object.values(state.cards)) {
      expect(card.zone).toBe("draw-pile");
      expect(card.ownerId).toBeNull();
      expect(card.faceUp).toBe(false);
      expect(state.decks[card.deckId]?.drawPile).toContain(card.id);
    }
  });

  it("Given a new game, When each deck's clock role is inspected, Then only the mode's clock decks refuse to reshuffle", () => {
    const state = created("mode.quick");
    const clockDeckIds: readonly string[] = deadlineDashModes["mode.quick"].clockDeck.deckIds;

    for (const [deckId, deck] of Object.entries(state.decks)) {
      const isClock = clockDeckIds.includes(deckId);
      expect(deck.reshufflesWhenEmpty).toBe(!isClock);
      expect(deck.managementShuffleEligible).toBe(!isClock);
      expect(deck.shuffleCount).toBe(1);
    }
    expect(clockDeckIds.length).toBeGreaterThan(0);
  });

  it.each(Object.keys(deadlineDashModes))(
    "Given a new %s game, When the decks built at setup are compared to the clock the transitions read, Then the two agree",
    (modeId) => {
      // Two independent readings of the same rule: `create-game.ts` decides which
      // decks are built as clock decks, and `resolveClockDeckIds` decides which
      // ones a transition counts down. If they ever drift, a deck runs dry with
      // nothing ending the match — so this is the assertion that keeps them honest.
      const state = created(modeId);
      const built = Object.entries(state.decks)
        .filter(([, deck]) => !deck.reshufflesWhenEmpty)
        .map(([deckId]) => deckId)
        .sort();

      expect(built).toEqual([...resolveClockDeckIds(state)].sort());
    },
  );

  it("Given a ruleset that switches the clock ending off, When the game is created, Then no deck is left unable to reshuffle", () => {
    // A mode that keeps `clockDeck.deckIds` but disables the ending must not get
    // the cost of a clock (two decks that permanently run dry) with none of the
    // payoff.
    const mode = deadlineDashModes["mode.quick"];
    const noClock = {
      ...deadlineDashContent,
      modes: {
        ...deadlineDashContent.modes,
        "mode.quick": {
          ...mode,
          rules: {
            ...mode.rules,
            endgame: {
              ...((mode.rules as { readonly endgame?: Record<string, unknown> }).endgame ?? {}),
              clockDecksEndMatch: false,
            },
          } as unknown as ModeRules,
        },
      },
    } as unknown as SetupContent;

    const result = createGame(setupFor("mode.quick"), "no-clock", noClock);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const deck of Object.values(result.value.decks)) {
      expect(deck.reshufflesWhenEmpty).toBe(true);
    }
    expect(
      isClockDeckExhausted(result.value.decks, [...mode.clockDeck.deckIds]),
    ).toBe(false);
  });

  it("Given a content pack with no authored decks, When a game is created, Then setup still succeeds with empty decks", () => {
    // The tolerance every hand-built `SetupContent` fixture relies on: a pack
    // with no `decks` key at all must degrade to the pre-materialisation state,
    // not fail setup.
    const deckless = {
      ...deadlineDashContent,
      decks: undefined,
    } as unknown as SetupContent;

    const result = createGame(setupFor("mode.quick"), "deckless", deckless);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decks).toEqual({});
    expect(result.value.cards).toEqual({});
  });

  it("Given the same seed, When two games are created, Then they deal identical piles; a different seed deals a different order", () => {
    const first = created("mode.quick", "identical");
    const same = created("mode.quick", "identical");
    const other = created("mode.quick", "different");

    expect(same.decks).toEqual(first.decks);
    expect(same.cards).toEqual(first.cards);
    expect(other.decks["deck.work"]?.drawPile).not.toEqual(
      first.decks["deck.work"]?.drawPile,
    );
  });

  it("Given a new game, When the RNG streams are inspected, Then the deal has its own stream and leaves setup and dice untouched", () => {
    const state = created("mode.quick");

    // Sharing `dice` would make the deal and the opening rolls two slices of one
    // sequence; sharing `setup` would couple the quarter schedule (which reads it
    // as seed material) to how many cards the mode deals.
    expect(state.rng.streams.setup?.cursor).toBe(0);
    expect(state.rng.streams.dice?.cursor).toBe(0);
    expect(state.rng.streams.decks?.cursor).toBeGreaterThan(0);
    expect(state.rng.streams.decks?.state).not.toBe(state.rng.streams.dice?.state);
    expect(state.rng.streams.decks?.state).not.toBe(state.rng.streams.setup?.state);
  });

  it("Given a started game, When game.start has been applied, Then the piles survive the transition", () => {
    const state = created("mode.quick");
    const started = applyCommand(
      state,
      {
        commandId: createStableId("CommandId", "11111111-2222-4333-8444-555555555555"),
        gameId: state.gameId,
        actorId: state.startAuthorizedPlayerId ?? createStableId("PlayerId", "player-0"),
        expectedRevision: 0,
        type: "game.start",
        payload: {},
      },
      { logicalTimestamp: "2026-07-26T00:00:00.000Z", content: deadlineDashContent },
    );

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.state.status).toBe("active");
    expect(started.value.state.decks).toEqual(state.decks);
    expect(started.value.state.cards).toEqual(state.cards);
  });
});

describe("the persisted size of a materialised match", () => {
  it.each(Object.keys(deadlineDashModes))(
    "Given a six-player %s game, When it goes through the snapshot boundary, Then it round-trips byte-identically",
    (modeId) => {
      const state = created(modeId, "size", 6);
      const serialized = serializeGameState(state);

      // The repository's own boundary is `JSON.parse(JSON.stringify(...))`, and
      // the engine's validator runs on the way back in: a pile referencing a
      // missing card, or a card in a zone nothing lists, is rejected there.
      expect(deserializeGameState(serialized)).toEqual(state);
      expect(serializeGameState(deserializeGameState(serialized))).toBe(serialized);
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    },
  );

  it("Given the largest mode at a full table, When the state is serialized, Then it stays well inside a sane row size", () => {
    const state = created("mode.campaign", "size", 6);
    const bytes = serializeGameState(state).length;

    // Measured: 227 cards, ~62 KB uncompressed against ~13 KB for the same state
    // with empty decks, and ~7 KB gzipped. Compression is *not* the reason this
    // matters — the repository rewrites the whole room blob on every command, so
    // the uncompressed number is what gets stringified, shipped and parsed each
    // time. It is why the card instance id does not carry a `gameId`: the same
    // state was 87 KB when it did.
    //
    // The ceiling is a regression guard, not a target. It sits at roughly twice
    // the measured value, so an accidental per-card blow-up trips it while
    // authoring the remaining ~220 card designs does not.
    expect(Object.keys(state.cards).length).toBeGreaterThan(200);
    expect(bytes).toBeLessThan(130_000);
    // And the per-card cost itself, which is the number that actually scales.
    expect((bytes - serializeGameState({ ...state, decks: {}, cards: {} }).length) / 227).toBeLessThan(
      300,
    );
  });

  it("Given a materialised match, When it is projected, Then the wire payload carries counts rather than the piles", () => {
    const state = created("mode.campaign", "projection", 6);

    const projected = projectPublicView(state);
    const emptied: GameState = { ...state, decks: {}, cards: {} };
    const growth =
      JSON.stringify(projected).length - JSON.stringify(projectPublicView(emptied)).length;

    // Hundreds of card ids in the state, and the projection grows by well under a
    // kilobyte: no card instance id reaches a client from a draw pile.
    expect(growth).toBeLessThan(1_000);
    for (const deck of projected.decks) {
      expect(deck.drawCount).toBeGreaterThan(0);
      expect(deck.visibleCards).toEqual([]);
    }
  });
});

describe("the clock deck now has material to consume", () => {
  it("Given a real Quick match, When both clock decks are drawn dry, Then the clock reports exhausted and settles a winner", () => {
    const state = created("mode.quick");
    const drawer = state.playerOrder[0];
    if (drawer === undefined) throw new Error("fixture has no players");
    const clockDeckIds: readonly string[] = deadlineDashModes["mode.quick"].clockDeck.deckIds;

    const before = clockDeckRemaining(state.decks, clockDeckIds);
    expect(before.total).toBe(deadlineDashModes["mode.quick"].clockDeck.quantities.total);
    expect(isClockDeckExhausted(state.decks, clockDeckIds)).toBe(false);

    let decks = state.decks;
    let cards = state.cards;
    for (const deckId of clockDeckIds) {
      const outcome = drawCards({
        decks,
        cards,
        deckId,
        // One more than the deck holds, to prove the last draw reports depletion
        // rather than reshuffling.
        count: (state.decks[deckId]?.drawPile.length ?? 0) + 1,
        drawnBy: drawer,
        random: createSeededRandomSource(`drain-${deckId}`),
      });
      expect(outcome.reshuffles).toBe(0);
      expect(outcome.depleted).toBe(true);
      decks = outcome.decks;
      cards = outcome.cards;
    }

    const drained: GameState = { ...state, decks, cards };
    expect(clockDeckRemaining(drained.decks, clockDeckIds).total).toBe(0);
    expect(isClockDeckExhausted(drained.decks, clockDeckIds)).toBe(true);

    const outcome = clockDeckExhaustionOutcome(
      drained,
      clockDeckIds,
      "2026-07-26T00:00:00.000Z",
    );
    expect(outcome.reason).toBe("clock-deck-exhausted");
    // Every player is an identical Intern at setup, so a promotion-path mode ties
    // them all — the honest result, not an invented single winner.
    expect(outcome.winnerPlayerIds).toEqual([...drained.playerOrder]);
  });

  it("Given a non-clock deck drawn past its size, When it runs out, Then it recycles its discard pile instead of ending anything", () => {
    const state = created("mode.quick");
    const drawer = state.playerOrder[0];
    if (drawer === undefined) throw new Error("fixture has no players");
    const size = state.decks["deck.work"]?.drawPile.length ?? 0;
    expect(size).toBeGreaterThan(0);

    // Draw the whole deck, discard every card, then draw once more.
    const emptied = drawCards({
      decks: state.decks,
      cards: state.cards,
      deckId: "deck.work",
      count: size,
      drawnBy: drawer,
      random: createSeededRandomSource("work-drain"),
    });
    let decks = emptied.decks;
    let cards = emptied.cards;
    for (const drawn of emptied.drawn) {
      const deck = decks["deck.work"];
      const card = cards[drawn.cardId];
      if (deck === undefined || card === undefined) continue;
      decks = {
        ...decks,
        "deck.work": { ...deck, discardPile: [...deck.discardPile, drawn.cardId] },
      };
      cards = { ...cards, [drawn.cardId]: { ...card, zone: "discard-pile", ownerId: null } };
    }

    const recycled = drawCards({
      decks,
      cards,
      deckId: "deck.work",
      count: 1,
      drawnBy: drawer,
      random: createSeededRandomSource("work-recycle"),
    });

    expect(recycled.reshuffles).toBe(1);
    expect(recycled.depleted).toBe(false);
    expect(recycled.decks["deck.work"]?.shuffleCount).toBe(2);
    expect(recycled.drawn).toHaveLength(1);
  });
});

describe("a match persisted before decks were materialised", () => {
  /** A v1-shaped state: real rules, real players, `decks`/`cards` empty. */
  function legacy(): GameState {
    const state = created("mode.quick");

    return { ...state, status: "active", decks: {}, cards: {} };
  }

  it("Given a legacy state with empty decks, When it is loaded, Then the piles are dealt from the mode's quantities", () => {
    const materialized = materializeDecksOnLoad(legacy(), deadlineDashContent);

    for (const [deckId, quantity] of Object.entries(
      deadlineDashModes["mode.quick"].deckQuantities,
    )) {
      expect(materialized.decks[deckId]?.drawPile).toHaveLength(quantity);
    }
    expect(isClockDeckExhausted(materialized.decks, [
      ...deadlineDashModes["mode.quick"].clockDeck.deckIds,
    ])).toBe(false);
  });

  it("Given the same legacy state loaded twice, When both are materialised, Then they deal the same cards", () => {
    // A repository that materialises on every read must not deal a different deck
    // each time, or the deck a player saw last request is gone this one.
    const state = legacy();

    expect(materializeDecksOnLoad(state, deadlineDashContent)).toEqual(
      materializeDecksOnLoad(state, deadlineDashContent),
    );
  });

  it("Given two legacy matches, When both are materialised, Then they do not share a deal", () => {
    const first = legacy();
    const second: GameState = {
      ...first,
      rng: {
        streams: {
          ...first.rng.streams,
          setup: { ...first.rng.streams.setup, state: "424242" },
        },
      },
    };

    expect(materializeDecksOnLoad(first, deadlineDashContent).decks).not.toEqual(
      materializeDecksOnLoad(second, deadlineDashContent).decks,
    );
  });

  it("Given a legacy state, When it is materialised, Then nothing outside decks and cards moves", () => {
    const state = legacy();
    const materialized = materializeDecksOnLoad(state, deadlineDashContent);

    // The migration contract: a replay is only deterministic if the streams stay
    // exactly where the match left them, so the deal must not draw from them.
    expect(materialized.rng).toEqual(state.rng);
    expect(materialized.revision).toBe(state.revision);
    expect(materialized.eventSequence).toBe(state.eventSequence);
    expect({ ...materialized, decks: {}, cards: {} }).toEqual(state);
  });

  it("Given a state that already has decks, When it is loaded, Then it is returned untouched", () => {
    const state = created("mode.quick");

    expect(materializeDecksOnLoad(state, deadlineDashContent)).toBe(state);
  });

  it("Given a state with cards but no decks, When it is loaded, Then it is left alone rather than half-rebuilt", () => {
    const state = created("mode.quick");
    const halfBuilt: GameState = { ...state, decks: {} };

    expect(materializeDecksOnLoad(halfBuilt, deadlineDashContent)).toBe(halfBuilt);
  });

  it("Given a legacy state on a mode the pack no longer ships, When it is loaded, Then each deck falls back to its physical size", () => {
    const unknownMode: GameState = { ...legacy(), modeId: brand("mode.retired") };

    const materialized = materializeDecksOnLoad(unknownMode, deadlineDashContent);

    // No authored quantity to honour, so the deck is its whole physical pool.
    // Nothing is invented and nothing is skipped: the clock still comes from the
    // ruleset the match already carries, not from a mode lookup that now misses.
    expect(Object.keys(materialized.decks)).not.toHaveLength(0);
    for (const deck of deadlineDashContent.decks) {
      const physical = deck.cards.reduce(
        (total, card) => total + ((card as { readonly copies?: number }).copies ?? 1),
        0,
      );
      expect(materialized.decks[deck.id]?.drawPile).toHaveLength(physical);
    }
  });

  it("Given a legacy state whose ruleset has no endgame block, When it is loaded, Then it gets decks but no clock", () => {
    // A pre-v2 snapshot predates `rules.endgame` entirely. Fail-closed: no clock
    // rather than a clock nobody configured.
    const base = legacy();
    const noEndgame: GameState = {
      ...base,
      rules: Object.fromEntries(
        Object.entries(base.rules).filter(([key]) => key !== "endgame"),
      ) as GameState["rules"],
    };

    const materialized = materializeDecksOnLoad(noEndgame, deadlineDashContent);

    expect(Object.keys(materialized.decks)).not.toHaveLength(0);
    for (const deck of Object.values(materialized.decks)) {
      expect(deck.reshufflesWhenEmpty).toBe(true);
    }
    expect(resolveClockDeckIds(materialized)).toEqual([]);
  });

  it("Given a materialised legacy state, When it is serialized, Then it round-trips", () => {
    const materialized = materializeDecksOnLoad(legacy(), deadlineDashContent);

    expect(deserializeGameState(serializeGameState(materialized))).toEqual(materialized);
  });
});
