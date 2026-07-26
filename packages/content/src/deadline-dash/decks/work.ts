import type { DeckConfig } from "../../schema/decks";

/**
 * `deck.work` — the tile-draw deck for "work" spaces, and by a wide margin the
 * most frequently drawn deck on the board (14 of the 26 drawing tiles, i.e. 54 %
 * of every draw in `mode.standard`).
 *
 * Append new cards to `workDeck.cards`. The authoring and display-copy rules
 * that bind every card in this pack live in the docstring of `./index.ts`; read
 * them before adding a row here.
 *
 * ## What this file holds
 *
 * **47 card definitions / 55 physical cards** (`copies` expands eight of them):
 * the 6 cards that shipped before the gameplay-v2 vocabulary landed, plus the 41
 * transcribed from the design workbook's `05_Work_Cards` sheet and re-cut
 * against `plans/24-gameplay-v2-spec.md` §10.1–§10.6.
 *
 * The re-cut's headline for this deck:
 *
 * | | before | after |
 * | --- | --- | --- |
 * | definitions | 41 authored + 6 shipped | **47** (−1 cut, +1 unblocked) |
 * | cards that touch another player | 0 | **7** (6 aimed + 1 benign) |
 * | aimed cards carrying `modifyHeat` | 0 | **6** |
 * | unconditional `reputation +2` | 6 | **0** |
 * | `reputation +3` | 1 | **0** |
 *
 * Before this pass `deck.work` contained no interaction at all, which is what
 * made the default mode draw two thirds of its cards from decks nobody could act
 * through. The six aimed cards below are this deck's entire share of that fix,
 * and §5.1's rule is applied strictly: **heat is the price of choosing.** An
 * effect the drawer aimed carries `modifyHeat` on the actor; an effect at a fixed
 * relation the drawer did not pick (`card.work.knowledge-sharing`, a gift to the
 * left-hand neighbour) carries none, because over-charging heat is as much a
 * defect as under-charging it.
 *
 * ## Conventions held constant across the deck
 *
 * - money gain → `modifyResource`, `clampAtZero: true`.
 * - money loss → `payResource` / `insufficientFunds: "pay-up-to-available"`, so a
 *   player who cannot cover it pays what they have rather than going negative.
 * - reputation → `modifyResource`, `clampAtZero: true` (reputation has no
 *   maximum).
 * - energy gain → `modifyResource` with `clampAtZero` **and** `clampAtMaximum`.
 *   Energy is the only resource `create-game.ts` gives a `maximum` and the engine
 *   honours that ceiling only when the flag is set.
 * - every `applyStatus` authors `polarity` and `sourceDeckId` explicitly, so the
 *   two `removeStatuses` cards below have complete provenance to filter on rather
 *   than a half-populated trail.
 *
 * ## Two translations made while merging, both recorded rather than silent
 *
 * 1. The re-cut plan sketched `condition` as `{metric, comparison, value}`. The
 *    shipped schema's `EffectCondition` is the closed `kind`-based grammar the
 *    engine's `effects-v2/conditions.ts` actually evaluates, and anything else
 *    fails closed — an authored guard in the sketched shape would silently never
 *    fire. `?workCounterAtLeast(n)` is therefore
 *    `{ kind: "resourceAtLeast", who: "target", resource: "work-counter", … }`.
 * 2. That grammar has `heatAtLeast` and no `heatAtMost`, so
 *    `card.work.company-recognition`'s `?heatAtMost(0)` is written as
 *    `not(heatAtLeast(1))`. Heat is an integer everywhere it is written
 *    (`heatPerAttack` is validated `integer`, decay floors, the value clamps at
 *    zero), so the two are the same predicate rather than an approximation.
 */
export const workDeck = {
  id: "deck.work",
  cards: [
    /* ---------------------------------------------------------------------- */
    /* Shipped before the v2 vocabulary. Order preserved.                      */
    /* ---------------------------------------------------------------------- */
    {
      // §9 KEEP.
      id: "card.work.overtime-bonus",
      nameKey: "deadlineDash.card.workOvertimeBonus.name",
      displayName: "Overtime Authorized",
      flavorText: "Payroll processed the extra hours without comment.",
      effects: [{ type: "modifyResource", resource: "money", amount: 150, clampAtZero: true }],
    },
    {
      // §9 KEEP · holds the pack-wide `energy -1` slot 3 of 3.
      id: "card.work.printer-jam",
      nameKey: "deadlineDash.card.workPrinterJam.name",
      displayName: "Printer Jam",
      flavorText: "Facilities logged the fault; you cleared the tray yourself.",
      effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
    },
    {
      // §9 DIFFERENTIATE (G-conversion) · was a bare `reputation +1`, which the
      // pack already holds three times over. The work-counter tick is the
      // conversion: mentoring is recorded as delivery, not only as regard.
      // Flavor re-read and kept — it still describes the new mechanic.
      id: "card.work.mentorship",
      nameKey: "deadlineDash.card.workMentorship.name",
      displayName: "Mentorship Assignment",
      flavorText: "You were named onboarding contact for the new hire.",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        {
          type: "incrementWorkCounter",
          amount: 1,
          rewardEvery: 5,
          reward: { resource: "reputation", amount: 1 },
          cumulative: true,
        },
      ],
    },
    {
      // §9 KEEP · holds the pack-wide `pay money 100` slot 1 of 3.
      id: "card.work.expense-report-rejected",
      nameKey: "deadlineDash.card.workExpenseReportRejected.name",
      displayName: "Expense Report Rejected",
      flavorText: "Finance declined the receipt; the cost stays with you.",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 100,
          insufficientFunds: "pay-up-to-available",
        },
      ],
    },
    {
      // §9 KEEP · its `restoreResourceToMaximum` stops being a no-op the moment
      // the energy ceiling rises above starting energy (§7, a separate wave).
      id: "card.work.free-coffee",
      nameKey: "deadlineDash.card.workFreeCoffee.name",
      displayName: "Pantry Coffee Restocked",
      flavorText: "The machine was serviced this morning and the pot is full.",
      effects: [{ type: "restoreResourceToMaximum", resource: "energy" }],
    },
    {
      // §9 KEEP.
      id: "card.work.crunch-time",
      nameKey: "deadlineDash.card.workCrunchTime.name",
      displayName: "Crunch Window",
      flavorText: "Shipped on schedule, with overtime paid and no time in lieu.",
      effects: [
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
        { type: "modifyResource", resource: "energy", amount: -2, clampAtZero: true },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Workbook `05_Work_Cards`, rows 2–51, in sheet order. Row 11             */
    /* (`card.work.team-appreciation`) is CUT by §9 as interchangeable with     */
    /* `card.work.quality-work`; row 49 is new, unblocked by `removeStatuses`.  */
    /* ---------------------------------------------------------------------- */
    {
      // row 2–5 · §9 KEEP · the deck's most common card by design.
      id: "card.work.complete-daily-task",
      nameKey: "deadlineDash.card.workCompleteDailyTask.name",
      displayName: "Complete Daily Task",
      flavorText: "The day's task list closed out with nothing carried over.",
      copies: 4,
      effects: [{ type: "modifyResource", resource: "money", amount: 100, clampAtZero: true }],
    },
    {
      // row 6–7 · §9 DIFFERENTIATE (E-scaling) · was a bare money +200, i.e.
      // `Fast Delivery` with a different title. The work counter is engine-live
      // and no card in the pack touched it before the re-cut.
      id: "card.work.project-milestone",
      nameKey: "deadlineDash.card.workProjectMilestone.name",
      displayName: "Project Milestone",
      flavorText: "The milestone was marked complete in the project tracker.",
      copies: 2,
      effects: [
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
        {
          type: "incrementWorkCounter",
          amount: 1,
          rewardEvery: 5,
          reward: { resource: "reputation", amount: 1 },
          cumulative: true,
        },
      ],
    },
    {
      // row 8 · §9 DIFFERENTIATE (F-choice) · was a second bare money +200.
      id: "card.work.fast-delivery",
      nameKey: "deadlineDash.card.workFastDelivery.name",
      displayName: "Fast Delivery",
      flavorText: "The delivery slot remains unbooked pending your confirmation.",
      effects: [
        {
          type: "chooseOne",
          options: [
            {
              id: "fast",
              label: "Deliver today",
              effects: [
                { type: "modifyResource", resource: "money", amount: 250, clampAtZero: true },
              ],
            },
            {
              id: "careful",
              label: "Hold for review",
              effects: [
                {
                  type: "modifyResource",
                  resource: "energy",
                  amount: 2,
                  clampAtZero: true,
                  clampAtMaximum: true,
                },
                {
                  type: "incrementWorkCounter",
                  amount: 1,
                  rewardEvery: 5,
                  reward: { resource: "reputation", amount: 1 },
                  cumulative: true,
                },
              ],
            },
          ],
        },
      ],
    },
    {
      // row 9–10 · §9 KEEP · holds the pack-wide plain `reputation +1` slot 1 of
      // 3. Nothing else in this deck may take a bare reputation +1 — see the
      // deviation note on `card.work.recognition-letter`.
      id: "card.work.quality-work",
      nameKey: "deadlineDash.card.workQualityWork.name",
      displayName: "Quality Work",
      flavorText: "QA returned the build with no revisions requested.",
      copies: 2,
      effects: [{ type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
    },
    {
      // row 12 · §9 DIFFERENTIATE (G-conversion) · was one of the twenty
      // unconditional `reputation +2` cards the deduplication ruling names. Half
      // the reputation converts to money so it stops being interchangeable.
      id: "card.work.client-compliment",
      nameKey: "deadlineDash.card.workClientCompliment.name",
      displayName: "Client Compliment",
      flavorText: "The client thanked you in writing and settled the invoice early.",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "modifyResource", resource: "money", amount: 100, clampAtZero: true },
      ],
    },
    {
      // row 13 · §9 DIFFERENTIATE (A-condition) · conditional `reputation +2`,
      // slot 1 of the 12 the reputation ruling allows pack-wide. `who: "target"`
      // is the default reading — the guard tests whoever the effect lands on,
      // which here is the drawer.
      id: "card.work.positive-performance-review",
      nameKey: "deadlineDash.card.workPositivePerformanceReview.name",
      displayName: "Positive Performance Review",
      flavorText: "The review panel read your delivery record before writing it up.",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
          clampAtZero: true,
          condition: {
            kind: "resourceAtLeast",
            who: "target",
            resource: "work-counter",
            amount: 5,
          },
        },
      ],
    },
    {
      // row 14 · §9 KEEP · holds the pack-wide `money +100 | reputation +1` slot
      // 1 of 3. `client-compliment` above is the reverse ordering and a distinct
      // signature; that is the whole of the difference between them and it is
      // thinner than any other pair in this deck.
      id: "card.work.process-improvement",
      nameKey: "deadlineDash.card.workProcessImprovement.name",
      displayName: "Process Improvement",
      flavorText: "The workflow you rewrote replaced the documented one.",
      effects: [
        { type: "modifyResource", resource: "money", amount: 100, clampAtZero: true },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      // row 15 · §9 DIFFERENTIATE (B-target) · **unaimed pressure, deliberately
      // heat-free.** The target is a fixed relation the drawer did not choose,
      // and it is a gift. Charging heat here would price a benign effect as an
      // attack, which is exactly the failure mode §5.1 draws a line around.
      id: "card.work.knowledge-sharing",
      nameKey: "deadlineDash.card.workKnowledgeSharing.name",
      displayName: "Knowledge Sharing",
      flavorText: "You unblocked another team member and logged the handover.",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "left-neighbour",
        },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      // row 16 · §9 ADD-AGGRESSION (B-target) · aimed slot 6 of 6.
      // Energy is worth stealing only once the ceiling rises above starting
      // energy; before that a rested victim loses nothing they will miss.
      id: "card.work.cross-team-collaboration",
      nameKey: "deadlineDash.card.workCrossTeamCollaboration.name",
      displayName: "Cross-Team Collaboration",
      flavorText: "You named a colleague to the delivery and billed their hours.",
      effects: [
        {
          type: "transferResource",
          resource: "energy",
          amount: 1,
          direction: "target-to-actor",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyResource", resource: "money", amount: 100, clampAtZero: true },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 17 · §9 DIFFERENTIATE (E-scaling) · was a bare money +300, identical
      // to `Performance Bonus`. Also the one card that answers the deck's
      // mid-game problem: work-card money was flat while salary runs 200/lap at
      // Intern to 2000/lap at Director, so the whole deck expired as a money
      // source by the midpoint.
      id: "card.work.innovation-idea",
      nameKey: "deadlineDash.card.workInnovationIdea.name",
      displayName: "Innovation Idea",
      flavorText: "The proposal shipped under your name and at your pay band.",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 150,
          clampAtZero: true,
          scale: { by: "rank-tier", perUnit: 150 },
        },
      ],
    },
    {
      // row 18 · §9 KEEP · holds the pack-wide `money +300` slot 1 of 3.
      id: "card.work.performance-bonus",
      nameKey: "deadlineDash.card.workPerformanceBonus.name",
      displayName: "Performance Bonus",
      flavorText: "The monthly performance cycle resolved in your favor.",
      effects: [{ type: "modifyResource", resource: "money", amount: 300, clampAtZero: true }],
    },
    {
      // row 19 · §9 DIFFERENTIATE (E-scaling) · was an unconditional
      // reputation +2. The double work-counter step is what the widened
      // `incrementWorkCounter.amount` exists for.
      id: "card.work.kpi-achieved",
      nameKey: "deadlineDash.card.workKpiAchieved.name",
      displayName: "KPI Achieved",
      flavorText: "Every indicator on your scorecard reported green this month.",
      effects: [
        {
          type: "incrementWorkCounter",
          amount: 2,
          rewardEvery: 5,
          reward: { resource: "reputation", amount: 1 },
          cumulative: true,
        },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      // row 20 · §9 DIFFERENTIATE (D-tradeoff) · was an unconditional
      // reputation +2. **Heat relief, not aggression** — one of only six cards in
      // the pack that lower heat and the only one that does it for free. Before
      // the re-cut heat was a one-way ratchet and therefore not a decision.
      id: "card.work.employee-spotlight",
      nameKey: "deadlineDash.card.workEmployeeSpotlight.name",
      displayName: "Employee Spotlight",
      flavorText: "The internal newsletter ran your work and the queries stopped.",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "modifyHeat", amount: -1, target: "self" },
      ],
    },
    {
      // row 21 · §9 KEEP · holds the pack-wide `money +500` slot 1 of 3.
      id: "card.work.spot-bonus",
      nameKey: "deadlineDash.card.workSpotBonus.name",
      displayName: "Spot Bonus",
      flavorText: "Your manager filed a discretionary award outside the pay cycle.",
      effects: [{ type: "modifyResource", resource: "money", amount: 500, clampAtZero: true }],
    },
    {
      // row 22 · §9 KEEP · holds the pack-wide `energy +1` slot 1 of 3.
      id: "card.work.coffee-break",
      nameKey: "deadlineDash.card.workCoffeeBreak.name",
      displayName: "Coffee Break",
      flavorText: "You took the break the calendar had already blocked out.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
        },
      ],
    },
    {
      // row 23 · §9 KEEP · holds the pack-wide `energy +2` slot 1 of 3 — and see
      // the hazard note on `card.work.coffee-voucher`, which used to take a
      // second one.
      id: "card.work.lunch-break",
      nameKey: "deadlineDash.card.workLunchBreak.name",
      displayName: "Lunch Break",
      flavorText: "A full hour away from the desk, taken as scheduled.",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
        },
      ],
    },
    {
      // row 24 · §9 DIFFERENTIATE (C-timing) · was a third `energy +1`, i.e. a
      // re-skin of `Coffee Break`. `status.next-roll-extra-movement` is already
      // consumed end to end by `roll-turn.ts`, so this needs no engine work at
      // all — the cheapest real differentiation available in the deck.
      id: "card.work.efficient-workflow",
      nameKey: "deadlineDash.card.workEfficientWorkflow.name",
      displayName: "Efficient Workflow",
      flavorText: "You cleared the queue early and the next route is already planned.",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-roll-extra-movement",
          duration: { kind: "uses", count: 1 },
          parameters: { spaces: 2 },
          polarity: "positive",
          sourceDeckId: "deck.work",
        },
      ],
    },
    {
      // row 25 · §9 KEEP · holds the pack-wide `reputation +1 | energy +1`
      // slot 1 of 3.
      id: "card.work.mentoring-session",
      nameKey: "deadlineDash.card.workMentoringSession.name",
      displayName: "Mentoring Session",
      flavorText: "A senior colleague walked you through their approach.",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
        },
      ],
    },
    {
      // row 26 · §9 DIFFERENTIATE (G-conversion) · another of the unconditional
      // `reputation +2` cluster. Converts at a higher money rate than
      // `client-compliment` because the workbook tiers it Rare, not Uncommon.
      id: "card.work.successful-presentation",
      nameKey: "deadlineDash.card.workSuccessfulPresentation.name",
      displayName: "Successful Presentation",
      flavorText: "The room approved the deck and released the budget line.",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
      ],
    },
    {
      // row 27 · §9 KEEP · workbook `Notes: Risk/Reward`.
      id: "card.work.overtime-pay",
      nameKey: "deadlineDash.card.workOvertimePay.name",
      displayName: "Overtime Pay",
      flavorText: "The extra hours were logged, approved, and paid at rate.",
      effects: [
        { type: "modifyResource", resource: "money", amount: 300, clampAtZero: true },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
      ],
    },
    {
      // row 28 · §9 KEEP.
      id: "card.work.weekend-support",
      nameKey: "deadlineDash.card.workWeekendSupport.name",
      displayName: "Weekend Support",
      flavorText: "You covered the weekend rota and claimed it back as pay.",
      effects: [
        { type: "modifyResource", resource: "money", amount: 500, clampAtZero: true },
        { type: "modifyResource", resource: "energy", amount: -2, clampAtZero: true },
      ],
    },
    {
      // row 29 · §9 ADD-AGGRESSION (B-target) · aimed slot 1 of 6.
      // The drawer still eats the smaller half, so this is a shared cost the
      // drawer *aims* — which is why it pays heat rather than reading as unaimed
      // pressure.
      id: "card.work.workload-spike",
      nameKey: "deadlineDash.card.workWorkloadSpike.name",
      displayName: "Workload Spike",
      flavorText: "You pushed the overflow onto a colleague and kept the rest.",
      effects: [
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -2,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 30 · §9 ADD-AGGRESSION (B-target) · aimed slot 2 of 6.
      // The work-counter tick is what separates this from `Workload Spike`; §9
      // calls it out explicitly, because without it the two are the same card
      // with two titles and the re-cut would have moved the duplication rather
      // than removed it.
      id: "card.work.tight-deadline",
      nameKey: "deadlineDash.card.workTightDeadline.name",
      displayName: "Tight Deadline",
      flavorText: "You brought the date forward and named who would absorb it.",
      effects: [
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
        {
          type: "incrementWorkCounter",
          amount: 1,
          rewardEvery: 5,
          reward: { resource: "reputation", amount: 1 },
          cumulative: true,
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -2,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 31 · §9 KEEP · holds the pack-wide plain `reputation -1` slot 1 of 3.
      id: "card.work.minor-mistake",
      nameKey: "deadlineDash.card.workMinorMistake.name",
      displayName: "Minor Mistake",
      flavorText: "A small error was found in review and attributed to you.",
      effects: [{ type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true }],
    },
    {
      // row 32 · §9 ADD-AGGRESSION (B-target) · aimed slot 3 of 6.
      // The card's own fiction was always aimed — the workbook's `Rework
      // Required` is somebody sending *your* work back — and the first pass
      // mis-authored it as self-inflicted.
      //
      // The status's `polarity: "negative"` is load-bearing: this is the only
      // hostile status `deck.work` applies, so it is the only thing
      // `time-management-course` and `employee-assistance-program` can remove.
      // The card's own `polarity` records what the drawer gets out of it
      // directly, which is nothing but the heat.
      id: "card.work.rework-required",
      nameKey: "deadlineDash.card.workReworkRequired.name",
      displayName: "Rework Required",
      flavorText: "You returned their work for revision before it could be counted.",
      polarity: "negative",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-work-card-money-multiplier",
          duration: { kind: "uses", count: 1 },
          parameters: { multiplier: 0 },
          polarity: "negative",
          sourceDeckId: "deck.work",
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 33 · §9 ADD-AGGRESSION (B-target) · aimed slot 5 of 6.
      // The fine drops from 200 to 100 because the card now also costs a victim
      // a reputation point; the shipped `expense-report-rejected` keeps the bare
      // `pay money 100` signature slot and this three-effect card does not
      // compete for it.
      id: "card.work.missed-deadline",
      nameKey: "deadlineDash.card.workMissedDeadline.name",
      displayName: "Missed Deadline",
      flavorText: "The date passed, and your note named who had held the work up.",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 100,
          insufficientFunds: "pay-up-to-available",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 34 · §9 KEEP · the surviving half of the burnout duplicate pair;
      // `card.event.burnout` is the one that goes, so this id must not move.
      id: "card.work.burnout",
      nameKey: "deadlineDash.card.workBurnout.name",
      displayName: "Burnout",
      flavorText: "The month's accumulated hours have caught up with you.",
      effects: [{ type: "modifyResource", resource: "energy", amount: -3, clampAtZero: true }],
    },
    {
      // row 35 · §9 ADD-AGGRESSION (B-target) · aimed slot 4 of 6.
      // `displayName` changes to "Concern Escalated" per §9 — the workbook's
      // "Performance Warning" describes something happening *to* the drawer and
      // the card no longer does that. `id` and `nameKey` are unchanged.
      id: "card.work.performance-warning",
      nameKey: "deadlineDash.card.workPerformanceWarning.name",
      displayName: "Concern Escalated",
      flavorText: "You raised a concern about a colleague and it went on their file.",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -2,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 36 · §9 DIFFERENTIATE (A-condition) · conditional `reputation +2`,
      // slot 2 of 12. The guard sits on the reputation line only; the money is
      // unconditional, which makes this a reward for a long record rather than
      // an all-or-nothing draw.
      id: "card.work.outstanding-achievement",
      nameKey: "deadlineDash.card.workOutstandingAchievement.name",
      displayName: "Outstanding Achievement",
      flavorText: "The department review cited your record across the whole cycle.",
      effects: [
        { type: "modifyResource", resource: "money", amount: 300, clampAtZero: true },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
          clampAtZero: true,
          condition: {
            kind: "resourceAtLeast",
            who: "target",
            resource: "work-counter",
            amount: 10,
          },
        },
      ],
    },
    {
      // row 37 · §9 DIFFERENTIATE (A-condition) · conditional `reputation +2`,
      // slot 3 of 12, and the removal of the pack's last `reputation +3` from
      // this deck. Gating the deck's largest reputation award on a clean record
      // is the one place `deck.work` gives heat a *positive* consequence, which
      // is what stops heat reading as a score to maximise.
      //
      // `?heatAtMost(0)` is written as `not(heatAtLeast(1))`: the engine's
      // condition grammar has no `heatAtMost` clause and heat is an integer, so
      // these are the same predicate. See the file docstring.
      id: "card.work.company-recognition",
      nameKey: "deadlineDash.card.workCompanyRecognition.name",
      displayName: "Company Recognition",
      flavorText: "Management named you in an announcement, with no open queries.",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
          clampAtZero: true,
          condition: {
            kind: "not",
            of: { kind: "heatAtLeast", who: "target", value: 1 },
          },
        },
      ],
    },
    {
      // row 38 · §9 KEEP · `copies: 1` is written explicitly rather than
      // defaulted: this and `card.event.jackpot` are the pack's two Legendaries
      // and the rarity curve should be visible to a later reader.
      id: "card.work.annual-bonus",
      nameKey: "deadlineDash.card.workAnnualBonus.name",
      displayName: "Annual Bonus",
      flavorText: "The annual incentive cleared with your name on the schedule.",
      copies: 1,
      effects: [{ type: "modifyResource", resource: "money", amount: 800, clampAtZero: true }],
    },
    {
      // row 39–40 · §9 KEEP · Consumable / Stored.
      // Deliberately **not** `grantImmunity`, even though that now has a declared
      // shape: immunity blocks *preventable effects targeting this player*, and
      // the money loss this cancels is self-inflicted — a card you drew or a tile
      // you landed on.
      id: "card.work.expense-claim",
      nameKey: "deadlineDash.card.workExpenseClaim.name",
      displayName: "Expense Claim",
      flavorText: "Filed, stamped, and held against a cost you have not incurred.",
      copies: 2,
      timing: "stored",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.cancel-next-money-loss",
          duration: { kind: "uses", count: 1 },
          polarity: "positive",
          sourceDeckId: "deck.work",
        },
      ],
    },
    {
      // row 41–42 · §9 KEEP, then differentiated by the signature audit.
      //
      // As transcribed, this card's effects were byte-identical to
      // `card.work.lunch-break`, and counting `card.event.chocolate-bar` and
      // `card.networking.free-buffet` the bare `energy +2` signature stood at
      // four pack-wide against a cap of three — a real quota violation, not a
      // theoretical one. Teaching the signature checker about card-level
      // `timing` was rejected as a remedy: changing the measurement makes the
      // re-cut's numbers incomparable to the audit that mandated it.
      //
      // The branch is also the deck's direct answer to the energy-ceiling
      // hazard — it lets a rested player take the cash instead — and `money
      // +150` is a signature no other card in the pack holds.
      id: "card.work.coffee-voucher",
      nameKey: "deadlineDash.card.workCoffeeVoucher.name",
      displayName: "Pantry Voucher",
      flavorText: "Issued by the pantry; the counter and expenses both accept it.",
      copies: 2,
      timing: "stored",
      effects: [
        {
          type: "chooseOne",
          options: [
            {
              id: "redeem",
              label: "Redeem at the counter",
              effects: [
                {
                  type: "modifyResource",
                  resource: "energy",
                  amount: 2,
                  clampAtZero: true,
                  clampAtMaximum: true,
                },
              ],
            },
            {
              id: "expense",
              label: "Claim it against expenses",
              effects: [
                { type: "modifyResource", resource: "money", amount: 150, clampAtZero: true },
              ],
            },
          ],
        },
      ],
    },
    {
      // row 43–44 · §9 DIFFERENTIATE (G-conversion) · drops the flat
      // reputation +2.
      //
      // **Deviation from §9, recorded.** §9 prints the replacement as a bare
      // `M(rep,+1)`, but the deduplication ruling names the three cards that hold
      // the pack-wide plain `reputation +1` signature — `quality-work`,
      // `meeting.productive-meeting`, `networking.elevator-pitch` — and this is
      // not one of them. Authoring §9 literally makes a fourth and puts the
      // signature checker over quota, which the execution checks require to
      // report zero. The second effect keeps §9's stated axis (recognition
      // banked and cashed as pay) and the card's hold-for-the-right-moment
      // character.
      id: "card.work.recognition-letter",
      nameKey: "deadlineDash.card.workRecognitionLetter.name",
      displayName: "Recognition Letter",
      flavorText: "Signed by your manager and undated, to be filed when it counts.",
      copies: 2,
      timing: "stored",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        {
          type: "applyStatus",
          statusId: "status.next-salary-multiplier",
          duration: { kind: "uses", count: 1 },
          parameters: { multiplier: 2 },
          polarity: "positive",
          sourceDeckId: "deck.work",
        },
      ],
    },
    {
      // row 45 · §9 KEEP · Consumable / Next Work. Shares its status with
      // `rework-required`, which is the same status at multiplier zero.
      id: "card.work.project-template",
      nameKey: "deadlineDash.card.workProjectTemplate.name",
      displayName: "Project Template",
      flavorText: "A prior delivery, kept in a folder and ready to be renamed.",
      timing: "stored",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-work-card-money-multiplier",
          duration: { kind: "uses", count: 1 },
          parameters: { multiplier: 2 },
          polarity: "positive",
          sourceDeckId: "deck.work",
        },
      ],
    },
    {
      // row 46 · §9 KEEP · Consumable / Next Work.
      id: "card.work.performance-report",
      nameKey: "deadlineDash.card.workPerformanceReport.name",
      displayName: "Performance Report",
      flavorText: "Your own figures, formatted for whoever asks for them next.",
      timing: "stored",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-work-card-reputation-multiplier",
          duration: { kind: "uses", count: 1 },
          parameters: { multiplier: 2 },
          polarity: "positive",
          sourceDeckId: "deck.work",
        },
      ],
    },
    {
      // row 47 · §9 KEEP · Consumable / Next Work. The cheapest card in the
      // stored group by a wide margin: `status.ignore-next-work-energy` is
      // already consumed end to end by `player-status.ts` and
      // `resolve-tile-effects.ts`.
      id: "card.work.productivity-toolkit",
      nameKey: "deadlineDash.card.workProductivityToolkit.name",
      displayName: "Productivity Toolkit",
      flavorText: "Scripts and shortcuts collected over a quarter of this work.",
      timing: "stored",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.ignore-next-work-energy",
          duration: { kind: "uses", count: 1 },
          polarity: "positive",
          sourceDeckId: "deck.work",
        },
      ],
    },
    {
      // row 48 · §9 DIFFERENTIATE (C-timing) · was `energy +1, reputation +1`, a
      // re-skin of `Mentoring Session` with a `stored` tag. First consumer of
      // `removeStatuses` anywhere in the pack.
      id: "card.work.time-management-course",
      nameKey: "deadlineDash.card.workTimeManagementCourse.name",
      displayName: "Time Management Course",
      flavorText: "Logged as completed, and an open remediation was closed alongside it.",
      timing: "stored",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
        },
        {
          type: "removeStatuses",
          filter: { polarity: "negative", sourceDeckId: "deck.work" },
          limit: 1,
        },
      ],
    },
    {
      // row 49 · **NEW** · the one workbook row the transcription left
      // unauthored, unblocked by `removeStatuses` plus status provenance.
      // Workbook: "Remove all negative Work card effects currently affecting
      // you." No `limit`: it removes every match, which is the whole difference
      // between it and `time-management-course` above.
      //
      // Source conflict, recorded: the GDD tags this card `[REACTION]`, the
      // workbook's `Duration` cell says `Stored`. The workbook wins — which
      // matters, because `reaction` timing additionally requires
      // `interaction.reactionWindows` while `stored` requires only
      // `agency.handEnabled`.
      id: "card.work.employee-assistance-program",
      nameKey: "deadlineDash.card.workEmployeeAssistanceProgram.name",
      displayName: "Employee Assistance Program",
      flavorText: "The internal program took the case and closed every open item.",
      timing: "stored",
      effects: [
        {
          type: "removeStatuses",
          filter: { polarity: "negative", sourceDeckId: "deck.work" },
        },
      ],
    },
    {
      // row 50 · §9 KEEP · Very Rare / Next Promotion. The consumer is small:
      // `resolvePromotion` already applies Office Politician's
      // `modifyPromotionRequirement`, so this reads the same seam from a status.
      id: "card.work.promotion-portfolio",
      nameKey: "deadlineDash.card.workPromotionPortfolio.name",
      displayName: "Promotion Portfolio",
      flavorText: "Every delivery you have shipped, collated ahead of the panel.",
      timing: "stored",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-promotion-reputation-discount",
          duration: { kind: "uses", count: 1 },
          parameters: { reputation: 1 },
          polarity: "positive",
          sourceDeckId: "deck.work",
        },
      ],
    },
    {
      // row 51 · §9 KEEP · Rare / Stored.
      id: "card.work.excellence-certificate",
      nameKey: "deadlineDash.card.workExcellenceCertificate.name",
      displayName: "Excellence Certificate",
      flavorText: "Awarded at the department review and kept for later use.",
      timing: "stored",
      effects: [
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
  ],
} as const satisfies DeckConfig;
