import { describe, expect, it } from "vitest";

import { deadlineDashContent, deadlineDashModes } from "@office-ladder/content";
import type { DeckCard, DeckConfig, ModeRules } from "@office-ladder/content";

import { createSeededRandomSource } from "../src";
import type { GameId } from "../src";
import { buildDecks, expandCardCopies } from "../src/execution/deck-depletion";

const brand = <Id extends string>(value: string) => value as Id;

const quick = deadlineDashModes["mode.quick"];
const marathon = deadlineDashModes["mode.marathon"];
const campaign = deadlineDashModes["mode.campaign"];

const gameId = brand<GameId>("game-deck-copies");

function card(id: string, copies?: number): DeckCard {
  return {
    id,
    nameKey: `deadlineDash.card.${id}.name`,
    ...(copies === undefined ? {} : { copies }),
    effects: [{ type: "modifyResource", resource: "money", amount: 10, clampAtZero: true }],
  } as unknown as DeckCard;
}

function testDeck(cards: readonly DeckCard[], id = "deck.work"): DeckConfig {
  return { id: brand(id), cards };
}

function build(
  decks: readonly DeckConfig[],
  quantities: Readonly<Record<string, number>>,
  rules: ModeRules = quick.rules,
  seed = "copies-seed",
) {
  return buildDecks({
    gameId,
    decks,
    quantities,
    rules,
    clockDeckIds: [],
    random: createSeededRandomSource(seed),
  });
}

function definitionCounts(
  piles: ReturnType<typeof build>,
  deckId = "deck.work",
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cardId of piles.decks[deckId]?.drawPile ?? []) {
    const definition = piles.cards[cardId]?.definitionId as string | undefined;
    if (definition === undefined) continue;
    counts.set(definition, (counts.get(definition) ?? 0) + 1);
  }

  return counts;
}

/** The pack's own physical size for a deck: designs expanded by `copies`. */
function physicalSize(deckId: string): number {
  const deck = deadlineDashContent.decks.find((candidate) => candidate.id === deckId);

  return ((deck?.cards ?? []) as readonly DeckCard[]).reduce(
    (total, entry) => total + (entry.copies ?? 1),
    0,
  );
}

describe("expandCardCopies", () => {
  it("Given cards with and without copies, When the pool is expanded, Then each design appears exactly its copies count", () => {
    const pool = expandCardCopies([card("a", 4), card("b"), card("c", 2)]);

    expect(pool).toHaveLength(7);
    expect(pool.filter((entry) => entry.id === "a")).toHaveLength(4);
    expect(pool.filter((entry) => entry.id === "b")).toHaveLength(1);
    expect(pool.filter((entry) => entry.id === "c")).toHaveLength(2);
  });

  it("Given a nonsense copies value, When the pool is expanded, Then it degrades to one rather than throwing or exploding", () => {
    const pool = expandCardCopies([
      card("zero", 0),
      card("negative", -3),
      card("fractional", 2.5),
      card("absurd", 1e9),
    ]);

    expect(pool.filter((entry) => entry.id === "zero")).toHaveLength(1);
    expect(pool.filter((entry) => entry.id === "negative")).toHaveLength(1);
    expect(pool.filter((entry) => entry.id === "fractional")).toHaveLength(1);
    // Clamped: a content typo must not become an allocation loop bound.
    expect(pool.filter((entry) => entry.id === "absurd")).toHaveLength(99);
  });

  it("Given the shipped pack, When each deck is expanded, Then the pool matches the validator's physical-size arithmetic", () => {
    for (const deck of deadlineDashContent.decks) {
      expect(expandCardCopies(deck.cards)).toHaveLength(physicalSize(deck.id));
    }
  });
});

describe("deck construction honours copies", () => {
  it("Given a duplicated design, When the deck is cut at its full physical size, Then the duplicates are present", () => {
    const deck = testDeck([card("card.work.common", 4), card("card.work.legendary")]);

    const piles = build([deck], { "deck.work": 5 });

    expect(definitionCounts(piles)).toEqual(
      new Map([
        ["card.work.common", 4],
        ["card.work.legendary", 1],
      ]),
    );
  });

  it("Given a duplicated design, When the deck is cut below its physical size, Then rarity still biases what gets in", () => {
    // 20 commons at four copies each against 20 singletons: the cap takes half
    // the pool, and the whole point of `copies` is that the halving is weighted.
    const commons = Array.from({ length: 20 }, (_unused, index) =>
      card(`card.work.common-${index}`, 4),
    );
    const rares = Array.from({ length: 20 }, (_unused, index) =>
      card(`card.work.rare-${index}`),
    );

    const piles = build([testDeck([...commons, ...rares])], { "deck.work": 50 });
    const counts = definitionCounts(piles);
    const commonCards = [...counts]
      .filter(([id]) => id.includes("common"))
      .reduce((total, [, count]) => total + count, 0);

    expect(piles.decks["deck.work"]?.drawPile).toHaveLength(50);
    // 80 of the 100 physical cards are commons, so a fair cut of 50 lands well
    // clear of the 25/25 an unweighted cut would produce.
    expect(commonCards).toBeGreaterThan(30);
  });

  it("Given a mode quantity below the design count, When the deck is cut, Then designs past the cap are still reachable", () => {
    // The defect the shuffle-before-cut retires: taking the pool's leading slice
    // made every design after the cap unreachable in that mode, permanently.
    const deck = testDeck(
      Array.from({ length: 40 }, (_unused, index) => card(`card.work.n-${index}`)),
    );

    const dealt = new Set<string>();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const piles = build([deck], { "deck.work": 10 }, quick.rules, `seed-${attempt}`);
      for (const id of definitionCounts(piles).keys()) dealt.add(id);
    }

    // Every one of the 40 designs shows up across these thirty seeded cuts.
    // Under the old leading-slice cut this set would have held exactly the first
    // ten, identically, for every seed.
    expect(dealt.size).toBe(40);
  });

  it("Given a mode asking for more cards than the pool holds, When the deck is cut, Then the pool cycles and keeps its authored ratio", () => {
    const deck = testDeck([card("card.work.common", 3), card("card.work.rare")]);

    const piles = build([deck], { "deck.work": 40 });
    const counts = definitionCounts(piles);

    expect(piles.decks["deck.work"]?.drawPile).toHaveLength(40);
    expect(counts.get("card.work.common")).toBe(30);
    expect(counts.get("card.work.rare")).toBe(10);
  });

  it("Given no authored quantity for a deck, When it is built, Then it holds its physical size, not its design count", () => {
    const deck = testDeck([card("card.work.common", 4), card("card.work.rare")]);

    const piles = build([deck], {});

    expect(piles.decks["deck.work"]?.drawPile).toHaveLength(5);
  });

  it("Given a duplicated design the mode's timing rules exclude, When the deck is built, Then it costs the deck nothing", () => {
    const stored = {
      ...(card("card.work.stored", 4) as unknown as Record<string, unknown>),
      timing: "stored",
    } as unknown as DeckCard;
    const handsOff: ModeRules = {
      ...quick.rules,
      agency: { ...quick.rules.agency, handEnabled: false },
    };

    const piles = build([testDeck([stored, card("card.work.plain")])], {}, handsOff);

    // Filtered before expansion: four excluded copies must not reserve four
    // slots that then get padded with something else.
    expect(piles.decks["deck.work"]?.drawPile).toHaveLength(1);
    expect(definitionCounts(piles)).toEqual(new Map([["card.work.plain", 1]]));
  });

  it("Given the same seed, When decks are cut twice, Then the composition is identical", () => {
    const deck = testDeck([card("card.work.common", 4), card("card.work.rare")]);

    const first = build([deck], { "deck.work": 3 }, quick.rules, "same");
    const same = build([deck], { "deck.work": 3 }, quick.rules, "same");

    expect(definitionCounts(same)).toEqual(definitionCounts(first));
    expect(same.decks["deck.work"]?.drawPile).toEqual(first.decks["deck.work"]?.drawPile);
  });
});

describe("the shipped pack's copies against the shipped modes", () => {
  it("Given the twelve duplicated rows, When mode.campaign cuts every deck at its physical size, Then every authored copy is dealt", () => {
    const piles = build(
      deadlineDashContent.decks,
      campaign.deckQuantities,
      campaign.rules,
      "campaign",
    );

    // `mode.campaign`'s quantities are the physical sizes, so this is the one
    // mode where the deal is the whole pack and the counts are exact.
    for (const deck of deadlineDashContent.decks) {
      const quantity = campaign.deckQuantities[deck.id];
      if (quantity !== physicalSize(deck.id)) continue;

      const counts = definitionCounts(piles, deck.id);
      for (const authored of deck.cards as readonly DeckCard[]) {
        expect(counts.get(authored.id)).toBe(authored.copies ?? 1);
      }
    }
  });

  it("Given every shipped mode, When its decks are built, Then each deck is exactly the quantity the mode asks for", () => {
    for (const [modeId, mode] of Object.entries(deadlineDashModes)) {
      const piles = build(deadlineDashContent.decks, mode.deckQuantities, mode.rules, modeId);

      for (const [deckId, quantity] of Object.entries(mode.deckQuantities)) {
        expect(piles.decks[deckId]?.drawPile).toHaveLength(quantity);
      }
    }
  });

  it("Given mode.marathon, When deck.work is cut, Then the four-copy common is likelier to appear than a singleton", () => {
    // `card.work.complete-daily-task` is the only four-copy row in the pack.
    let duplicated = 0;
    let singleton = 0;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const counts = definitionCounts(
        build(
          deadlineDashContent.decks,
          marathon.deckQuantities,
          marathon.rules,
          `marathon-${attempt}`,
        ),
      );
      duplicated += counts.get("card.work.complete-daily-task") ?? 0;
      singleton += counts.get("card.work.overtime-hours") ?? 0;
    }

    expect(duplicated).toBeGreaterThan(singleton);
  });
});
