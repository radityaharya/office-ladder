import type { DeckConfig } from "../../schema/decks";

/**
 * `deck.meeting` — the tile-draw deck for "meeting" spaces, and one half of the
 * Clock Deck (`clockDeck` in `../modes.ts`).
 *
 * Transcribed from the design workbook sheet `06_Meeting_Cards`, then re-cut per
 * the card re-cut plan's §9 — which executes `plans/24-gameplay-v2-spec.md`
 * §10.5's resolutions and §10.6's design mandates. Forty-eight designs: the five
 * that shipped before the re-cut (two of them re-cut in place), twenty-one that
 * only ever needed v1 vocabulary, and twenty-two that needed the v2 vocabulary
 * in `../../schema/effects.ts` and could not be typed at all before it landed.
 *
 * Three things about this deck are deliberate and are not to be "tidied":
 *
 *  - **Six cards are aimed** — `tough-questions`, `proposal-rejected`,
 *    `budget-cut`, `miscommunication`, `executive-alignment`, `town-hall`. Before
 *    the re-cut this deck had none, which meant the default mode drew most of its
 *    cards from decks with no interaction in them. Every aimed effect carries a
 *    `modifyHeat` on the *actor* with an explicit `target: "self"`; unaimed
 *    pressure (a fixed-relation neighbour, a cost the drawer eats too) carries
 *    none, because heat is the price of *choosing* a victim.
 *  - **No card grants an unconditional `reputation +2`.** Where the workbook had
 *    one, it is now conditional, paid for on the same card, or inside a
 *    `chooseOne`.
 *  - **`reschedule` and `decision-deferred` do nothing on purpose.** They exist to
 *    burn a Clock Deck card, which is the only producer the deck-depletion win
 *    condition can ever have. `noEffect` is a declared verb precisely so an empty
 *    `effects` array stays an authoring mistake.
 *
 * Append new cards to `meetingDeck.cards`. The authoring and display-copy rules
 * that bind every card in this pack live in the docstring of `./index.ts`; read
 * them before adding a row here. In short: `flavorText` is one line an office
 * system would have logged, it never restates the card's numbers, and
 * `displayName`/`flavorText` are unique **pack-wide**, not per-deck.
 */
export const meetingDeck = {
  id: "deck.meeting",
  cards: [
    /* ---------------------------------------------------------------------- */
    /* Shipped before the re-cut. `great-idea` and `ran-long` are re-cut in     */
    /* place; the other three are unchanged.                                   */
    /* ---------------------------------------------------------------------- */
    {
      /** DIFFERENTIATE (G-conversion): drops an unconditional `reputation +2`. */
      id: "card.meeting.great-idea",
      nameKey: "deadlineDash.card.meetingGreatIdea.name",
      displayName: "Idea Adopted",
      flavorText: "Your suggestion was minuted and attributed to you.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "drawCards", deckId: "deck.meeting", count: 1 },
      ],
    },
    {
      /**
       * DIFFERENTIATE (B-target): frees the plain `energy -1` quota. Unaimed
       * pressure — a fixed-relation target and the drawer eats one too — so no
       * heat. Authored per the re-cut notes rather than the plan's printed
       * `M(energy,-1) WC(1)`, which reproduces `card.meeting.weekly-sync` with
       * its two effects in the opposite order.
       */
      id: "card.meeting.ran-long",
      nameKey: "deadlineDash.card.meetingRanLong.name",
      displayName: "Meeting Overran",
      flavorText: "The slot overran and the booking after it started late.",
      polarity: "negative",
      copies: 2,
      effects: [
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "right-neighbour",
        },
      ],
    },
    {
      /** KEEP. */
      id: "card.meeting.executive-endorsement",
      nameKey: "deadlineDash.card.meetingExecutiveEndorsement.name",
      displayName: "Executive Endorsement",
      flavorText: "A director's note on file, timed for your next pay run.",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-salary-multiplier",
          duration: { kind: "uses", count: 1 },
          parameters: { multiplier: 1.5 },
          polarity: "positive",
        },
      ],
    },
    {
      /** KEEP. Holds the plain `reputation -1` signature, slot 3 of 3 pack-wide. */
      id: "card.meeting.awkward-silence",
      nameKey: "deadlineDash.card.meetingAwkwardSilence.name",
      displayName: "Dead Air",
      flavorText: "Your question landed and no one answered it.",
      polarity: "negative",
      effects: [{ type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true }],
    },
    {
      /** KEEP. */
      id: "card.meeting.free-lunch",
      nameKey: "deadlineDash.card.meetingFreeLunch.name",
      displayName: "Catering Surplus",
      flavorText: "The department expensed lunch and refunded your share.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 50, clampAtZero: true }],
    },

    /* ---------------------------------------------------------------------- */
    /* Immediate self-effects — expressible in v1 vocabulary, and unchanged by  */
    /* the schema's growth.                                                    */
    /* ---------------------------------------------------------------------- */
    {
      /** KEEP. Holds the plain `reputation +1` signature, slot 2 of 3 pack-wide. */
      id: "card.meeting.productive-meeting",
      nameKey: "deadlineDash.card.meetingProductiveMeeting.name",
      displayName: "Productive Meeting",
      flavorText: "The agenda closed on time with every item resolved.",
      polarity: "positive",
      copies: 2,
      effects: [{ type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
    },
    {
      /** DIFFERENTIATE (D-tradeoff): was a fourth bare `reputation +1`. */
      id: "card.meeting.weekly-sync",
      nameKey: "deadlineDash.card.meetingWeeklySync.name",
      displayName: "Weekly Sync",
      flavorText: "The recurring slot ran to time and the delivery tracker was updated.",
      polarity: "mixed",
      copies: 2,
      effects: [
        {
          type: "incrementWorkCounter",
          amount: 1,
          rewardEvery: 5,
          reward: { resource: "reputation", amount: 1 },
          cumulative: true,
        },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
      ],
    },
    {
      /** DIFFERENTIATE (D-tradeoff): drops an unconditional `reputation +2`. */
      id: "card.meeting.great-presentation",
      nameKey: "deadlineDash.card.meetingGreatPresentation.name",
      displayName: "Presentation Well Received",
      flavorText: "Attendance was full, and you presented every slide yourself.",
      polarity: "mixed",
      copies: 2,
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
      ],
    },
    {
      /** KEEP. Holds `money +200`, slot 1 of 3. */
      id: "card.meeting.client-approval",
      nameKey: "deadlineDash.card.meetingClientApproval.name",
      displayName: "Client Approval",
      flavorText: "The client signed the proposal as submitted.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 200, clampAtZero: true }],
    },
    {
      /** KEEP. Holds `energy +1`, slot 2 of 3. */
      id: "card.meeting.decision-made",
      nameKey: "deadlineDash.card.meetingDecisionMade.name",
      displayName: "Decision Recorded",
      flavorText: "A blocking question was settled in the room.",
      polarity: "positive",
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
      /** KEEP. Holds `reputation +1 | energy +1`, slot 2 of 3. */
      id: "card.meeting.clear-direction",
      nameKey: "deadlineDash.card.meetingClearDirection.name",
      displayName: "Clear Direction",
      flavorText: "Next steps were assigned before the call ended.",
      polarity: "positive",
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
      /** KEEP. Holds `money +100 | reputation +1`, slot 2 of 3. */
      id: "card.meeting.cross-department-support",
      nameKey: "deadlineDash.card.meetingCrossDepartmentSupport.name",
      displayName: "Cross-Department Support",
      flavorText: "Another team committed resource to your workstream.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "money", amount: 100, clampAtZero: true },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      /** KEEP. Holds `money +200 | reputation +1`, slot 1 of 3. */
      id: "card.meeting.successful-negotiation",
      nameKey: "deadlineDash.card.meetingSuccessfulNegotiation.name",
      displayName: "Terms Agreed",
      flavorText: "Both parties left the room holding the same figure.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      /** DIFFERENTIATE (G-conversion): drops an unconditional `reputation +2` into standing plus momentum. */
      id: "card.meeting.project-greenlight",
      nameKey: "deadlineDash.card.meetingProjectGreenlight.name",
      displayName: "Project Greenlit",
      flavorText: "The steering group cleared the proposal and delivery started at once.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "grantExtraRoll", count: 1 },
      ],
    },
    {
      /** DIFFERENTIATE (D-tradeoff): the first card that pulls `deck.work` from a meeting. */
      id: "card.meeting.new-opportunity",
      nameKey: "deadlineDash.card.meetingNewOpportunity.name",
      displayName: "New Project Assignment",
      flavorText: "Your name was added to the launch roster and the first task is assigned.",
      polarity: "mixed",
      effects: [
        { type: "drawCards", deckId: "deck.work", count: 1 },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
      ],
    },
    {
      /** KEEP. Holds `money +300`, slot 2 of 3. */
      id: "card.meeting.client-expansion",
      nameKey: "deadlineDash.card.meetingClientExpansion.name",
      displayName: "Client Expansion",
      flavorText: "The account requested additional scope in writing.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 300, clampAtZero: true }],
    },
    {
      /** DIFFERENTIATE (G-conversion): 2nd of 3 bare `grantExtraRoll`; frees an `energy +1`. */
      id: "card.meeting.meeting-ends-early",
      nameKey: "deadlineDash.card.meetingMeetingEndsEarly.name",
      displayName: "Meeting Ended Early",
      flavorText: "The room was released early and the remainder of the slot returned to you.",
      polarity: "positive",
      effects: [{ type: "grantExtraRoll", count: 1 }],
    },
    {
      /** DIFFERENTIATE (C-timing): re-pointed off `status.ignore-next-work-energy`. */
      id: "card.meeting.efficient-agenda",
      nameKey: "deadlineDash.card.meetingEfficientAgenda.name",
      displayName: "Efficient Agenda",
      flavorText: "The agenda held, and the next item on the schedule needs nothing from you.",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.skip-next-tile-effect",
          duration: { kind: "uses", count: 1 },
          polarity: "positive",
        },
      ],
    },
    {
      /** KEEP. Holds `energy -2`, slot 1 of 3. */
      id: "card.meeting.scope-creep",
      nameKey: "deadlineDash.card.meetingScopeCreep.name",
      displayName: "Scope Creep",
      flavorText: "Requirements were added after sign-off and absorbed by you.",
      polarity: "negative",
      effects: [{ type: "modifyResource", resource: "energy", amount: -2, clampAtZero: true }],
    },
    {
      /** DIFFERENTIATE (D-tradeoff): a billable overrun, not a second bare `energy -2`. */
      id: "card.meeting.meeting-overrun",
      nameKey: "deadlineDash.card.meetingMeetingOverrun.name",
      displayName: "Overtime Meeting",
      flavorText: "The session ran past the working day and the hours were billed on.",
      polarity: "mixed",
      effects: [
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
        { type: "modifyResource", resource: "money", amount: 100, clampAtZero: true },
      ],
    },
    {
      /** KEEP. Holds `energy +1`, slot 3 of 3 — and the second in this deck, at the per-deck cap. */
      id: "card.meeting.quick-stand-up",
      nameKey: "deadlineDash.card.meetingQuickStandUp.name",
      displayName: "Stand-Up Held",
      flavorText: "The team reported in and the room emptied.",
      polarity: "positive",
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
      /** DIFFERENTIATE (D-tradeoff): drops another bare `reputation +1`. */
      id: "card.meeting.brainstorm-session",
      nameKey: "deadlineDash.card.meetingBrainstormSession.name",
      displayName: "Brainstorm Session",
      flavorText: "The board filled up and a follow-up session was booked before you left.",
      polarity: "mixed",
      effects: [
        { type: "drawCards", deckId: "deck.meeting", count: 1 },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
      ],
    },
    {
      /** DIFFERENTIATE (C-timing): distinct `spaces` from `card.work.efficient-workflow`. */
      id: "card.meeting.strategic-planning",
      nameKey: "deadlineDash.card.meetingStrategicPlanning.name",
      displayName: "Strategic Planning",
      flavorText: "The long-range plan was minuted and the route ahead is already mapped.",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-roll-extra-movement",
          duration: { kind: "uses", count: 1 },
          parameters: { spaces: 3 },
          polarity: "positive",
        },
      ],
    },
    {
      /** DIFFERENTIATE (D-tradeoff): the review costs time as well as standing. */
      id: "card.meeting.performance-review-development",
      nameKey: "deadlineDash.card.meetingPerformanceReviewDevelopment.name",
      displayName: "Performance Review: Actions",
      flavorText: "The filed review lists improvement actions and a follow-up date.",
      polarity: "negative",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
      ],
    },
    {
      /** KEEP. Holds `energy -1`, slot 1 of 3. */
      id: "card.meeting.follow-up-required",
      nameKey: "deadlineDash.card.meetingFollowUpRequired.name",
      displayName: "Follow-Up Required",
      flavorText: "The item was carried forward and another session booked.",
      polarity: "negative",
      effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
    },
    {
      /** DIFFERENTIATE (D-tradeoff): the best card in the deck now costs something. */
      id: "card.meeting.meeting-master",
      nameKey: "deadlineDash.card.meetingMeetingMaster.name",
      displayName: "Exemplary Session",
      flavorText: "Minutes recorded the session as a model, and you ran all of it.",
      polarity: "mixed",
      effects: [
        { type: "modifyResource", resource: "money", amount: 300, clampAtZero: true },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Conditional and scaled self-effects. The guard's subject defaults to     */
    /* `"target"` — the player the effect is being applied to — which is what   */
    /* makes a condition on a table-wide effect test each player individually.  */
    /* ---------------------------------------------------------------------- */
    {
      /** DIFFERENTIATE (A-condition): catch-up shaped — the guard tests the drawer's own tier. */
      id: "card.meeting.manager-recognition",
      nameKey: "deadlineDash.card.meetingManagerRecognition.name",
      displayName: "Manager Recognition",
      flavorText: "Your line manager noted the update in the team channel.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          condition: { kind: "rankIndexAtMost", who: "target", index: 4 },
        },
      ],
    },
    {
      /** DIFFERENTIATE (A-condition): conditional `reputation +2`, slot 4 of 12 pack-wide. */
      id: "card.meeting.executive-praise",
      nameKey: "deadlineDash.card.meetingExecutivePraise.name",
      displayName: "Executive Praise",
      flavorText: "Leadership named your contribution in the review summary.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
          clampAtZero: true,
          condition: { kind: "rankIndexAtLeast", who: "target", index: 4 },
        },
      ],
    },
    {
      /** DIFFERENTIATE (E-scaling): seniority buys a bigger line. */
      id: "card.meeting.approved-budget",
      nameKey: "deadlineDash.card.meetingApprovedBudget.name",
      displayName: "Budget Request Approved",
      flavorText: "Finance released the line at the level your grade is authorized for.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 100,
          clampAtZero: true,
          scale: { by: "rank-tier", perUnit: 100 },
        },
      ],
    },
    {
      /** DIFFERENTIATE (A-condition): conditional `reputation +2`, slot 5 of 12 pack-wide. */
      id: "card.meeting.performance-review-commendation",
      nameKey: "deadlineDash.card.meetingPerformanceReviewCommendation.name",
      displayName: "Performance Review: Commended",
      flavorText: "Your manager filed the review with no development actions.",
      polarity: "positive",
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
            amount: 8,
          },
        },
      ],
    },
    {
      /** DIFFERENTIATE (F-choice): the `reputation +2` is legal because it sits inside a `chooseOne`. */
      id: "card.meeting.promotion-discussion",
      nameKey: "deadlineDash.card.meetingPromotionDiscussion.name",
      displayName: "Progression Discussed",
      flavorText: "Your career path was tabled as a formal agenda item.",
      polarity: "positive",
      effects: [
        {
          type: "chooseOne",
          options: [
            {
              id: "visibility",
              label: "Ask for the visibility",
              effects: [
                { type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true },
              ],
            },
            {
              id: "budget",
              label: "Ask for the budget",
              effects: [
                { type: "modifyResource", resource: "money", amount: 400, clampAtZero: true },
              ],
            },
          ],
        },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Benign targeting: no `modifyHeat`, because nothing was aimed. Heat is    */
    /* the price of choosing a victim, and charging it where there was no       */
    /* choice is as much a defect as not charging it at all.                    */
    /* ---------------------------------------------------------------------- */
    {
      /** DIFFERENTIATE (B-target): you mentor a colleague; both of you gain. */
      id: "card.meeting.mentorship-session",
      nameKey: "deadlineDash.card.meetingMentorshipSession.name",
      displayName: "Mentorship Session",
      flavorText: "You booked recurring time with a colleague and it was logged.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "chosen-opponent",
        },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Aimed aggression, six of six for this deck. Every one carries a          */
    /* `modifyHeat` on the actor with an explicit `target: "self"`, and every    */
    /* flavor line is written in the *drawer's* agency — a card that marks you   */
    /* as an aggressor must not read as an accident.                            */
    /* ---------------------------------------------------------------------- */
    {
      /**
       * ADD-AGGRESSION, aimed 1 of 6. The plan prints a bare
       * `reputation -1 @chosen-opponent`, which is byte-identical to the three
       * cards it separately names as that signature's only slots. Differentiated
       * on the A-condition axis instead: you can only meaningfully challenge
       * someone with standing to lose, so the guard tests the *target's* tier.
       */
      id: "card.meeting.tough-questions",
      nameKey: "deadlineDash.card.meetingToughQuestions.name",
      displayName: "Challenged In Review",
      flavorText: "You put the question to a senior colleague and the room waited.",
      polarity: "mixed",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
          condition: { kind: "rankIndexAtLeast", who: "target", index: 3 },
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** ADD-AGGRESSION, aimed 2 of 6. Heat two, for a two-point swing. */
      id: "card.meeting.proposal-rejected",
      nameKey: "deadlineDash.card.meetingProposalRejected.name",
      displayName: "Proposal Declined",
      flavorText: "You returned their submission and recorded no route to appeal.",
      polarity: "mixed",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -2,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 2, target: "self" },
      ],
    },
    {
      /** ADD-AGGRESSION, aimed 3 of 6. Was a plain self `payResource`. */
      id: "card.meeting.budget-cut",
      nameKey: "deadlineDash.card.meetingBudgetCut.name",
      displayName: "Budget Reduced",
      flavorText: "You moved their allocation onto your own line at review.",
      polarity: "mixed",
      effects: [
        {
          type: "transferResource",
          resource: "money",
          amount: 200,
          direction: "target-to-actor",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** ADD-AGGRESSION, aimed 4 of 6. The drawer eats one too. */
      id: "card.meeting.miscommunication",
      nameKey: "deadlineDash.card.meetingMiscommunication.name",
      displayName: "Crossed Wires",
      flavorText: "You minuted an outcome the other party had not agreed to.",
      polarity: "mixed",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true },
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
      /**
       * ADD-AGGRESSION, aimed 5 of 6. Removes the pack's last `reputation +3`.
       * A derived target, so the `playerOrder` tie-break is load-bearing: object
       * key order is not a contract across the repository's JSON round trip.
       */
      id: "card.meeting.executive-alignment",
      nameKey: "deadlineDash.card.meetingExecutiveAlignment.name",
      displayName: "Executive Alignment",
      flavorText: "You presented the program as agreed and left the junior name off it.",
      polarity: "mixed",
      effects: [
        {
          type: "transferResource",
          resource: "reputation",
          amount: 1,
          direction: "target-to-actor",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "lowest-rank",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** ADD-AGGRESSION, aimed 6 of 6. Aimed at the derived leader. */
      id: "card.meeting.town-hall",
      nameKey: "deadlineDash.card.meetingTownHall.name",
      displayName: "Town Hall Question",
      flavorText: "You took the floor and put it to the most senior name present.",
      polarity: "mixed",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "highest-rank",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Status removal, the Clock Deck idle ticks, and the stored/reaction set.  */
    /* ---------------------------------------------------------------------- */
    {
      /** DIFFERENTIATE (G-conversion): the deck's only consumer of `removeStatuses`. */
      id: "card.meeting.meeting-cancelled",
      nameKey: "deadlineDash.card.meetingMeetingCancelled.name",
      displayName: "Meeting Cancelled",
      flavorText: "The organizer released the slot and an open action lapsed with it.",
      polarity: "positive",
      effects: [{ type: "removeStatuses", filter: { polarity: "negative" }, limit: 1 }],
    },
    {
      /**
       * Burns a Clock Deck card and does nothing else, on purpose. Its identical
       * signature with `decision-deferred` is exempt from the deduplication
       * quota — that is the one signature whose repetition is the design.
       */
      id: "card.meeting.reschedule",
      nameKey: "deadlineDash.card.meetingReschedule.name",
      displayName: "Session Rescheduled",
      flavorText: "The organizer moved the slot and nothing else changed.",
      effects: [{ type: "noEffect" }],
    },
    {
      /** The second Clock Deck idle tick. See `reschedule` above. */
      id: "card.meeting.decision-deferred",
      nameKey: "deadlineDash.card.meetingDecisionDeferred.name",
      displayName: "Decision Deferred",
      flavorText: "No decision was recorded, and the item moved to the next agenda.",
      effects: [{ type: "noEffect" }],
    },
    {
      /**
       * The exact mirror of the tile-authored `status.ignore-next-work-energy` —
       * a penalty twin of a shipped bonus. Deliberately left at the default
       * `immediate` timing rather than the re-cut plan's `stored`: a stored
       * penalty is never voluntarily played, so `stored` would make this card
       * permanently inert, which is the dead-content defect the re-cut exists to
       * remove.
       */
      id: "card.meeting.action-items",
      nameKey: "deadlineDash.card.meetingActionItems.name",
      displayName: "Action Items",
      flavorText: "The list came out of the meeting with your name against each line.",
      polarity: "negative",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-work-extra-energy",
          duration: { kind: "uses", count: 1 },
          parameters: { energy: 1 },
          polarity: "negative",
        },
      ],
    },
    {
      /**
       * Not substitutable by `status.skip-next-tile-effect`, which suppresses the
       * whole tile rather than the next meeting's energy line.
       */
      id: "card.meeting.calendar-priority",
      nameKey: "deadlineDash.card.meetingCalendarPriority.name",
      displayName: "Calendar Priority",
      flavorText: "Scheduling holds a protected block against your name.",
      timing: "stored",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.ignore-next-meeting-energy",
          duration: { kind: "uses", count: 1 },
          polarity: "positive",
        },
      ],
    },
    {
      /**
       * DIFFERENTIATE (C-timing): drops an unconditional `reputation +2` for a
       * promotion discount. Distinct `parameters` from
       * `card.work.promotion-portfolio`, which holds the same status at one.
       */
      id: "card.meeting.approval-letter",
      nameKey: "deadlineDash.card.meetingApprovalLetter.name",
      displayName: "Approval Letter",
      flavorText: "Signed, filed, and produced when the next panel asks for it.",
      timing: "stored",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-promotion-reputation-discount",
          duration: { kind: "uses", count: 1 },
          parameters: { reputation: 2 },
          polarity: "positive",
        },
      ],
    },
    {
      /**
       * KEEP, re-expressed under the declared `grantImmunity` shape. The scope
       * used to ride on the open `condition` bag, where a typo failed silently
       * rather than at the type level.
       */
      id: "card.meeting.meeting-minutes",
      nameKey: "deadlineDash.card.meetingMeetingMinutes.name",
      displayName: "Minutes On Record",
      flavorText: "The record shows what was agreed and who agreed to it.",
      timing: "reaction",
      polarity: "positive",
      effects: [
        { type: "grantImmunity", count: 1, scope: { resource: "reputation", direction: "loss" } },
      ],
    },
    {
      /** DIFFERENTIATE (C-timing): a prepared deck is a turn you do not have to spend. */
      id: "card.meeting.presentation-slides-ready",
      nameKey: "deadlineDash.card.meetingPresentationSlidesReady.name",
      displayName: "Slides Ready In Advance",
      flavorText: "The deck was circulated before the meeting opened.",
      timing: "stored",
      polarity: "positive",
      effects: [
        { type: "grantImmunity", count: 1, scope: { resource: "energy", direction: "loss" } },
      ],
    },
    {
      /**
       * DIFFERENTIATE (G-conversion). The plan's KEEP would have left this a
       * fourth pack-wide holder of the bare `money +300` signature, against the
       * three the plan itself names. A signed budget is what lets the work it
       * funds actually start.
       */
      id: "card.meeting.budget-approval-memo",
      nameKey: "deadlineDash.card.meetingBudgetApprovalMemo.name",
      displayName: "Approval Memo",
      flavorText: "Countersigned, and the work it funds can start on presentation.",
      timing: "stored",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "money", amount: 300, clampAtZero: true },
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
      /**
       * DIFFERENTIATE (C-timing): frees the `reputation +1 | energy +1` slot for
       * `card.event.thank-you-card`. Meaningful only once the energy ceiling
       * rises above the starting value — until then `restoreResourceToMaximum` is
       * a guaranteed no-op for a rested player.
       */
      id: "card.meeting.leadership-coaching",
      nameKey: "deadlineDash.card.meetingLeadershipCoaching.name",
      displayName: "Coaching Session",
      flavorText: "Booked with a senior sponsor and held in confidence.",
      timing: "stored",
      polarity: "positive",
      effects: [{ type: "restoreResourceToMaximum", resource: "energy" }],
    },
  ],
} as const satisfies DeckConfig;
