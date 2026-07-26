import type { DeckConfig } from "../../schema/decks";

/**
 * `deck.board-meeting` — one of the two corner decks, drawn from the bottom-left
 * corner space. Corner decks are all-player decks by design.
 *
 * Append new cards to `boardMeetingDeck.cards`. The authoring and display-copy
 * rules that bind every card in this pack live in the docstring of
 * `./index.ts`; read them before adding a row here.
 *
 * ## The re-cut, and what it fixed
 *
 * The four cards this deck used to ship are all gone. Two had no source in the
 * design workbook at all and applied a *self-only* effect in a deck whose whole
 * premise is that it lands on the table; the other two are superseded by
 * `card.board-meeting.budget-freeze` and `card.board-meeting.company-restructuring`
 * — and the superseded restructuring card's sign was the opposite of its own
 * source row's, so it paid the player it was written to cost.
 *
 * The deeper problem was the deck shape rather than any one card. A symmetric
 * effect applied to everyone changes nobody's relative standing, so a card that
 * consumes a turn, writes a log line and leaves the game exactly where it was is
 * ceremonial. **All-player must never mean identical-to-everyone.** Every card
 * below therefore carries at least one named asymmetry pattern, printed on its
 * own row:
 *
 *   P1 rank-scaled     `scale: { by: "rank-tier" }` on an `@all-players` effect
 *   P2 rank-inverse    two effects split by a `rankIndexAtMost`/`AtLeast` guard
 *   P3 derived subset  a second effect at `@richest` / `@highest-rank` / …
 *   P4 heat-gated      guarded on `heatAtLeast`, or its negation
 *   P6 work-scaled     `scale: { by: "work-counter" }`, or a work-counter guard
 *   P7 split           opposite effects at `@highest-rank` and `@lowest-rank`
 *   P9 actor-exempt    `@all-opponents` while the actor gains — aimed, carries heat
 *
 * ## Aggression
 *
 * Three cards here are **aimed**: `cost-optimization`, `budget-reallocation` and
 * `cost-saving-initiative`, all pattern P9. Each carries `modifyHeat` on the
 * actor with an explicit `target: "self"`, because the drawer is standing outside
 * a cost every opponent pays. Nothing else in the deck carries heat — an
 * `@all-players` or `@highest-rank` effect can land on the drawer themself, so
 * nobody chose a victim, and charging heat where there was no choice is as much a
 * defect as not charging it where there was.
 *
 * ## Reading the guards
 *
 * `condition.who` is `"target"` on every guard in this file, which is what makes
 * a guard on an `@all-players` effect mean "each player is tested individually"
 * rather than "test the drawer once". The two readings produce different cards.
 * The re-cut plan writes the heat guards as `heatAtMost(0)`; the engine's closed
 * condition grammar has no `heatAtMost` clause, so they are written here as
 * `not(heatAtLeast(1))`, which is the same predicate over integer heat.
 *
 * The deck is net negative on reputation, and that is the point of it: the split
 * cards give back at the bottom of the table what they take off the top, so it
 * redistributes rather than drains. A board meeting is a place things are done
 * *to* you.
 *
 * Timing is `immediate` on every card, so none of them sets `timing`. This deck
 * is not part of the Clock Deck, so it reshuffles rather than depleting.
 */
export const boardMeetingDeck = {
  id: "deck.board-meeting",
  cards: [
    {
      /** P1 rank-scaled. Was a flat table-wide loss; the levy now tracks signing authority. */
      id: "card.board-meeting.budget-freeze",
      nameKey: "deadlineDash.card.boardMeetingBudgetFreeze.name",
      displayName: "Budget Freeze",
      flavorText: "Committed lines were recalled from every budget, weighted by authority.",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 200,
          insufficientFunds: "pay-up-to-available",
          target: "all-players",
          scale: { by: "rank-tier", perUnit: 100 },
        },
      ],
    },
    {
      /**
       * P7 split. Supersedes the shipped `card.board-meeting.restructuring`, whose
       * sign was the opposite of its own source row's. The source's table-wide
       * reputation penalty is re-cut as a reorganisation that costs the top of the
       * chart and lifts the bottom, which is what a restructure actually does.
       */
      id: "card.board-meeting.company-restructuring",
      nameKey: "deadlineDash.card.boardMeetingCompanyRestructuring.name",
      displayName: "Company Restructuring",
      flavorText: "The reissued org chart cost the senior tier and lifted the junior one.",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -3,
          clampAtZero: true,
          target: "highest-rank",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "lowest-rank",
        },
      ],
    },
    {
      /** P1 rank-scaled. */
      id: "card.board-meeting.annual-bonus-approved",
      nameKey: "deadlineDash.card.boardMeetingAnnualBonusApproved.name",
      displayName: "Annual Bonus Approved",
      flavorText: "Finance cleared the annual pool and distributed it against grade.",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 200,
          clampAtZero: true,
          target: "all-players",
          scale: { by: "rank-tier", perUnit: 150 },
        },
      ],
    },
    {
      /**
       * P4 heat-gated. The two effects are mutually exclusive by construction —
       * heat is either zero or it is not — so exactly one lands per player, and
       * `condition.who: "target"` is what makes the test run per player rather
       * than once on the drawer.
       */
      id: "card.board-meeting.extra-leave-approved",
      nameKey: "deadlineDash.card.boardMeetingExtraLeaveApproved.name",
      displayName: "Extra Leave Approved",
      flavorText: "Additional leave was granted, shortened for anyone under review.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 3,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "all-players",
          condition: { kind: "not", of: { kind: "heatAtLeast", who: "target", value: 1 } },
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "all-players",
          condition: { kind: "heatAtLeast", who: "target", value: 1 },
        },
      ],
    },
    {
      /**
       * P2 rank-inverse. Holds a conditional reputation-gain slot; there is no
       * unconditional reputation gain of this size anywhere in either corner deck
       * after the re-cut.
       */
      id: "card.board-meeting.promotion-season",
      nameKey: "deadlineDash.card.boardMeetingPromotionSeason.name",
      displayName: "Promotion Season",
      flavorText: "The review cycle favoured the files with the most room left to move.",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "rankIndexAtMost", who: "target", index: 4 },
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "rankIndexAtLeast", who: "target", index: 5 },
        },
      ],
    },
    {
      /** P6 work-scaled. `cap` is an absolute ceiling on the final amount, not on the multiplier. */
      id: "card.board-meeting.record-profit-sharing",
      nameKey: "deadlineDash.card.boardMeetingRecordProfitSharing.name",
      displayName: "Record Profit Sharing",
      flavorText: "The year closed above forecast and the split followed logged output.",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 100,
          clampAtZero: true,
          target: "all-players",
          scale: { by: "work-counter", perUnit: 50, cap: 600 },
        },
      ],
    },
    {
      /** P7 split — the junior end of the table gets the pilot first. */
      id: "card.board-meeting.four-day-work-week-pilot",
      nameKey: "deadlineDash.card.boardMeetingFourDayWorkWeekPilot.name",
      displayName: "Four-Day Week Pilot",
      flavorText: "A trial schedule was posted, and the junior grades were rostered off first.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "lowest-rank",
        },
      ],
    },
    {
      /**
       * P9 actor-exempt — board-meeting aggression 1 of 3. AIMED: the drawer is
       * outside a cost every opponent pays, and gains on top, so it carries heat
       * on the actor. Flavor is in the drawer's agency rather than the passive
       * voice — there is an exception to this spend review and it is the person
       * who drew the card.
       */
      id: "card.board-meeting.cost-optimization",
      nameKey: "deadlineDash.card.boardMeetingCostOptimization.name",
      displayName: "Cost Optimization",
      flavorText: "You ran the spend review and left your own cost center out of scope.",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 200,
          insufficientFunds: "pay-up-to-available",
          target: "all-opponents",
        },
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** P3 derived subset — the freeze costs everyone and costs the leader double. */
      id: "card.board-meeting.hiring-freeze",
      nameKey: "deadlineDash.card.boardMeetingHiringFreeze.name",
      displayName: "Hiring Freeze",
      flavorText: "The open roles were closed and the backfill landed on the senior desks.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -2,
          clampAtZero: true,
          target: "highest-rank",
        },
      ],
    },
    {
      /**
       * P2 rank-inverse, and the sharpest one in the deck: the same policy is a
       * cost below the management line and a payment above it.
       */
      id: "card.board-meeting.mandatory-overtime",
      nameKey: "deadlineDash.card.boardMeetingMandatoryOvertime.name",
      displayName: "Mandatory Overtime",
      flavorText: "The hours were extended below the management line and billed above it.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -3,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "rankIndexAtMost", who: "target", index: 4 },
        },
        {
          type: "modifyResource",
          resource: "money",
          amount: 200,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "rankIndexAtLeast", who: "target", index: 5 },
        },
      ],
    },
    {
      /**
       * P6 work-scaled. Note the ordering question this raises, which the resolver
       * has to answer: the counter is incremented *before* the reputation effect
       * tests it, so a player sitting on exactly four is at five by the time the
       * guard runs and escapes the penalty. Authored in the order the re-cut plan
       * prints it. "Does a condition see the state before or after earlier effects
       * on the same card?" is unwritten, and this is the card that first needs it.
       */
      id: "card.board-meeting.new-kpi",
      nameKey: "deadlineDash.card.boardMeetingNewKpi.name",
      displayName: "New KPI Targets",
      flavorText: "Last year's targets became the baseline and thin records were marked down.",
      effects: [
        {
          type: "incrementWorkCounter",
          amount: 1,
          rewardEvery: 5,
          reward: { resource: "reputation", amount: 1 },
          cumulative: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "resourceAtMost", who: "target", resource: "work-counter", amount: 4 },
        },
      ],
    },
    {
      /** P3 derived subset — a flat permit for the lot and a premium band for the richest player. */
      id: "card.board-meeting.parking-fee",
      nameKey: "deadlineDash.card.boardMeetingParkingFee.name",
      displayName: "Parking Levy",
      flavorText: "The staff lot moved onto permits, with a premium band for the top spaces.",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 100,
          insufficientFunds: "pay-up-to-available",
          target: "all-players",
        },
        {
          type: "payResource",
          resource: "money",
          amount: 300,
          insufficientFunds: "pay-up-to-available",
          target: "richest",
        },
      ],
    },
    {
      /**
       * P9 actor-exempt — board-meeting aggression 2 of 3. AIMED. Deliberately not
       * a reskin of `cost-optimization`: it takes the same amount off the table but
       * pays the drawer more, and it grants no cover — the reputation that
       * `cost-saving-initiative` spends is simply absent here.
       */
      id: "card.board-meeting.budget-reallocation",
      nameKey: "deadlineDash.card.boardMeetingBudgetReallocation.name",
      displayName: "Budget Reallocation",
      flavorText: "You redirected every other allocation toward a priority you sponsored.",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 200,
          insufficientFunds: "pay-up-to-available",
          target: "all-opponents",
        },
        { type: "modifyResource", resource: "money", amount: 300, clampAtZero: true },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** P7 split — everyone loses the commute, the junior floors get part of it back. */
      id: "card.board-meeting.office-relocation",
      nameKey: "deadlineDash.card.boardMeetingOfficeRelocation.name",
      displayName: "Office Relocation",
      flavorText: "The site moved, and only the junior floors landed near the new transit stop.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -2,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "lowest-rank",
        },
      ],
    },
    {
      /**
       * P6 work-scaled. The compliance module costs a turn's energy and counts
       * toward the work milestone, which is the only reason it is not simply
       * another copy of table-wide energy loss.
       */
      id: "card.board-meeting.mandatory-training",
      nameKey: "deadlineDash.card.boardMeetingMandatoryTraining.name",
      displayName: "Mandatory Training",
      flavorText: "The compliance module was assigned to the roster and logged as billable.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "incrementWorkCounter",
          amount: 1,
          rewardEvery: 5,
          reward: { resource: "reputation", amount: 1 },
          cumulative: true,
          target: "all-players",
        },
      ],
    },
    {
      /** P6 work-scaled — a reporting penalty that only bites the players with nothing logged. */
      id: "card.board-meeting.monthly-reporting",
      nameKey: "deadlineDash.card.boardMeetingMonthlyReporting.name",
      displayName: "Monthly Reporting",
      flavorText: "The recurring report exposed whoever had the least to put in it.",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "resourceAtMost", who: "target", resource: "work-counter", amount: 6 },
        },
      ],
    },
    {
      /**
       * P9 actor-exempt — board-meeting aggression 3 of 3. AIMED, and the only
       * corner card that *takes* rather than merely exempting: `transferResource`
       * `target-to-actor` with `perTarget`, so it scales with the table size the
       * way a fixed self-gain would not. The reputation cost is the drawer's own,
       * and is what distinguishes this from the other two P9 cards.
       */
      id: "card.board-meeting.cost-saving-initiative",
      nameKey: "deadlineDash.card.boardMeetingCostSavingInitiative.name",
      displayName: "Cost Saving Initiative",
      flavorText: "You booked the savings from every other desk and signed the memo yourself.",
      effects: [
        {
          type: "transferResource",
          resource: "money",
          amount: 100,
          direction: "target-to-actor",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "all-opponents",
        },
        { type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** P2 rank-inverse, with a wider gap than the others: nothing happens to the middle of the table. */
      id: "card.board-meeting.ai-transformation",
      nameKey: "deadlineDash.card.boardMeetingAiTransformation.name",
      displayName: "AI Transformation",
      flavorText: "The migration landed on the junior desks and the savings landed upstairs.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -2,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "rankIndexAtMost", who: "target", index: 3 },
        },
        {
          type: "modifyResource",
          resource: "money",
          amount: 200,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "rankIndexAtLeast", who: "target", index: 6 },
        },
      ],
    },
    {
      /** P3 derived subset — the leader carries both reporting lines. */
      id: "card.board-meeting.matrix-organization",
      nameKey: "deadlineDash.card.boardMeetingMatrixOrganization.name",
      displayName: "Matrix Organization",
      flavorText: "Reporting lines were duplicated, and the top of the chart carried both.",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "highest-rank",
        },
      ],
    },
    {
      /** P4 heat-gated — the flagged names take the policy twice over. */
      id: "card.board-meeting.return-to-office",
      nameKey: "deadlineDash.card.boardMeetingReturnToOffice.name",
      displayName: "Return to Office",
      flavorText: "Attendance was reinstated, and the flagged names were checked at the door.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -2,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "heatAtLeast", who: "target", value: 1 },
        },
      ],
    },
    {
      /** P7 split — calibration is a zero-sum curve, which is the one thing the shipped copy never showed. */
      id: "card.board-meeting.performance-calibration",
      nameKey: "deadlineDash.card.boardMeetingPerformanceCalibration.name",
      displayName: "Performance Calibration",
      flavorText: "Ratings were normalized down from the top and up from the bottom.",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -2,
          clampAtZero: true,
          target: "highest-rank",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "lowest-rank",
        },
      ],
    },
    {
      /** P1 rank-scaled — the sign-off costs a fixed hour and a rank-priced fee. */
      id: "card.board-meeting.approval-workflow",
      nameKey: "deadlineDash.card.boardMeetingApprovalWorkflow.name",
      displayName: "Approval Workflow",
      flavorText: "An extra sign-off stage was inserted, priced by the grade that signs it.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "payResource",
          resource: "money",
          amount: 100,
          insufficientFunds: "pay-up-to-available",
          target: "all-players",
          scale: { by: "rank-tier", perUnit: 100 },
        },
      ],
    },
    {
      /**
       * P3 derived subset, and the only card in either corner deck that touches
       * exactly one player. It is *not* aimed under the corner reading: the drawer
       * may be the highest-ranked player, in which case they are the one paying,
       * so nobody chose a victim and no heat is charged.
       */
      id: "card.board-meeting.executive-offsite",
      nameKey: "deadlineDash.card.boardMeetingExecutiveOffsite.name",
      displayName: "Executive Offsite",
      flavorText: "Leadership convened offsite, expensed it, and came back better connected.",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 400,
          insufficientFunds: "pay-up-to-available",
          target: "highest-rank",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "highest-rank",
        },
      ],
    },
  ],
} as const satisfies DeckConfig;
