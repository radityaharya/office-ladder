import type { DeckConfig } from "../../schema/decks";

/**
 * `deck.annual-event` — one of the two corner decks, drawn from the top-right
 * corner space. Corner decks are all-player decks by design.
 *
 * Append new cards to `annualEventDeck.cards`. The authoring and display-copy
 * rules that bind every card in this pack live in the docstring of
 * `./index.ts`; read them before adding a row here.
 *
 * ## The re-cut, and what it fixed
 *
 * Three of the four cards this deck used to ship are gone, each superseded by
 * the source row it was a thin paraphrase of. The fourth survives under a new
 * id — `card.annual-event.holiday-bonus-deferred`, the last entry below — so that
 * `card.annual-event.holiday-bonus` is free for the workbook card of that name.
 *
 * The deeper problem was deck shape rather than any one card. A symmetric effect
 * applied to everyone changes nobody's relative standing, so a card that consumes
 * a turn, writes a log line and leaves the game exactly where it was is
 * ceremonial. **All-player must never mean identical-to-everyone.** Every card
 * below therefore carries at least one named asymmetry pattern, printed on its
 * own row:
 *
 *   P1 rank-scaled     `scale: { by: "rank-tier" }` on an `@all-players` effect
 *   P2 rank-inverse    two effects split by a `rankIndexAtMost`/`AtLeast` guard
 *   P3 derived subset  a second effect at `@poorest` / `@highest-rank` / …
 *   P4 heat-gated      guarded on `heatAtLeast`, or its negation
 *   P5 position-scaled `scale: { by: "laps" }`
 *   P6 work-scaled     `scale: { by: "work-counter" }`
 *   P7 split           opposite effects at `@highest-rank` and `@lowest-rank`
 *   P8 per-target roll `rollCheck` with `resolution: "per-target"`
 *   P9 actor-exempt    `@all-opponents` while the actor gains — aimed, carries heat
 *
 * Two cards need no pattern because they are asymmetric by construction: salary
 * is rank-scaled, so an identical instruction pays every player a different
 * amount. Those are `card.annual-event.performance-bonus` and the renamed
 * `card.annual-event.holiday-bonus-deferred`.
 *
 * ## Aggression
 *
 * Three cards here are **aimed**: `fireworks-celebration`, `lucky-draw-mix-up`
 * and `karaoke-disaster`. Each carries `modifyHeat` on the actor with an explicit
 * `target: "self"`. Two further cards move resources between players and
 * deliberately carry no heat, because in both the drawer is the one paying:
 * `secret-santa` transfers `actor-to-target`, and `family-day` is the pack's only
 * table-wide heat *relief* — before the re-cut nothing anywhere could lower heat,
 * which made it a one-way ratchet and therefore not a decision. Its `modifyHeat`
 * is the one in this file that is not `target: "self"`, and that is deliberate.
 *
 * ## `polarity`, which only this deck authors
 *
 * `rank.senior-manager`'s `multiplyAnnualEventReward` doubles positive annual-event
 * rewards, and after the re-cut this deck holds outright negative cards and mixed
 * ones — so "is this a reward?" stopped being rhetorical. A card marked `"mixed"`
 * is telling the resolver not to blanket-double it but to go per-effect:
 * `karaoke-night` grants reputation to juniors *and* costs everyone energy, and
 * doubling the whole card doubles the penalty too. `deck.board-meeting` has no
 * such consumer, so it omits the field rather than carrying a value nothing reads.
 *
 * ## Reading the guards
 *
 * `condition.who` is `"target"` on every guard in this file, which is what makes
 * a guard on an `@all-players` effect mean "each player is tested individually"
 * rather than "test the drawer once". The re-cut plan writes the heat guards as
 * `heatAtMost(0)`; the engine's closed condition grammar has no `heatAtMost`
 * clause, so they are written here as `not(heatAtLeast(1))`, the same predicate
 * over integer heat.
 *
 * Timing is `immediate` on every card, so none of them sets `timing`. This deck
 * is not part of the Clock Deck, so it reshuffles rather than depleting.
 */
export const annualEventDeck = {
  id: "deck.annual-event",
  cards: [
    {
      /**
       * Asymmetric by construction rather than by pattern: `gainSalary` pays
       * against current rank and honours Sales Star's `salaryMultiplier`
       * automatically, which is exactly what the source row's "one times salary"
       * means. A flat cash amount would lose both.
       *
       * INERT UNTIL: `gainSalary` is honoured inside an effect list.
       * `resolve-tile-effects.ts` returns `inert(player)` for it today, which
       * already silently kills the shipped `globalEvent.bonus-season` as well —
       * one shared piece of engine work, not a per-card cost.
       */
      id: "card.annual-event.performance-bonus",
      nameKey: "deadlineDash.card.annualEventPerformanceBonus.name",
      displayName: "Company Bonus Run",
      flavorText: "The bonus run was released against current grade for the whole roster.",
      polarity: "positive",
      effects: [{ type: "gainSalary", trigger: "land", target: "all-players" }],
    },
    {
      /**
       * P8 per-target roll, and the one card the audit found already asymmetric
       * before the pattern had a name. Six single-value bands rather than ranges,
       * because the payout is linear in the die and there is no band to collapse.
       *
       * `resolution: "per-target"` is authored explicitly rather than implied by
       * `target` sitting on the `rollCheck`; the default is `"shared"`, which is a
       * different card. The nested outcome effects stay untargeted so they inherit
       * the roll's target — "the player this roll was made for", not the actor.
       * Missing either rule pays one player six times.
       */
      id: "card.annual-event.raffle-jackpot",
      nameKey: "deadlineDash.card.annualEventRaffleJackpot.name",
      displayName: "Raffle Jackpot",
      flavorText: "Each ticket was drawn separately and settled at the posted rate.",
      polarity: "positive",
      effects: [
        {
          type: "rollCheck",
          dice: { count: 1, sides: 6 },
          rerollEligible: false,
          target: "all-players",
          resolution: "per-target",
          outcomes: [
            {
              when: { total: [1, 1] },
              effects: [
                { type: "modifyResource", resource: "money", amount: 100, clampAtZero: true },
              ],
            },
            {
              when: { total: [2, 2] },
              effects: [
                { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true },
              ],
            },
            {
              when: { total: [3, 3] },
              effects: [
                { type: "modifyResource", resource: "money", amount: 300, clampAtZero: true },
              ],
            },
            {
              when: { total: [4, 4] },
              effects: [
                { type: "modifyResource", resource: "money", amount: 400, clampAtZero: true },
              ],
            },
            {
              when: { total: [5, 5] },
              effects: [
                { type: "modifyResource", resource: "money", amount: 500, clampAtZero: true },
              ],
            },
            {
              when: { total: [6, 6] },
              effects: [
                { type: "modifyResource", resource: "money", amount: 600, clampAtZero: true },
              ],
            },
          ],
        },
      ],
    },
    {
      /** P2 rank-inverse. Supersedes the shipped `card.annual-event.awards-ceremony`. */
      id: "card.annual-event.employee-appreciation-awards",
      nameKey: "deadlineDash.card.annualEventEmployeeAppreciationAwards.name",
      displayName: "Appreciation Awards",
      flavorText: "Every team was named from the stage and the junior list drew the ovation.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
          clampAtZero: true,
          target: "lowest-rank",
        },
      ],
    },
    {
      /**
       * P4 heat-gated. Supersedes the shipped `card.annual-event.company-retreat`.
       * The full restore is worth having only once the energy ceiling rises above
       * starting energy; the flagged half is a bounded gain, so the card degrades
       * gracefully either way.
       */
      id: "card.annual-event.company-trip",
      nameKey: "deadlineDash.card.annualEventCompanyTrip.name",
      displayName: "Company Trip",
      flavorText: "The department went offsite, with the names under review kept on call.",
      polarity: "positive",
      effects: [
        {
          type: "restoreResourceToMaximum",
          resource: "energy",
          target: "all-players",
          condition: { kind: "not", of: { kind: "heatAtLeast", who: "target", value: 1 } },
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "all-players",
          condition: { kind: "heatAtLeast", who: "target", value: 1 },
        },
      ],
    },
    {
      /** P1 rank-scaled. Takes the id vacated by the renamed shipped card at the end of this array. */
      id: "card.annual-event.holiday-bonus",
      nameKey: "deadlineDash.card.annualEventHolidayBonus.name",
      displayName: "Holiday Bonus",
      flavorText: "The seasonal run was released against grade ahead of the shutdown.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 200,
          clampAtZero: true,
          target: "all-players",
          scale: { by: "rank-tier", perUnit: 100 },
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "all-players",
        },
      ],
    },
    {
      /**
       * P9 — annual-event aggression 3 of 3. AIMED, and the only `chosen-opponent`
       * card in either corner deck, so it is also the only one that opens a
       * `PromptState` on resolution. `preventable: true` is set on the aimed effect;
       * the blanket "no corner card sets `preventable`" guidance is written against
       * the hazard of a *table-wide* negative opening one reaction window per
       * player, which a single-target effect does not raise.
       *
       * Supersedes the shipped `card.annual-event.karaoke-mishap`, whose flavor was
       * already a paraphrase of this source row. The line is rewritten into the
       * drawer's agency: the recording did not circulate, you circulated it.
       */
      id: "card.annual-event.karaoke-disaster",
      nameKey: "deadlineDash.card.annualEventKaraokeDisaster.name",
      displayName: "Karaoke Recording",
      flavorText: "You forwarded the recording to the company channel and named the singer.",
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
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** P3 derived subset — the grand prize is the pack's largest single catch-up payment. */
      id: "card.annual-event.grand-lucky-draw",
      nameKey: "deadlineDash.card.annualEventGrandLuckyDraw.name",
      displayName: "Grand Lucky Draw",
      flavorText: "Every ticket was drawn and the top prize landed on the smallest balance.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 200,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "money",
          amount: 800,
          clampAtZero: true,
          target: "poorest",
        },
      ],
    },
    {
      /** P7 split. */
      id: "card.annual-event.annual-dinner",
      nameKey: "deadlineDash.card.annualEventAnnualDinner.name",
      displayName: "Annual Dinner",
      flavorText: "Catering ran to close, and the junior tables were seated nearest the pass.",
      polarity: "positive",
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
          amount: 3,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "lowest-rank",
        },
      ],
    },
    {
      /**
       * P5 position-scaled, and the only card in either corner deck that scales by
       * `laps`. Laps around the board read naturally as years of service, which is
       * exactly what an anniversary distribution is indexed on.
       */
      id: "card.annual-event.company-anniversary",
      nameKey: "deadlineDash.card.annualEventCompanyAnniversary.name",
      displayName: "Company Anniversary",
      flavorText: "The founding date was marked with a distribution weighted by service.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 100,
          clampAtZero: true,
          target: "all-players",
          scale: { by: "laps", perUnit: 150 },
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "all-players",
        },
      ],
    },
    {
      /**
       * P4 heat-gated, inverted: rather than gating a reward on heat, it clears
       * heat outright. This is the only table-wide `modifyHeat` relief in the pack
       * and the only `modifyHeat` in this file that is not `target: "self"`. It is
       * not aggression and carries no self-heat.
       */
      id: "card.annual-event.family-day",
      nameKey: "deadlineDash.card.annualEventFamilyDay.name",
      displayName: "Family Day",
      flavorText: "The site opened to households and every open file was set aside for the day.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "all-players",
        },
        { type: "modifyHeat", amount: -1, target: "all-players" },
      ],
    },
    {
      /**
       * P8 per-target roll. Each player rolls their own pair; the nested outcome
       * effects are left untargeted so they inherit the roll's target rather than
       * the actor. Without both rules this pays one player up to six times, which
       * is the same latent bug the shipped `globalEvent.reorg` and
       * `globalEvent.merger-rumour` carry.
       */
      id: "card.annual-event.sports-day-champion",
      nameKey: "deadlineDash.card.annualEventSportsDayChampion.name",
      displayName: "Sports Day",
      flavorText: "Every division fielded a team and each result was posted separately.",
      polarity: "positive",
      effects: [
        {
          type: "rollCheck",
          dice: { count: 2, sides: 6 },
          rerollEligible: false,
          target: "all-players",
          resolution: "per-target",
          outcomes: [
            {
              when: { doubles: true },
              effects: [
                { type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true },
              ],
            },
            {
              when: { doubles: false },
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
    {
      /**
       * P3 derived subset, deliberately anti-catch-up and the only one in either
       * deck. Every other derived-subset card here pays the bottom; this one pays
       * the top, because a deck where the trailing player always gets the bonus is
       * as predictable as a deck where nobody does.
       */
      id: "card.annual-event.ceo-treat",
      nameKey: "deadlineDash.card.annualEventCeoTreat.name",
      displayName: "Executive Hospitality",
      flavorText: "The chief executive covered the evening and sat with the senior table.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 150,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "money",
          amount: 600,
          clampAtZero: true,
          target: "highest-rank",
        },
      ],
    },
    {
      /**
       * P2 rank-inverse, and the card that makes card-level polarity necessary:
       * the reputation line is a reward and the energy line is not, so
       * `rank.senior-manager`'s `multiplyAnnualEventReward` must double the first
       * and leave the second alone. `polarity: "mixed"` is what tells it to look.
       */
      id: "card.annual-event.karaoke-night",
      nameKey: "deadlineDash.card.annualEventKaraokeNight.name",
      displayName: "Karaoke Night",
      flavorText: "The whole room took a turn and the junior sets carried the night.",
      polarity: "mixed",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "rankIndexAtMost", who: "target", index: 3 },
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "all-players",
        },
      ],
    },
    {
      /** P3 derived subset. */
      id: "card.annual-event.best-costume-award",
      nameKey: "deadlineDash.card.annualEventBestCostumeAward.name",
      displayName: "Best Costume Award",
      flavorText: "The theme was enforced and the newsletter ran the junior entry on its cover.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 100,
          clampAtZero: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
          clampAtZero: true,
          target: "lowest-rank",
        },
      ],
    },
    {
      /**
       * P9 inverted — the drawer pays the table rather than collecting from it, so
       * despite the `@all-opponents` transfer it is **not** aimed and carries no
       * heat. `perTarget: true` is what makes the cost scale with the table, which
       * is the entire point: a fixed self-payment would be cheap at six players and
       * expensive at three, exactly backwards.
       */
      id: "card.annual-event.secret-santa",
      nameKey: "deadlineDash.card.annualEventSecretSanta.name",
      displayName: "Secret Santa",
      flavorText: "You drew every name on the list and covered all of them yourself.",
      polarity: "mixed",
      effects: [
        {
          type: "transferResource",
          resource: "money",
          amount: 200,
          direction: "actor-to-target",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "all-opponents",
        },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      /**
       * P3 derived subset, and the only card in either deck that reads derived
       * targets from two different *metrics* — the split cards all read the two
       * ends of the rank ladder. The trailing player by rank and the trailing
       * player by money are usually but not always the same person; when they are,
       * that player takes both.
       */
      id: "card.annual-event.team-building-success",
      nameKey: "deadlineDash.card.annualEventTeamBuildingSuccess.name",
      displayName: "Team Building Exercise",
      flavorText: "The facilitated session ran long and the write-up credited the stragglers.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "all-players",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "lowest-rank",
        },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "poorest",
        },
      ],
    },
    {
      /** P6 work-scaled. */
      id: "card.annual-event.free-merchandise",
      nameKey: "deadlineDash.card.annualEventFreeMerchandise.name",
      displayName: "Merchandise Issue",
      flavorText: "New stock was distributed against each desk's logged output.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "money",
          amount: 50,
          clampAtZero: true,
          target: "all-players",
          scale: { by: "work-counter", perUnit: 25, cap: 400 },
        },
      ],
    },
    {
      /**
       * P9 actor-exempt — annual-event aggression 1 of 3. AIMED: the drawer takes
       * the credit and every opponent takes the late night. Flavor is written into
       * the drawer's agency; an accident-voiced line over an aimed attack conceals
       * who chose it.
       */
      id: "card.annual-event.fireworks-celebration",
      nameKey: "deadlineDash.card.annualEventFireworksCelebration.name",
      displayName: "Fireworks Display",
      flavorText: "You put your name on the closing display and kept the whole site up late.",
      polarity: "mixed",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "all-opponents",
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      /** P7 split — recognition flows to both ends of the table and skips the middle. */
      id: "card.annual-event.appreciation-speech",
      nameKey: "deadlineDash.card.annualEventAppreciationSpeech.name",
      displayName: "Appreciation Address",
      flavorText: "Leadership thanked the senior table at length and the newest hires briefly.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
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
      /**
       * P8 per-target roll. Same `resolution: "per-target"` and nested-target
       * inheritance requirements as `sports-day-champion`; the band split is on
       * `total` rather than doubles so the two cards do not share a signature.
       */
      id: "card.annual-event.buffet-food-poisoning",
      nameKey: "deadlineDash.card.annualEventBuffetFoodPoisoning.name",
      displayName: "Catering Incident",
      flavorText: "Facilities logged a separate report for every plate that came back.",
      polarity: "negative",
      effects: [
        {
          type: "rollCheck",
          dice: { count: 2, sides: 6 },
          rerollEligible: false,
          target: "all-players",
          resolution: "per-target",
          outcomes: [
            {
              when: { total: [2, 6] },
              effects: [
                { type: "modifyResource", resource: "energy", amount: -3, clampAtZero: true },
              ],
            },
            {
              when: { total: [7, 12] },
              effects: [
                { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
              ],
            },
          ],
        },
      ],
    },
    {
      /**
       * P9 actor-exempt — annual-event aggression 2 of 3. AIMED. An accident-voiced
       * line ("the printed numbers did not match the register") would conceal what
       * this now is: the drawer collecting from everybody.
       */
      id: "card.annual-event.lucky-draw-mix-up",
      nameKey: "deadlineDash.card.annualEventLuckyDrawMixUp.name",
      displayName: "Draw Reconciliation",
      flavorText: "You reconciled the register against the stubs and kept the difference.",
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
      /** P3 derived subset — the head table waited longest, so it lost the most of the afternoon. */
      id: "card.annual-event.rainy-outdoor-event",
      nameKey: "deadlineDash.card.annualEventRainyOutdoorEvent.name",
      displayName: "Weather Cancellation",
      flavorText: "The outdoor program was abandoned and the head table waited it out.",
      polarity: "negative",
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
          amount: -1,
          clampAtZero: true,
          target: "highest-rank",
        },
      ],
    },
    {
      /** P1 rank-scaled. */
      id: "card.annual-event.budget-overrun",
      nameKey: "deadlineDash.card.annualEventBudgetOverrun.name",
      displayName: "Budget Overrun",
      flavorText: "Finance issued the shortfall back and apportioned it by grade.",
      polarity: "negative",
      effects: [
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
       * Not a new design: this is the card that shipped as
       * `card.annual-event.holiday-bonus`, kept under a new id so its old one is
       * free for the source card of the same name earlier in this array. It is the
       * only shipped corner card that survives the re-cut.
       *
       * The effect is unchanged except for the `@all-players` target, and that is
       * what makes it asymmetric without any of the named patterns: salary is
       * rank-scaled, so doubling everyone's next salary award is worth strictly
       * more to the players further up the ladder. It is the mirror image of
       * `card.annual-event.performance-bonus`.
       *
       * The flavor is rewritten because the shipped line was self-voiced and the
       * card no longer applies only to the drawer.
       */
      id: "card.annual-event.holiday-bonus-deferred",
      nameKey: "deadlineDash.card.annualEventHolidayBonusDeferred.name",
      displayName: "Holiday Bonus Scheduled",
      flavorText: "Approved in advance and attached to the next pay run for every grade.",
      polarity: "positive",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.next-salary-multiplier",
          duration: { kind: "uses", count: 1 },
          parameters: { multiplier: 2 },
          target: "all-players",
        },
      ],
    },
  ],
} as const satisfies DeckConfig;
