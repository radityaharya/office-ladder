import { describe, expect, it } from "vitest";

import { deadlineDashDecks } from "../src/deadline-dash";
import type { DeckConfig } from "../src/schema/decks";

/**
 * Read the authored pack through its *public* type rather than its `as const`
 * literal type, so `displayName`/`flavorText` are seen exactly as a consumer
 * sees them — optional, therefore `string | undefined`. That makes the
 * assertions below real runtime coverage checks instead of tautologies the
 * literal type would already have guaranteed.
 */
const decks: readonly DeckConfig[] = deadlineDashDecks;

/** Fits the card-draw modal's title line without wrapping. */
const maxDisplayNameLength = 40;
/** One clause: long enough to read as a logged note, short enough to stay one line. */
const maxFlavorTextLength = 80;

/** Authored copy coverage per deck, asserted exactly so dropping copy fails loudly. */
const expectedCardCounts: Readonly<Record<string, number>> = {
  "deck.work": 6,
  "deck.meeting": 5,
  "deck.event": 5,
  "deck.networking": 5,
  "deck.board-meeting": 4,
  "deck.annual-event": 4,
};

function collectCopyProblems(
  check: (card: DeckConfig["cards"][number], deck: DeckConfig) => string | null,
): readonly string[] {
  const problems: string[] = [];
  for (const deck of decks) {
    for (const card of deck.cards) {
      const problem = check(card, deck);
      if (problem !== null) problems.push(`${card.id}: ${problem}`);
    }
  }
  return problems;
}

describe("Deadline Dash deck card display copy", () => {
  it("authors a display name and a flavor line for every card in every deck", () => {
    expect(
      collectCopyProblems((card) => {
        if (typeof card.displayName !== "string") return "missing displayName";
        if (typeof card.flavorText !== "string") return "missing flavorText";
        return null;
      }),
    ).toEqual([]);
  });

  it("covers exactly the authored card catalog, deck by deck", () => {
    const covered = Object.fromEntries(
      decks.map((deck) => [
        deck.id,
        deck.cards.filter(
          (card) =>
            typeof card.displayName === "string" && typeof card.flavorText === "string",
        ).length,
      ]),
    );

    expect(covered).toEqual(expectedCardCounts);
    expect(
      decks.map((deck) => [deck.id, deck.cards.length] as const),
    ).toEqual(Object.entries(expectedCardCounts));
  });

  it("keeps every authored string non-empty and trimmed", () => {
    expect(
      collectCopyProblems((card) => {
        for (const [field, value] of [
          ["displayName", card.displayName],
          ["flavorText", card.flavorText],
        ] as const) {
          if (value === undefined) return `missing ${field}`;
          if (value.length === 0) return `empty ${field}`;
          if (value !== value.trim()) return `untrimmed ${field}: ${JSON.stringify(value)}`;
          if (value.includes("  ")) return `double-spaced ${field}: ${JSON.stringify(value)}`;
          if (/[\n\r\t]/.test(value)) return `multi-line ${field}: ${JSON.stringify(value)}`;
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("keeps the copy short enough to render on one line in a modal", () => {
    expect(
      collectCopyProblems((card) => {
        if (card.displayName !== undefined && card.displayName.length > maxDisplayNameLength) {
          return `displayName is ${card.displayName.length} chars (max ${maxDisplayNameLength})`;
        }
        if (card.flavorText !== undefined && card.flavorText.length > maxFlavorTextLength) {
          return `flavorText is ${card.flavorText.length} chars (max ${maxFlavorTextLength})`;
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("writes the flavor line as a single terminated statement, not a paragraph", () => {
    expect(
      collectCopyProblems((card) => {
        if (card.flavorText === undefined) return "missing flavorText";
        if (!card.flavorText.endsWith(".")) {
          return `flavorText is unterminated: ${JSON.stringify(card.flavorText)}`;
        }
        if (card.flavorText.slice(0, -1).includes(".")) {
          return `flavorText runs past one statement: ${JSON.stringify(card.flavorText)}`;
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("never hardcodes a numeral in copy, so copy cannot contradict the card's effects", () => {
    expect(
      collectCopyProblems((card) => {
        for (const [field, value] of [
          ["displayName", card.displayName],
          ["flavorText", card.flavorText],
        ] as const) {
          if (value !== undefined && /\d/.test(value)) {
            return `${field} states a numeral, which can drift from effects: ${JSON.stringify(value)}`;
          }
        }
        return null;
      }),
    ).toEqual([]);
  });

  it("gives no two cards in a deck the same display name", () => {
    for (const deck of decks) {
      const names = deck.cards.map((card) => card.displayName);
      expect(new Set(names).size, `duplicate displayName within ${deck.id}`).toBe(
        deck.cards.length,
      );
    }
  });

  it("gives no two cards in the whole pack the same display name or flavor line", () => {
    const allCards = decks.flatMap((deck) => deck.cards);

    expect(new Set(allCards.map((card) => card.displayName)).size).toBe(allCards.length);
    expect(new Set(allCards.map((card) => card.flavorText)).size).toBe(allCards.length);
  });

  it("adds copy without disturbing the ids, name keys, or effects the engine reads", () => {
    const identity = decks.flatMap((deck) =>
      deck.cards.map((card) => ({
        deckId: deck.id,
        id: card.id,
        nameKey: card.nameKey,
        effectTypes: card.effects.map((effect) => effect.type),
      })),
    );

    expect(identity).toEqual([
      {
        deckId: "deck.work",
        id: "card.work.overtime-bonus",
        nameKey: "deadlineDash.card.workOvertimeBonus.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.printer-jam",
        nameKey: "deadlineDash.card.workPrinterJam.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.mentorship",
        nameKey: "deadlineDash.card.workMentorship.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.expense-report-rejected",
        nameKey: "deadlineDash.card.workExpenseReportRejected.name",
        effectTypes: ["payResource"],
      },
      {
        deckId: "deck.work",
        id: "card.work.free-coffee",
        nameKey: "deadlineDash.card.workFreeCoffee.name",
        effectTypes: ["restoreResourceToMaximum"],
      },
      {
        deckId: "deck.work",
        id: "card.work.crunch-time",
        nameKey: "deadlineDash.card.workCrunchTime.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.great-idea",
        nameKey: "deadlineDash.card.meetingGreatIdea.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.ran-long",
        nameKey: "deadlineDash.card.meetingRanLong.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.executive-endorsement",
        nameKey: "deadlineDash.card.meetingExecutiveEndorsement.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.awkward-silence",
        nameKey: "deadlineDash.card.meetingAwkwardSilence.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.meeting",
        id: "card.meeting.free-lunch",
        nameKey: "deadlineDash.card.meetingFreeLunch.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.jackpot",
        nameKey: "deadlineDash.card.eventJackpot.name",
        effectTypes: ["modifyResource", "modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.office-fire-drill",
        nameKey: "deadlineDash.card.eventOfficeFireDrill.name",
        effectTypes: ["skipTurns"],
      },
      {
        deckId: "deck.event",
        id: "card.event.surprise-bonus",
        nameKey: "deadlineDash.card.eventSurpriseBonus.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.data-breach",
        nameKey: "deadlineDash.card.eventDataBreach.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.event",
        id: "card.event.headhunter-call",
        nameKey: "deadlineDash.card.eventHeadhunterCall.name",
        effectTypes: ["grantExtraRoll"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.lets-circle-back",
        nameKey: "deadlineDash.card.networkingLetsCircleBack.name",
        effectTypes: ["drawCards"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.linkedin-endorsement",
        nameKey: "deadlineDash.card.networkingLinkedinEndorsement.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.free-swag",
        nameKey: "deadlineDash.card.networkingFreeSwag.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.awkward-elevator-ride",
        nameKey: "deadlineDash.card.networkingAwkwardElevatorRide.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.networking",
        id: "card.networking.vip-pass",
        nameKey: "deadlineDash.card.networkingVipPass.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.budget-approved",
        nameKey: "deadlineDash.card.boardMeetingBudgetApproved.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.cant-buy-a-mouse",
        nameKey: "deadlineDash.card.boardMeetingCantBuyAMouse.name",
        effectTypes: ["payResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.strategic-alignment",
        nameKey: "deadlineDash.card.boardMeetingStrategicAlignment.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.board-meeting",
        id: "card.board-meeting.restructuring",
        nameKey: "deadlineDash.card.boardMeetingRestructuring.name",
        effectTypes: ["restoreResourceToMaximum"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.company-retreat",
        nameKey: "deadlineDash.card.annualEventCompanyRetreat.name",
        effectTypes: ["restoreResourceToMaximum", "modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.holiday-bonus",
        nameKey: "deadlineDash.card.annualEventHolidayBonus.name",
        effectTypes: ["applyStatus"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.awards-ceremony",
        nameKey: "deadlineDash.card.annualEventAwardsCeremony.name",
        effectTypes: ["modifyResource"],
      },
      {
        deckId: "deck.annual-event",
        id: "card.annual-event.karaoke-mishap",
        nameKey: "deadlineDash.card.annualEventKaraokeMishap.name",
        effectTypes: ["modifyResource"],
      },
    ]);
  });
});
