import type { DeckConfig } from "../../schema/decks";

/**
 * `deck.event` — the tile-draw deck for "event" spaces, and the other half of
 * the Clock Deck (`clockDeck` in `../modes.ts`).
 *
 * Transcribed from the design workbook sheet `07_Event_Cards`, then re-cut per
 * the card re-cut plan's §9. Fifty-one designs: the five that shipped before the
 * re-cut, eleven that only ever needed v1 vocabulary, and thirty-five that
 * needed the v2 vocabulary in `../../schema/effects.ts` — targeting, card-level
 * timing, `chooseOne`, `grantImmunity`, `transferResource` and `opposedRoll` —
 * and could not be typed at all before it landed.
 *
 * This is the pack's most interactive deck and the rules that shape it are worth
 * stating where they are visible:
 *
 *  - **Eleven cards are aimed.** An effect is *aimed* when the actor chooses the
 *    victim, aims at a derived leader, or is exempt from a table-wide cost the
 *    opponents pay — and every aimed effect carries a `modifyHeat` on the actor
 *    with an explicit `target: "self"`. `charity-drive` and `profit-sharing` are
 *    the pair that shows the rule keys off the *effect* and never the deck: both
 *    are table-wide, the first exempts the drawer and pays them, the second does
 *    not, and only the first carries heat.
 *  - **Benign targeting carries no heat.** A gift to a `chosen-opponent`, a
 *    fixed-relation neighbour, an `actor-to-target` transfer the drawer funds —
 *    nothing was taken and nothing was chosen at anyone's expense.
 *  - **`perTarget: true` on the collections is load-bearing.** It is what makes
 *    a table-wide transfer correct at three players *and* at six; a fixed
 *    self-side `payResource` is right at one table size and wrong at every other.
 *
 * Append new cards to `eventDeck.cards`. The authoring and display-copy rules
 * that bind every card in this pack live in the docstring of `./index.ts`; read
 * them before adding a row here. In short: `flavorText` is one line an office
 * system would have logged, it never restates the card's numbers, and
 * `displayName`/`flavorText` are unique **pack-wide**, not per-deck.
 */
export const eventDeck = {
  id: "deck.event",
  cards: [
    /* ---------------------------------------------------------------------- */
    /* Shipped before the re-cut. All five are KEEP.                            */
    /* ---------------------------------------------------------------------- */
    {
      /** KEEP. One of the pack's two Legendaries; `copies: 1` is stated so the rarity curve is visibly deliberate. */
      id: "card.event.jackpot",
      nameKey: "deadlineDash.card.eventJackpot.name",
      displayName: "Quarterly Windfall",
      flavorText: "The unallocated pool cleared, and your name led the memo.",
      polarity: "positive",
      copies: 1,
      effects: [
        { type: "modifyResource", resource: "money", amount: 800, clampAtZero: true },
        { type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true },
      ],
    },
    {
      /**
       * KEEP. The only self-inflicted `skipTurns` in the pack. `source` stays
       * `"tile"` because the re-cut plan's verdict is KEEP-unchanged; the schema
       * now also permits `"card"`, which is what this row actually is, but
       * flipping it is a separate, deliberate call and the validator still
       * hardcodes `"tile"`.
       */
      id: "card.event.office-fire-drill",
      nameKey: "deadlineDash.card.eventOfficeFireDrill.name",
      displayName: "Fire Drill",
      flavorText: "The floor was evacuated and the day was written off.",
      polarity: "negative",
      effects: [{ type: "skipTurns", count: 1, source: "tile" }],
    },
    {
      /** KEEP. Holds `money +300`, slot 3 of 3. */
      id: "card.event.surprise-bonus",
      nameKey: "deadlineDash.card.eventSurpriseBonus.name",
      displayName: "Unscheduled Bonus",
      flavorText: "Payroll issued a correction in your favor.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 300, clampAtZero: true }],
    },
    {
      /** KEEP. Holds `reputation -2`, slot 1 of 3. */
      id: "card.event.data-breach",
      nameKey: "deadlineDash.card.eventDataBreach.name",
      displayName: "Data Breach Disclosed",
      flavorText: "The incident traced back to a folder you shared.",
      polarity: "negative",
      effects: [{ type: "modifyResource", resource: "reputation", amount: -2, clampAtZero: true }],
    },
    {
      /** KEEP. Holds `grantExtraRoll`, slot 1 of 3. */
      id: "card.event.headhunter-call",
      nameKey: "deadlineDash.card.eventHeadhunterCall.name",
      displayName: "Recruiter Call",
      flavorText: "An outside offer bought you room to move again.",
      polarity: "positive",
      effects: [{ type: "grantExtraRoll", count: 1 }],
    },

    /* ---------------------------------------------------------------------- */
    /* Immediate self-effects.                                                 */
    /* ---------------------------------------------------------------------- */
    {
      /** DIFFERENTIATE (E-scaling): frees the bare `money +300` slot for the shipped card. */
      id: "card.event.lucky-day",
      nameKey: "deadlineDash.card.eventLuckyDay.name",
      displayName: "Lucky Day",
      flavorText: "Nothing on the schedule went against you.",
      polarity: "positive",
      effects: [
        {
          type: "rollCheck",
          dice: { count: 2, sides: 6 },
          rerollEligible: false,
          outcomes: [
            {
              when: { doubles: true },
              effects: [
                { type: "modifyResource", resource: "money", amount: 600, clampAtZero: true },
              ],
            },
            {
              when: { doubles: false },
              effects: [
                { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
              ],
            },
          ],
        },
      ],
    },
    {
      /** DIFFERENTIATE (G-conversion): frees `money +200 | reputation +1` for the meeting card. */
      id: "card.event.hidden-opportunity",
      nameKey: "deadlineDash.card.eventHiddenOpportunity.name",
      displayName: "Unlisted Opportunity",
      flavorText: "You found the opening before it was announced.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
        { type: "drawCards", deckId: "deck.networking", count: 1 },
      ],
    },
    {
      /** KEEP. Holds `money +200`, slot 2 of 3. */
      id: "card.event.employee-discount",
      nameKey: "deadlineDash.card.eventEmployeeDiscount.name",
      displayName: "Employee Discount",
      flavorText: "Your staff rate applied at the point of sale.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 200, clampAtZero: true }],
    },
    {
      /** KEEP. Dead content until the energy ceiling rises above the starting value. */
      id: "card.event.wellness-program",
      nameKey: "deadlineDash.card.eventWellnessProgram.name",
      displayName: "Wellness Program",
      flavorText: "You were enrolled in the quarterly wellness initiative.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 3,
          clampAtZero: true,
          clampAtMaximum: true,
        },
      ],
    },
    {
      /** KEEP. */
      id: "card.event.side-hustle",
      nameKey: "deadlineDash.card.eventSideHustle.name",
      displayName: "Outside Engagement",
      flavorText: "Declared to HR, permitted, and paid separately.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 400, clampAtZero: true }],
    },
    {
      /** KEEP. Holds `money +500`, slot 2 of 3. */
      id: "card.event.lucky-draw-winner",
      nameKey: "deadlineDash.card.eventLuckyDrawWinner.name",
      displayName: "Prize Draw Winner",
      flavorText: "Your badge came up at the monthly draw.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 500, clampAtZero: true }],
    },
    {
      /** KEEP. Holds `energy -2`, slot 2 of 3. */
      id: "card.event.laptop-crash",
      nameKey: "deadlineDash.card.eventLaptopCrash.name",
      displayName: "Machine Failure",
      flavorText: "The device stopped mid-task and IT logged the ticket.",
      polarity: "negative",
      effects: [{ type: "modifyResource", resource: "energy", amount: -2, clampAtZero: true }],
    },
    {
      /** KEEP. Holds `payResource money 300`, slot 1 of 3. */
      id: "card.event.payroll-error",
      nameKey: "deadlineDash.card.eventPayrollError.name",
      displayName: "Payroll Error",
      flavorText: "This month's run was processed against the wrong band.",
      polarity: "negative",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 300,
          insufficientFunds: "pay-up-to-available",
        },
      ],
    },
    {
      /** KEEP. Holds `payResource money 200`, slot 1 of 3. */
      id: "card.event.parking-ticket",
      nameKey: "deadlineDash.card.eventParkingTicket.name",
      displayName: "Parking Fine",
      flavorText: "The notice was issued in the visitor bay and is yours.",
      polarity: "negative",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 200,
          insufficientFunds: "pay-up-to-available",
        },
      ],
    },
    {
      /** DIFFERENTIATE (D-tradeoff): frees `payResource money 300` for `payroll-error`. */
      id: "card.event.reimbursement-declined",
      nameKey: "deadlineDash.card.eventReimbursementDeclined.name",
      displayName: "Reimbursement Declined",
      flavorText: "Your personal claim was returned unpaid and copied to your manager.",
      polarity: "negative",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 150,
          insufficientFunds: "pay-up-to-available",
        },
        { type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true },
      ],
    },
    {
      /**
       * KEEP. The second draw burns a second Clock Deck card off one landing —
       * the only card in either Clock Deck half that accelerates the timer. It is
       * also self-referential: `drawCards` draws with replacement, so this card
       * can draw itself and the draw chain needs a depth cap.
       */
      id: "card.event.secret-investor",
      nameKey: "deadlineDash.card.eventSecretInvestor.name",
      displayName: "Anonymous Sponsor",
      flavorText: "An unnamed backer credited your account and asked for nothing.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "money", amount: 500, clampAtZero: true },
        { type: "drawCards", deckId: "deck.event", count: 1 },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Target Player. `chosen-opponent` must open a prompt; an effect that picks */
    /* the target on the player's behalf is a bug. The benign ones carry no      */
    /* `modifyHeat` — nothing is taken from the target.                         */
    /* ---------------------------------------------------------------------- */
    {
      /** KEEP. Benign gift, correctly heat-free. */
      id: "card.event.buy-coffee",
      nameKey: "deadlineDash.card.eventBuyCoffee.name",
      displayName: "Coffee Round",
      flavorText: "You covered a colleague's order at the counter.",
      polarity: "mixed",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "chosen-opponent",
        },
        {
          type: "payResource",
          resource: "money",
          amount: 100,
          insufficientFunds: "pay-up-to-available",
        },
      ],
    },
    {
      /** KEEP. Holds `reputation +1 @chosen-opponent | reputation +1`, slot 1 of 3. */
      id: "card.event.recommend-colleague",
      nameKey: "deadlineDash.card.eventRecommendColleague.name",
      displayName: "Recommendation Filed",
      flavorText: "You put a colleague's name forward where it counted.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "chosen-opponent",
        },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      /** KEEP. Aimed 1 of 11. */
      id: "card.event.cover-my-shift",
      nameKey: "deadlineDash.card.eventCoverMyShift.name",
      displayName: "Cover Arranged",
      flavorText: "Someone else absorbed your workload for the day.",
      polarity: "mixed",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** KEEP. Aimed 2 of 11; holds `reputation -1 @chosen-opponent + heat`, slot 1 of 3. */
      id: "card.event.office-prank",
      nameKey: "deadlineDash.card.eventOfficePrank.name",
      displayName: "Desk Prank",
      flavorText: "Facilities restored the desk and noted who was present.",
      polarity: "mixed",
      effects: [
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
      /** KEEP. Aimed 3 of 11. */
      id: "card.event.borrow-supplies",
      nameKey: "deadlineDash.card.eventBorrowSupplies.name",
      displayName: "Supplies Borrowed",
      flavorText: "Stock left one cost center and arrived at yours.",
      polarity: "mixed",
      effects: [
        {
          type: "transferResource",
          resource: "money",
          amount: 100,
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
      /** KEEP. Aimed 4 of 11. */
      id: "card.event.credit-taken",
      nameKey: "deadlineDash.card.eventCreditTaken.name",
      displayName: "Credit Reassigned",
      flavorText: "The write-up names you and omits whoever did it.",
      polarity: "mixed",
      effects: [
        {
          type: "transferResource",
          resource: "reputation",
          amount: 1,
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
      /** KEEP. Benign. */
      id: "card.event.helping-hand",
      nameKey: "deadlineDash.card.eventHelpingHand.name",
      displayName: "Assistance Provided",
      flavorText: "You took a task off someone else's list.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "chosen-opponent",
        },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      /** KEEP. Benign. */
      id: "card.event.lunch-buddy",
      nameKey: "deadlineDash.card.eventLunchBuddy.name",
      displayName: "Lunch Invitation",
      flavorText: "You and a colleague left the building for the hour.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "chosen-opponent",
        },
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
      /** DIFFERENTIATE (B-target): frees `reputation +1 @chosen-opponent | reputation +1` for `recommend-colleague`. */
      id: "card.event.team-collaboration",
      nameKey: "deadlineDash.card.eventTeamCollaboration.name",
      displayName: "Joint Delivery",
      flavorText: "The outcome was filed under both names.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "chosen-opponent",
        },
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

    /* ---------------------------------------------------------------------- */
    /* Global collections. The actor is exempt from a table-wide cost and        */
    /* collects from it, which is aimed even though the fiction is a birthday    */
    /* envelope — hence the heat.                                                */
    /* ---------------------------------------------------------------------- */
    {
      /** KEEP. Aimed 5 of 11. */
      id: "card.event.birthday-collection",
      nameKey: "deadlineDash.card.eventBirthdayCollection.name",
      displayName: "Birthday Collection",
      flavorText: "An envelope went round the floor and came back to you.",
      polarity: "mixed",
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
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** DIFFERENTIATE (B-target): aimed 6 of 11; splits from `promotion-celebration`. */
      id: "card.event.baby-shower",
      nameKey: "deadlineDash.card.eventBabyShower.name",
      displayName: "Baby Shower Collection",
      flavorText: "You organized the gift and the floor contributed on your list.",
      polarity: "mixed",
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
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** KEEP. Aimed 7 of 11. */
      id: "card.event.wedding-collection",
      nameKey: "deadlineDash.card.eventWeddingCollection.name",
      displayName: "Wedding Collection",
      flavorText: "A card circulated ahead of the leave request.",
      polarity: "mixed",
      effects: [
        {
          type: "transferResource",
          resource: "money",
          amount: 200,
          direction: "target-to-actor",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "all-opponents",
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** KEEP. Aimed 8 of 11. */
      id: "card.event.promotion-celebration",
      nameKey: "deadlineDash.card.eventPromotionCelebration.name",
      displayName: "Promotion Drinks",
      flavorText: "The round was on everyone else, by convention.",
      polarity: "mixed",
      effects: [
        {
          type: "transferResource",
          resource: "money",
          amount: 150,
          direction: "target-to-actor",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "all-opponents",
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** ADD-AGGRESSION (E-scaling): aimed 9 of 11. Seniors pay more. */
      id: "card.event.charity-drive",
      nameKey: "deadlineDash.card.eventCharityDrive.name",
      displayName: "Charity Drive",
      flavorText: "You ran the collection and every other desk was recorded as taking part.",
      polarity: "mixed",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 150,
          insufficientFunds: "pay-up-to-available",
          target: "all-opponents",
          scale: { by: "rank-tier", perUnit: 50 },
        },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** DIFFERENTIATE (E-scaling): the drawer eats it too, so no heat. */
      id: "card.event.profit-sharing",
      nameKey: "deadlineDash.card.eventProfitSharing.name",
      displayName: "Profit Share",
      flavorText: "The surplus was distributed across the floor in proportion to grade.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 100,
          clampAtZero: true,
          target: "all-players",
          scale: { by: "rank-tier", perUnit: 100 },
        },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Fixed-relation targeting and the audit.                                  */
    /* ---------------------------------------------------------------------- */
    {
      /** DIFFERENTIATE (B-target): contagion down the table, not a second bare `energy -2`. Unaimed, so no heat. */
      id: "card.event.office-flu",
      nameKey: "deadlineDash.card.eventOfficeFlu.name",
      displayName: "Reported Unwell",
      flavorText: "You came in unwell and the desk beside you was occupied all day.",
      polarity: "negative",
      effects: [
        { type: "modifyResource", resource: "energy", amount: -2, clampAtZero: true },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "left-neighbour",
        },
      ],
    },
    {
      /**
       * ADD-AGGRESSION, aimed 10 of 11. The first card use of
       * `auditConfinement`, which the engine already implements end to end.
       * Heat two, because confinement costs turns rather than points.
       */
      id: "card.event.surprise-audit",
      nameKey: "deadlineDash.card.eventSurpriseAudit.name",
      displayName: "Unscheduled Audit",
      flavorText: "You flagged an expense line and compliance opened a file on it.",
      polarity: "mixed",
      effects: [
        {
          type: "auditConfinement",
          release: {
            roll: { count: 2, sides: 6 },
            requiresTrueDoubles: true,
            rerollEligible: false,
            alternativeFine: 500,
          },
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 2, target: "self" },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Actor-to-target transfers. The drawer pays, so no heat.                  */
    /* ---------------------------------------------------------------------- */
    {
      /** The drawer funds the floor; `perTarget: true` is what makes the cost scale with the table. */
      id: "card.event.coffee-treat",
      nameKey: "deadlineDash.card.eventCoffeeTreat.name",
      displayName: "Floor Coffee Run",
      flavorText: "You covered the counter for everyone and it was noticed.",
      polarity: "mixed",
      effects: [
        {
          type: "transferResource",
          resource: "money",
          amount: 100,
          direction: "actor-to-target",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "all-opponents",
        },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      /** As `coffee-treat`, larger, and the floor gets the afternoon back as well. */
      id: "card.event.pizza-friday",
      nameKey: "deadlineDash.card.eventPizzaFriday.name",
      displayName: "Friday Catering",
      flavorText: "You put the order in for the whole floor on your own card.",
      polarity: "mixed",
      effects: [
        {
          type: "transferResource",
          resource: "money",
          amount: 150,
          direction: "actor-to-target",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "all-opponents",
        },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "all-opponents",
        },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Choice. Targeting says who, timing says when, `condition` guards —        */
    /* nothing else offers the controller a branch, and the GDD names Choice as  */
    /* a category across all six decks.                                          */
    /* ---------------------------------------------------------------------- */
    {
      /**
       * The `reputation +2` is legal because it sits inside a `chooseOne`; the
       * extra condition makes the stay-put branch a catch-up option rather than a
       * strictly dominated one.
       */
      id: "card.event.career-opportunity",
      nameKey: "deadlineDash.card.eventCareerOpportunity.name",
      displayName: "Career Opportunity",
      flavorText: "An opening elsewhere was confirmed, and the decision sits with you.",
      polarity: "positive",
      effects: [
        {
          type: "chooseOne",
          options: [
            {
              id: "move",
              label: "Take the offer",
              effects: [
                { type: "modifyResource", resource: "money", amount: 400, clampAtZero: true },
              ],
            },
            {
              id: "stay",
              label: "Stay and be counted",
              effects: [
                {
                  type: "modifyResource",
                  resource: "reputation",
                  amount: 2,
                  clampAtZero: true,
                  condition: { kind: "rankIndexAtMost", who: "target", index: 4 },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      /** Rest is only worth taking once the energy ceiling rises above the starting value. */
      id: "card.event.work-life-balance",
      nameKey: "deadlineDash.card.eventWorkLifeBalance.name",
      displayName: "Work-Life Balance",
      flavorText: "The policy allows either option, and the form takes one answer.",
      polarity: "mixed",
      effects: [
        {
          type: "chooseOne",
          options: [
            {
              id: "rest",
              label: "Take the time back",
              effects: [
                {
                  type: "modifyResource",
                  resource: "energy",
                  amount: 3,
                  clampAtZero: true,
                  clampAtMaximum: true,
                },
              ],
            },
            {
              id: "push",
              label: "Work the weekend",
              effects: [
                { type: "modifyResource", resource: "money", amount: 300, clampAtZero: true },
                { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
              ],
            },
          ],
        },
      ],
    },
    {
      /**
       * Benign either way: the drawer either spends energy on a colleague or
       * keeps it, and nothing is taken from anyone.
       */
      id: "card.event.helping-hand-choice",
      nameKey: "deadlineDash.card.eventHelpingHandChoice.name",
      displayName: "Cover Requested",
      flavorText: "A colleague asked to be covered and the request is on your desk.",
      polarity: "mixed",
      effects: [
        {
          type: "chooseOne",
          options: [
            {
              id: "cover",
              label: "Cover the shift",
              effects: [
                {
                  type: "transferResource",
                  resource: "energy",
                  amount: 2,
                  direction: "actor-to-target",
                  perTarget: true,
                  insufficientFunds: "transfer-up-to-available",
                  target: "chosen-opponent",
                },
                { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
              ],
            },
            {
              id: "decline",
              label: "Decline the request",
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
          ],
        },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* The opposed roll — two rollers and a comparison, which `rollCheck`        */
    /* cannot express. Nested `onWin`/`onLose` effects resolve against the       */
    /* opponent, so they carry no `target` of their own.                         */
    /* ---------------------------------------------------------------------- */
    {
      /** ADD-AGGRESSION, aimed 11 of 11. A bet you proposed is aimed, so it carries heat. */
      id: "card.event.office-bet",
      nameKey: "deadlineDash.card.eventOfficeBet.name",
      displayName: "Wager Recorded",
      flavorText: "You proposed the terms and a colleague accepted them.",
      polarity: "mixed",
      effects: [
        {
          type: "opposedRoll",
          opponent: "chosen-opponent",
          dice: { count: 1, sides: 6 },
          onWin: [
            {
              type: "transferResource",
              resource: "money",
              amount: 200,
              direction: "target-to-actor",
              perTarget: true,
              insufficientFunds: "transfer-up-to-available",
            },
          ],
          onLose: [
            {
              type: "transferResource",
              resource: "money",
              amount: 200,
              direction: "actor-to-target",
              perTarget: true,
              insufficientFunds: "transfer-up-to-available",
            },
          ],
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },

    /* ---------------------------------------------------------------------- */
    /* Stored and reaction. The defensive set is the reason `preventable` exists */
    /* on the aimed cards above.                                                */
    /* ---------------------------------------------------------------------- */
    {
      /** DIFFERENTIATE (G-conversion): money plus momentum, not a fourth bare `money +300`. */
      id: "card.event.lucky-coin",
      nameKey: "deadlineDash.card.eventLuckyCoin.name",
      displayName: "Lucky Coin",
      flavorText: "Held in the drawer until the day it was worth producing.",
      timing: "stored",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
        { type: "grantExtraRoll", count: 1 },
      ],
    },
    {
      /** KEEP. The invented `{resource, comparison, value}` guard is re-expressed under the closed condition grammar. */
      id: "card.event.emergency-fund",
      nameKey: "deadlineDash.card.eventEmergencyFund.name",
      displayName: "Emergency Fund",
      flavorText: "Released only when the account runs low.",
      timing: "stored",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 500,
          clampAtZero: true,
          condition: { kind: "resourceAtMost", who: "target", resource: "money", amount: 500 },
        },
      ],
    },
    {
      /** KEEP. Holds `energy +2`, slot 2 of 3. */
      id: "card.event.chocolate-bar",
      nameKey: "deadlineDash.card.eventChocolateBar.name",
      displayName: "Desk Drawer Snack",
      flavorText: "Kept for the afternoon nobody planned for.",
      timing: "stored",
      polarity: "positive",
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
      /** DIFFERENTIATE (G-conversion): drops an unconditional `reputation +2`; holds `reputation +1 | energy +1`, slot 3 of 3. */
      id: "card.event.thank-you-card",
      nameKey: "deadlineDash.card.eventThankYouCard.name",
      displayName: "Thank-You Note",
      flavorText: "Signed by the team and kept where it can be produced.",
      timing: "stored",
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
      /** KEEP, re-expressed under the declared `grantImmunity` shape. */
      id: "card.event.insurance-claim",
      nameKey: "deadlineDash.card.eventInsuranceClaim.name",
      displayName: "Insurance Claim",
      flavorText: "Cover is in force and the next claim needs no further review.",
      timing: "reaction",
      polarity: "positive",
      effects: [
        { type: "grantImmunity", count: 1, scope: { resource: "money", direction: "loss" } },
      ],
    },
    {
      /** KEEP, re-expressed under the declared shape. The second of the reputation-loss immunity pair. */
      id: "card.event.pr-statement",
      nameKey: "deadlineDash.card.eventPrStatement.name",
      displayName: "Prepared Statement",
      flavorText: "Communications has a draft on file for exactly this.",
      timing: "reaction",
      polarity: "positive",
      effects: [
        { type: "grantImmunity", count: 1, scope: { resource: "reputation", direction: "loss" } },
      ],
    },
    {
      /**
       * KEEP, re-expressed with an `effectTypes` scope. Inert until the audit
       * corner's `auditConfinement` effect in `../board.ts` is authored
       * `preventable: true` — the same decision `card.event.surprise-audit` wants.
       */
      id: "card.event.skip-queue-pass",
      nameKey: "deadlineDash.card.eventSkipQueuePass.name",
      displayName: "Priority Pass",
      flavorText: "Compliance waves you through on presentation.",
      timing: "stored",
      polarity: "positive",
      effects: [{ type: "grantImmunity", count: 1, scope: { effectTypes: ["auditConfinement"] } }],
    },
    {
      /**
       * Duration-scoped, not count-scoped: "ignore all energy loss this turn" is
       * not a number and must not be written as one.
       */
      id: "card.event.energy-booster",
      nameKey: "deadlineDash.card.eventEnergyBooster.name",
      displayName: "Rested And Available",
      flavorText: "Occupational health cleared you for the full day.",
      timing: "reaction",
      polarity: "positive",
      effects: [
        {
          type: "grantImmunity",
          duration: { kind: "turns", count: 1 },
          scope: { resource: "energy", direction: "loss" },
        },
      ],
    },
    {
      /**
       * Requires the resolver to read the *drawn* card's `polarity`, which is why
       * `DeckCard.polarity` is authored rather than derived — `scope.sourceDeckId`
       * has nothing to test without it.
       */
      id: "card.event.office-access-pass",
      nameKey: "deadlineDash.card.eventOfficeAccessPass.name",
      displayName: "Access Pass Issued",
      flavorText: "Issued by facilities and valid on presentation.",
      timing: "stored",
      polarity: "positive",
      effects: [{ type: "grantImmunity", count: 1, scope: { sourceDeckId: "deck.event" } }],
    },

    /* ---------------------------------------------------------------------- */
    /* Remaining self-effects, differentiated.                                  */
    /* ---------------------------------------------------------------------- */
    {
      /** DIFFERENTIATE (G-conversion): drops an unconditional `reputation +2` and converts it into work progress. */
      id: "card.event.online-course",
      nameKey: "deadlineDash.card.eventOnlineCourse.name",
      displayName: "Certification Completed",
      flavorText: "The training record shows the course closed and passed.",
      polarity: "positive",
      effects: [
        {
          type: "incrementWorkCounter",
          amount: 3,
          rewardEvery: 5,
          reward: { resource: "reputation", amount: 1 },
          cumulative: true,
        },
      ],
    },
    {
      /**
       * DIFFERENTIATE (D-tradeoff): one of six cards pack-wide that *lower* heat.
       * Before the re-cut nothing could, which made heat a one-way ratchet and
       * therefore not a decision.
       */
      id: "card.event.company-merchandise",
      nameKey: "deadlineDash.card.eventCompanyMerchandise.name",
      displayName: "Branded Merchandise",
      flavorText: "You collected the issued set and wore it where it was noticed.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
        },
        { type: "modifyHeat", amount: -1, target: "self" },
      ],
    },
    {
      /** DIFFERENTIATE (A-condition): worth drawing only when you are actually depleted. */
      id: "card.event.coffee-voucher",
      nameKey: "deadlineDash.card.eventCoffeeVoucher.name",
      displayName: "Coffee Voucher",
      flavorText: "Redeemed at the counter on the mornings that needed it.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
          condition: { kind: "resourceAtMost", who: "target", resource: "energy", amount: 2 },
        },
      ],
    },
  ],
} as const satisfies DeckConfig;
