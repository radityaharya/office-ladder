import type { DeckConfig } from "../schema/decks";

/**
 * A curated, honest subset of the full designed card system (see
 * docs/DEADLINE_DASH_FULL_GDD.md — ~247 cards across 6 decks, with
 * target-player mechanics, [REACTION]/stored cards playable on other
 * players' turns, and a "Clock Deck" timer win condition for Management).
 * These are real, GDD-flavored, *immediate self-effect only* cards — no
 * targeting, no stored/reaction play, no deck-depletion timer. That fuller
 * system remains a genuine content+engine undertaking, not attempted here.
 * See AGENTS.md's "Known gaps" for what's deliberately out of scope.
 */
export const deadlineDashDecks = [
  {
    id: "deck.work",
    cards: [
      {
        id: "card.work.overtime-bonus",
        nameKey: "deadlineDash.card.workOvertimeBonus.name",
        effects: [{ type: "modifyResource", resource: "money", amount: 150, clampAtZero: true }],
      },
      {
        id: "card.work.printer-jam",
        nameKey: "deadlineDash.card.workPrinterJam.name",
        effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
      },
      {
        id: "card.work.mentorship",
        nameKey: "deadlineDash.card.workMentorship.name",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
      },
      {
        id: "card.work.expense-report-rejected",
        nameKey: "deadlineDash.card.workExpenseReportRejected.name",
        effects: [{ type: "payResource", resource: "money", amount: 100, insufficientFunds: "pay-up-to-available" }],
      },
      {
        id: "card.work.free-coffee",
        nameKey: "deadlineDash.card.workFreeCoffee.name",
        effects: [{ type: "restoreResourceToMaximum", resource: "energy" }],
      },
      {
        id: "card.work.crunch-time",
        nameKey: "deadlineDash.card.workCrunchTime.name",
        effects: [
          { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
          { type: "modifyResource", resource: "energy", amount: -2, clampAtZero: true },
        ],
      },
    ],
  },
  {
    id: "deck.meeting",
    cards: [
      {
        id: "card.meeting.great-idea",
        nameKey: "deadlineDash.card.meetingGreatIdea.name",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true }],
      },
      {
        id: "card.meeting.ran-long",
        nameKey: "deadlineDash.card.meetingRanLong.name",
        effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
      },
      {
        id: "card.meeting.executive-endorsement",
        nameKey: "deadlineDash.card.meetingExecutiveEndorsement.name",
        effects: [
          { type: "applyStatus", statusId: "status.next-salary-multiplier", duration: { kind: "uses", count: 1 }, parameters: { multiplier: 1.5 } },
        ],
      },
      {
        id: "card.meeting.awkward-silence",
        nameKey: "deadlineDash.card.meetingAwkwardSilence.name",
        effects: [{ type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true }],
      },
      {
        id: "card.meeting.free-lunch",
        nameKey: "deadlineDash.card.meetingFreeLunch.name",
        effects: [{ type: "modifyResource", resource: "money", amount: 50, clampAtZero: true }],
      },
    ],
  },
  {
    id: "deck.event",
    cards: [
      {
        id: "card.event.jackpot",
        nameKey: "deadlineDash.card.eventJackpot.name",
        effects: [
          { type: "modifyResource", resource: "money", amount: 800, clampAtZero: true },
          { type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true },
        ],
      },
      {
        id: "card.event.office-fire-drill",
        nameKey: "deadlineDash.card.eventOfficeFireDrill.name",
        effects: [{ type: "skipTurns", count: 1, source: "tile" }],
      },
      {
        id: "card.event.surprise-bonus",
        nameKey: "deadlineDash.card.eventSurpriseBonus.name",
        effects: [{ type: "modifyResource", resource: "money", amount: 300, clampAtZero: true }],
      },
      {
        id: "card.event.data-breach",
        nameKey: "deadlineDash.card.eventDataBreach.name",
        effects: [{ type: "modifyResource", resource: "reputation", amount: -2, clampAtZero: true }],
      },
      {
        id: "card.event.headhunter-call",
        nameKey: "deadlineDash.card.eventHeadhunterCall.name",
        effects: [{ type: "grantExtraRoll", count: 1 }],
      },
    ],
  },
  {
    id: "deck.networking",
    cards: [
      {
        id: "card.networking.lets-circle-back",
        nameKey: "deadlineDash.card.networkingLetsCircleBack.name",
        effects: [{ type: "drawCards", deckId: "deck.networking", count: 1 }],
      },
      {
        id: "card.networking.linkedin-endorsement",
        nameKey: "deadlineDash.card.networkingLinkedinEndorsement.name",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
      },
      {
        id: "card.networking.free-swag",
        nameKey: "deadlineDash.card.networkingFreeSwag.name",
        effects: [{ type: "modifyResource", resource: "money", amount: 75, clampAtZero: true }],
      },
      {
        id: "card.networking.awkward-elevator-ride",
        nameKey: "deadlineDash.card.networkingAwkwardElevatorRide.name",
        effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
      },
      {
        id: "card.networking.vip-pass",
        nameKey: "deadlineDash.card.networkingVipPass.name",
        effects: [
          { type: "applyStatus", statusId: "status.skip-next-tile-effect", duration: { kind: "uses", count: 1 } },
        ],
      },
    ],
  },
  {
    id: "deck.board-meeting",
    cards: [
      {
        id: "card.boardMeeting.budget-approved",
        nameKey: "deadlineDash.card.boardMeetingBudgetApproved.name",
        effects: [{ type: "modifyResource", resource: "money", amount: 400, clampAtZero: true }],
      },
      {
        id: "card.boardMeeting.cant-buy-a-mouse",
        nameKey: "deadlineDash.card.boardMeetingCantBuyAMouse.name",
        effects: [{ type: "payResource", resource: "money", amount: 150, insufficientFunds: "pay-up-to-available" }],
      },
      {
        id: "card.boardMeeting.strategic-alignment",
        nameKey: "deadlineDash.card.boardMeetingStrategicAlignment.name",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true }],
      },
      {
        id: "card.boardMeeting.restructuring",
        nameKey: "deadlineDash.card.boardMeetingRestructuring.name",
        effects: [{ type: "restoreResourceToMaximum", resource: "energy" }],
      },
    ],
  },
  {
    id: "deck.annual-event",
    cards: [
      {
        id: "card.annualEvent.company-retreat",
        nameKey: "deadlineDash.card.annualEventCompanyRetreat.name",
        effects: [{ type: "restoreResourceToMaximum", resource: "energy" }, { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
      },
      {
        id: "card.annualEvent.holiday-bonus",
        nameKey: "deadlineDash.card.annualEventHolidayBonus.name",
        effects: [
          { type: "applyStatus", statusId: "status.next-salary-multiplier", duration: { kind: "uses", count: 1 }, parameters: { multiplier: 2 } },
        ],
      },
      {
        id: "card.annualEvent.awards-ceremony",
        nameKey: "deadlineDash.card.annualEventAwardsCeremony.name",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 3, clampAtZero: true }],
      },
      {
        id: "card.annualEvent.karaoke-mishap",
        nameKey: "deadlineDash.card.annualEventKaraokeMishap.name",
        effects: [{ type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true }],
      },
    ],
  },
] as const satisfies readonly DeckConfig[];
