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
 *
 * `displayName`/`flavorText` are authored display copy, written in the
 * in-fiction register DESIGN.md's mandate requires: a line an office system
 * would have logged, procedural and unbothered, never a punchline. Every
 * flavor line is truthful to that card's own `effects` and deliberately does
 * not restate numbers — the UI renders the mechanics from `effects` directly,
 * so copy that implied an unimplemented mechanic would simply be a lie.
 */
export const deadlineDashDecks = [
  {
    id: "deck.work",
    cards: [
      {
        id: "card.work.overtime-bonus",
        nameKey: "deadlineDash.card.workOvertimeBonus.name",
        displayName: "Overtime Authorized",
        flavorText: "Payroll processed the extra hours without comment.",
        effects: [{ type: "modifyResource", resource: "money", amount: 150, clampAtZero: true }],
      },
      {
        id: "card.work.printer-jam",
        nameKey: "deadlineDash.card.workPrinterJam.name",
        displayName: "Printer Jam",
        flavorText: "Facilities logged the fault; you cleared the tray yourself.",
        effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
      },
      {
        id: "card.work.mentorship",
        nameKey: "deadlineDash.card.workMentorship.name",
        displayName: "Mentorship Assignment",
        flavorText: "You were named onboarding contact for the new hire.",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
      },
      {
        id: "card.work.expense-report-rejected",
        nameKey: "deadlineDash.card.workExpenseReportRejected.name",
        displayName: "Expense Report Rejected",
        flavorText: "Finance declined the receipt; the cost stays with you.",
        effects: [{ type: "payResource", resource: "money", amount: 100, insufficientFunds: "pay-up-to-available" }],
      },
      {
        id: "card.work.free-coffee",
        nameKey: "deadlineDash.card.workFreeCoffee.name",
        displayName: "Pantry Coffee Restocked",
        flavorText: "The machine was serviced this morning and the pot is full.",
        effects: [{ type: "restoreResourceToMaximum", resource: "energy" }],
      },
      {
        id: "card.work.crunch-time",
        nameKey: "deadlineDash.card.workCrunchTime.name",
        displayName: "Crunch Window",
        flavorText: "Shipped on schedule, with overtime paid and no time in lieu.",
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
        displayName: "Idea Adopted",
        flavorText: "Your suggestion was minuted and attributed to you.",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true }],
      },
      {
        id: "card.meeting.ran-long",
        nameKey: "deadlineDash.card.meetingRanLong.name",
        displayName: "Meeting Overran",
        flavorText: "Booked for thirty minutes; released after ninety.",
        effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
      },
      {
        id: "card.meeting.executive-endorsement",
        nameKey: "deadlineDash.card.meetingExecutiveEndorsement.name",
        displayName: "Executive Endorsement",
        flavorText: "A director's note on file, timed for your next pay run.",
        effects: [
          { type: "applyStatus", statusId: "status.next-salary-multiplier", duration: { kind: "uses", count: 1 }, parameters: { multiplier: 1.5 } },
        ],
      },
      {
        id: "card.meeting.awkward-silence",
        nameKey: "deadlineDash.card.meetingAwkwardSilence.name",
        displayName: "Dead Air",
        flavorText: "Your question landed and no one answered it.",
        effects: [{ type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true }],
      },
      {
        id: "card.meeting.free-lunch",
        nameKey: "deadlineDash.card.meetingFreeLunch.name",
        displayName: "Catering Surplus",
        flavorText: "The department expensed lunch and refunded your share.",
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
        displayName: "Quarterly Windfall",
        flavorText: "The unallocated pool cleared, and your name led the memo.",
        effects: [
          { type: "modifyResource", resource: "money", amount: 800, clampAtZero: true },
          { type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true },
        ],
      },
      {
        id: "card.event.office-fire-drill",
        nameKey: "deadlineDash.card.eventOfficeFireDrill.name",
        displayName: "Fire Drill",
        flavorText: "The floor was evacuated and the day was written off.",
        effects: [{ type: "skipTurns", count: 1, source: "tile" }],
      },
      {
        id: "card.event.surprise-bonus",
        nameKey: "deadlineDash.card.eventSurpriseBonus.name",
        displayName: "Unscheduled Bonus",
        flavorText: "Payroll issued a correction in your favor.",
        effects: [{ type: "modifyResource", resource: "money", amount: 300, clampAtZero: true }],
      },
      {
        id: "card.event.data-breach",
        nameKey: "deadlineDash.card.eventDataBreach.name",
        displayName: "Data Breach Disclosed",
        flavorText: "The incident traced back to a folder you shared.",
        effects: [{ type: "modifyResource", resource: "reputation", amount: -2, clampAtZero: true }],
      },
      {
        id: "card.event.headhunter-call",
        nameKey: "deadlineDash.card.eventHeadhunterCall.name",
        displayName: "Recruiter Call",
        flavorText: "An outside offer buys you one more move.",
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
        displayName: "Follow-Up Scheduled",
        flavorText: "The conversation was deferred to another contact.",
        effects: [{ type: "drawCards", deckId: "deck.networking", count: 1 }],
      },
      {
        id: "card.networking.linkedin-endorsement",
        nameKey: "deadlineDash.card.networkingLinkedinEndorsement.name",
        displayName: "Public Endorsement",
        flavorText: "A former colleague vouched for you where it is visible.",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
      },
      {
        id: "card.networking.free-swag",
        nameKey: "deadlineDash.card.networkingFreeSwag.name",
        displayName: "Vendor Swag",
        flavorText: "You cleared the booth's stock and resold it at your desk.",
        effects: [{ type: "modifyResource", resource: "money", amount: 75, clampAtZero: true }],
      },
      {
        id: "card.networking.awkward-elevator-ride",
        nameKey: "deadlineDash.card.networkingAwkwardElevatorRide.name",
        displayName: "Elevator Encounter",
        flavorText: "Nine floors alone with your skip-level manager.",
        effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
      },
      {
        id: "card.networking.vip-pass",
        nameKey: "deadlineDash.card.networkingVipPass.name",
        displayName: "Restricted Floor Pass",
        flavorText: "Escorted access; the next floor asks nothing of you.",
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
        id: "card.board-meeting.budget-approved",
        nameKey: "deadlineDash.card.boardMeetingBudgetApproved.name",
        displayName: "Budget Approved",
        flavorText: "The board signed off on your line item in full.",
        effects: [{ type: "modifyResource", resource: "money", amount: 400, clampAtZero: true }],
      },
      {
        id: "card.board-meeting.cant-buy-a-mouse",
        nameKey: "deadlineDash.card.boardMeetingCantBuyAMouse.name",
        displayName: "Procurement Freeze",
        flavorText: "Requisition denied; you bought the hardware yourself.",
        effects: [{ type: "payResource", resource: "money", amount: 150, insufficientFunds: "pay-up-to-available" }],
      },
      {
        id: "card.board-meeting.strategic-alignment",
        nameKey: "deadlineDash.card.boardMeetingStrategicAlignment.name",
        displayName: "Strategic Alignment",
        flavorText: "Your roadmap left the review unamended.",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true }],
      },
      {
        id: "card.board-meeting.restructuring",
        nameKey: "deadlineDash.card.boardMeetingRestructuring.name",
        displayName: "Restructuring",
        flavorText: "Your workload moved to another team, effective immediately.",
        effects: [{ type: "restoreResourceToMaximum", resource: "energy" }],
      },
    ],
  },
  {
    id: "deck.annual-event",
    cards: [
      {
        id: "card.annual-event.company-retreat",
        nameKey: "deadlineDash.card.annualEventCompanyRetreat.name",
        displayName: "Company Retreat",
        flavorText: "Two days offsite, and a mention in the closing remarks.",
        effects: [{ type: "restoreResourceToMaximum", resource: "energy" }, { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
      },
      {
        id: "card.annual-event.holiday-bonus",
        nameKey: "deadlineDash.card.annualEventHolidayBonus.name",
        displayName: "Holiday Bonus Scheduled",
        flavorText: "Approved in advance and attached to your next pay run.",
        effects: [
          { type: "applyStatus", statusId: "status.next-salary-multiplier", duration: { kind: "uses", count: 1 }, parameters: { multiplier: 2 } },
        ],
      },
      {
        id: "card.annual-event.awards-ceremony",
        nameKey: "deadlineDash.card.annualEventAwardsCeremony.name",
        displayName: "Awards Ceremony",
        flavorText: "Named employee of the year in front of the whole floor.",
        effects: [{ type: "modifyResource", resource: "reputation", amount: 3, clampAtZero: true }],
      },
      {
        id: "card.annual-event.karaoke-mishap",
        nameKey: "deadlineDash.card.annualEventKaraokeMishap.name",
        displayName: "After-Party Incident",
        flavorText: "The recording circulated on the internal channel by morning.",
        effects: [{ type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true }],
      },
    ],
  },
] as const satisfies readonly DeckConfig[];
