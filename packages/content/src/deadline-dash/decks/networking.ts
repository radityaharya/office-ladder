import type { DeckConfig } from "../../schema/decks";

/**
 * `deck.networking` — the tile-draw deck for "networking" spaces, merged to the
 * whole of workbook sheet `08_Networking_Cards` under the per-card re-cut plan.
 *
 * Append new cards to `networkingDeck.cards`. The authoring and display-copy
 * rules that bind every card in this pack live in the docstring of
 * `./index.ts`; read them before adding a row here.
 *
 * ## What is in here, and in what order
 *
 * Forty-nine cards: the five that shipped before the re-cut, first and in their
 * original order, then the forty-four authored rows in workbook row order. The
 * two shipped `DIFFERENTIATE` verdicts and the one `RETARGET` are applied in
 * place rather than appended, so no card appears twice.
 *
 * The rename is load-bearing, not cosmetic: the shipped `card.networking.vip-pass`
 * became `card.networking.restricted-floor-pass` precisely to free its id for
 * workbook row 14, which is authored below. Landing one without the other gives
 * the pack a duplicate card id.
 *
 * Two authored rows do not appear at all — row 24 (`awkward-silence`, a third
 * plain energy loss this deck already covers with `forced-icebreaker`) and
 * row 47 (`ghosted-on-linkedin`, a fourth plain reputation loss) were cut for
 * signature duplication.
 *
 * ## Aggression, and why some cards pay heat and others do not
 *
 * *Aimed* aggression — the actor picks the victim (`chosen-opponent`), aims at a
 * derived leader, or is exempt from a table-wide cost the opponents pay — always
 * carries a `modifyHeat` on the actor with an explicit `target: "self"`. Thirteen
 * cards here are aimed. *Unaimed* pressure — a fixed-relation neighbour, a benign
 * derived target, or a cost the drawer eats at no smaller magnitude than the
 * table — carries none: heat is the price of *choosing*, and charging it where
 * there was no choice is as much a defect as not charging it at all.
 * `networking-overload` and `reply-all` are both table-wide negatives in this
 * deck and they land on opposite sides of that line.
 *
 * Three cards carry heat with no aimed effect (`linkedin-influencer`,
 * `office-gossip`, and the shipped `linkedin-endorsement`): visibility is its own
 * exposure. Three *reduce* it (`recruiter-notice`, `guest-speaker-inspiration`,
 * `boring-seminar`) — before the re-cut nothing in the pack could lower heat,
 * which made it a one-way ratchet and therefore not a decision. `amount: 1` means
 * one attack's worth, multiplied by `ModeRules.conflict.heatPerAttack` at
 * resolution; `amount: 2` is reserved for a two-point swing, an all-opponents
 * hit, or a lost turn.
 *
 * ## Condition encodings that differ from the plan's shorthand
 *
 * The re-cut plan writes guards as `{ metric, comparison, value }`. The schema's
 * `EffectCondition` is the closed, `kind`-based grammar the engine's
 * `effects-v2/conditions.ts` actually evaluates, and an unparseable guard fails
 * *closed*, so the shorthand is translated rather than transcribed:
 *
 * - `?rankTierAtMost(n)` / `?rankTierAtLeast(n)` become `rankIndexAtMost` /
 *   `rankIndexAtLeast`. Rank tier and rank index are the same zero-based
 *   position on the ladder — `rank.intern` is index 0 and `player.rank.index` is
 *   what the engine reads.
 * - `?heatAtLeast(n)` becomes `heatAtLeast`.
 * - `?heatAtMost(0)` has no direct clause; it is written as
 *   `not(heatAtLeast(1))`, which is exact for an integer-valued heat track and
 *   is the only encoding available without adding a clause to the engine.
 *
 * `who: "target"` is written explicitly on every clause. It is what makes a guard
 * on an `@all-players` effect mean "each player is tested individually" rather
 * than "test the drawer once" — which is the entire mechanism of
 * `hr-takes-attendance`, and the two readings are different cards.
 */
export const networkingDeck = {
  id: "deck.networking",
  cards: [
    {
      // Shipped before the re-cut · workbook row 37 · KEEP.
      id: "card.networking.lets-circle-back",
      nameKey: "deadlineDash.card.networkingLetsCircleBack.name",
      displayName: "Follow-Up Scheduled",
      flavorText: "The conversation was deferred to another contact.",
      polarity: "positive",
      effects: [{ type: "drawCards", deckId: "deck.networking", count: 1 }],
    },
    {
      // Shipped before the re-cut · DIFFERENTIATE — D-tradeoff. Heat with no
      // aimed effect: the endorsement is public, and being seen is the cost.
      id: "card.networking.linkedin-endorsement",
      nameKey: "deadlineDash.card.networkingLinkedinEndorsement.name",
      displayName: "Public Endorsement",
      flavorText: "A former colleague vouched for you where it is visible.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true, target: "self" },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // Shipped before the re-cut · KEEP.
      id: "card.networking.free-swag",
      nameKey: "deadlineDash.card.networkingFreeSwag.name",
      displayName: "Vendor Swag",
      flavorText: "You cleared the booth's stock and resold it at your desk.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 75, clampAtZero: true }],
    },
    {
      // Shipped before the re-cut · DIFFERENTIATE — A-condition. The energy line
      // is unconditional; the reputation line only bites once you are senior
      // enough for the ride to have been noticed. Frees the plain energy-1 quota.
      id: "card.networking.awkward-elevator-ride",
      nameKey: "deadlineDash.card.networkingAwkwardElevatorRide.name",
      displayName: "Elevator Encounter",
      flavorText: "Nine floors alone with your skip-level manager.",
      polarity: "negative",
      effects: [
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true, target: "self" },
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "self",
          condition: { kind: "rankIndexAtLeast", who: "target", index: 4 },
        },
      ],
    },
    {
      // Shipped before the re-cut · RETARGET — id and nameKey renamed from
      // `card.networking.vip-pass`, effects unchanged. The rename frees that id
      // for workbook row 14, authored below.
      id: "card.networking.restricted-floor-pass",
      nameKey: "deadlineDash.card.networkingRestrictedFloorPass.name",
      displayName: "Restricted Floor Pass",
      flavorText: "Escorted access; the next floor asks nothing of you.",
      polarity: "positive",
      effects: [
        { type: "applyStatus", statusId: "status.skip-next-tile-effect", duration: { kind: "uses", count: 1 } },
      ],
    },
    {
      // row 1 (xlsx row 2) · LinkedIn Influencer · Notes: Positive
      // DIFFERENTIATE — D-tradeoff. The pack's only surviving unconditional
      // reputation +2, and it is legal because it pays for itself on the same
      // card: heat is the price of visibility.
      id: "card.networking.linkedin-influencer",
      nameKey: "deadlineDash.card.networkingLinkedinInfluencer.name",
      displayName: "Industry Visibility",
      flavorText: "A post from your personal account circulated outside the company.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 2, clampAtZero: true, target: "self" },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 2 (xlsx row 3) · Coffee Chat · Notes: Positive
      // DIFFERENTIATE — G-conversion. Reputation traded for a draw.
      id: "card.networking.coffee-chat",
      nameKey: "deadlineDash.card.networkingCoffeeChat.name",
      displayName: "Informal Coffee Chat",
      flavorText: "A conversation at the coffee machine turned into project invitations.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "energy", amount: 1, clampAtZero: true, clampAtMaximum: true },
        { type: "drawCards", deckId: "deck.networking", count: 1 },
      ],
    },
    {
      // row 3 (xlsx row 4) · Free Buffet · Notes: Positive
      // KEEP — holds the pack's energy+2 slot 3 of 3.
      id: "card.networking.free-buffet",
      nameKey: "deadlineDash.card.networkingFreeBuffet.name",
      displayName: "Free Buffet",
      flavorText: "You worked the catering table instead of the room.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "energy", amount: 2, clampAtZero: true, clampAtMaximum: true },
      ],
    },
    {
      // row 4 (xlsx row 5) · Lucky Door Prize · Notes: Positive
      // KEEP — holds the pack's money+500 slot 3 of 3.
      id: "card.networking.lucky-door-prize",
      nameKey: "deadlineDash.card.networkingLuckyDoorPrize.name",
      displayName: "Lucky Door Prize",
      flavorText: "The closing raffle was drawn and your ticket was called.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "money", amount: 500, clampAtZero: true }],
    },
    {
      // row 5 (xlsx row 6) · Industry Connection · Notes: Positive
      // DIFFERENTIATE — A-condition. Conditional +2 slot 6 of 12; catch-up
      // shaped, so it stops paying once you are past mid-ladder.
      id: "card.networking.industry-connection",
      nameKey: "deadlineDash.card.networkingIndustryConnection.name",
      displayName: "Industry Connection",
      flavorText: "An external contact asked for you by name afterward.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 2,
          clampAtZero: true,
          target: "self",
          condition: { kind: "rankIndexAtMost", who: "target", index: 3 },
        },
      ],
    },
    {
      // row 6 (xlsx row 7) · Elevator Pitch · Notes: Positive
      // KEEP — holds the pack's plain-reputation+1 slot 3 of 3.
      id: "card.networking.elevator-pitch",
      nameKey: "deadlineDash.card.networkingElevatorPitch.name",
      displayName: "Elevator Pitch",
      flavorText: "The ride was short and your summary fit it.",
      polarity: "positive",
      effects: [{ type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
    },
    {
      // row 7 (xlsx row 8) · Guest Speaker Inspiration · Notes: Positive
      // DIFFERENTIATE — D-tradeoff. One of the pack's first heat sinks.
      id: "card.networking.guest-speaker-inspiration",
      nameKey: "deadlineDash.card.networkingGuestSpeakerInspiration.name",
      displayName: "Guest Speaker Inspiration",
      flavorText: "The keynote landed and you returned to your desk convinced.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "self",
        },
        { type: "modifyHeat", amount: -1, target: "self" },
      ],
    },
    {
      // row 8 (xlsx row 9) · Business Card Master · Notes: Positive
      // DIFFERENTIATE — G-conversion. Contacts become draws, not reputation.
      id: "card.networking.business-card-master",
      nameKey: "deadlineDash.card.networkingBusinessCardMaster.name",
      displayName: "Business Cards Exchanged",
      flavorText: "Your contact list grew by a full afternoon of introductions.",
      polarity: "positive",
      effects: [{ type: "drawCards", deckId: "deck.networking", count: 2 }],
    },
    {
      // row 9 (xlsx row 10) · New Mentor · Notes: Positive
      // DIFFERENTIATE — C-timing. `status.next-promotion-reputation-discount`
      // reuses the discount path `resolvePromotion` already runs for the Office
      // Politician character.
      id: "card.networking.new-mentor",
      nameKey: "deadlineDash.card.networkingNewMentor.name",
      displayName: "New Mentor",
      flavorText: "A senior colleague offered to keep the conversation going.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true, target: "self" },
        {
          type: "applyStatus",
          statusId: "status.next-promotion-reputation-discount",
          duration: { kind: "uses", count: 1 },
          parameters: { reputation: 1 },
          target: "self",
        },
      ],
    },
    {
      // row 10 (xlsx row 11) · Seminar Certificate · Notes: Positive
      // DIFFERENTIATE — G-conversion. Training leads back to the work deck.
      id: "card.networking.seminar-certificate",
      nameKey: "deadlineDash.card.networkingSeminarCertificate.name",
      displayName: "Seminar Certificate",
      flavorText: "Attendance recorded and a certificate issued to your file.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
        { type: "drawCards", deckId: "deck.work", count: 1 },
      ],
    },
    {
      // row 11 (xlsx row 12) · Coffee Sponsor · Notes: Positive
      // DIFFERENTIATE — B-target. A derived *benign* target, so no heat: there is
      // no victim and there was no choice.
      id: "card.networking.coffee-sponsor",
      nameKey: "deadlineDash.card.networkingCoffeeSponsor.name",
      displayName: "Coffee Sponsor",
      flavorText: "You bought the round and HR filed it as relationship building.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 2,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "poorest",
        },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true, target: "self" },
      ],
    },
    {
      // row 12 (xlsx row 13) · Great Introduction · Notes: Positive
      // DIFFERENTIATE — B-target. The drawer's half is a draw rather than
      // reputation, so the deck stops paying both sides of an introduction in the
      // scarcest currency.
      id: "card.networking.great-introduction",
      nameKey: "deadlineDash.card.networkingGreatIntroduction.name",
      displayName: "Great Introduction",
      flavorText: "You put them in front of someone useful and stepped back.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true, target: "chosen-opponent" },
        { type: "drawCards", deckId: "deck.networking", count: 1 },
      ],
    },
    {
      // row 13 (xlsx row 14) · Recruiter Notice · Notes: Positive · Duration: Stored
      // DIFFERENTIATE — D-tradeoff. `timing` lives on the card, never on an
      // effect: per-effect timing makes a mixed card representable and such a card
      // has no defined answer for which zone it ends up in.
      id: "card.networking.recruiter-notice",
      nameKey: "deadlineDash.card.networkingRecruiterNotice.name",
      displayName: "Recruiter Notice",
      flavorText: "An outside approach you have not answered yet.",
      polarity: "positive",
      timing: "stored",
      effects: [
        { type: "modifyResource", resource: "money", amount: 200, clampAtZero: true, target: "self" },
        { type: "modifyHeat", amount: -1, target: "self" },
      ],
    },
    {
      // row 14 (xlsx row 15) · VIP Pass · Notes: Positive · Duration: Stored
      // Previously unauthorable; unblocked by `grantImmunity`'s declared shape
      // plus `scope.sourceDeckId`. Takes the id freed by renaming the shipped
      // card to `card.networking.restricted-floor-pass` above — the two edits
      // belong in the same change or the pack carries a duplicate id.
      id: "card.networking.vip-pass",
      nameKey: "deadlineDash.card.networkingVipPass.name",
      displayName: "VIP Pass",
      flavorText: "Your name was on the host's list before you arrived.",
      polarity: "positive",
      timing: "stored",
      effects: [{ type: "grantImmunity", count: 1, scope: { sourceDeckId: "deck.networking" } }],
    },
    {
      // row 15 (xlsx row 16) · Networking Jackpot · Notes: Positive
      // DIFFERENTIATE — G-conversion. The reputation half is cut to +1 and the
      // money raised to carry the card.
      id: "card.networking.networking-jackpot",
      nameKey: "deadlineDash.card.networkingNetworkingJackpot.name",
      displayName: "Networking Jackpot",
      flavorText: "Every introduction you made that evening went somewhere.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "money", amount: 400, clampAtZero: true },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      // row 16 (xlsx row 17) · Office Gossip · Notes: Negative
      // DIFFERENTIATE — D-tradeoff. Heat with no aimed effect: exposure without a
      // victim. Flavor rewritten out of the passive voice, because the mechanic
      // now sits in the drawer's own agency.
      id: "card.networking.office-gossip",
      nameKey: "deadlineDash.card.networkingOfficeGossip.name",
      displayName: "Office Gossip",
      flavorText: "You were overheard repeating something that had not been announced.",
      polarity: "negative",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true, target: "self" },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 17 (xlsx row 18) · Wrong Name Tag · Notes: Negative
      // KEEP — holds the pack's plain-reputation-1 slot 2 of 3.
      id: "card.networking.wrong-name-tag",
      nameKey: "deadlineDash.card.networkingWrongNameTag.name",
      displayName: "Wrong Name Tag",
      flavorText: "Reception printed the wrong name and you wore it all day.",
      polarity: "negative",
      effects: [{ type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true }],
    },
    {
      // row 18 (xlsx row 19) · Endless Small Talk · Notes: Negative
      // ADD-AGGRESSION — B-target, networking aggression 12 of 12. The deck's only
      // new attack, and the drawer pays a share of it. Flavor rewritten: it was
      // accident-voiced while the mechanic is now aimed.
      id: "card.networking.endless-small-talk",
      nameKey: "deadlineDash.card.networkingEndlessSmallTalk.name",
      displayName: "Endless Small Talk",
      flavorText: "You kept them in the doorway long after the point had been made.",
      polarity: "negative",
      effects: [
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true, target: "self" },
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
      // row 19 (xlsx row 20) · Forced Icebreaker · Notes: Negative
      // KEEP — holds the pack's plain-energy-1 slot 2 of 3.
      id: "card.networking.forced-icebreaker",
      nameKey: "deadlineDash.card.networkingForcedIcebreaker.name",
      displayName: "Forced Icebreaker",
      flavorText: "A fun fact about yourself, produced for the room on request.",
      polarity: "negative",
      effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
    },
    {
      // row 20 (xlsx row 21) · Sales Pitch Trap · Notes: Negative
      // DIFFERENTIATE — D-tradeoff. Smaller bill, and the hour is gone too.
      id: "card.networking.sales-pitch-trap",
      nameKey: "deadlineDash.card.networkingSalesPitchTrap.name",
      displayName: "Sales Pitch Trap",
      flavorText: "The invitation said networking; the session was a vendor demo.",
      polarity: "negative",
      effects: [
        { type: "payResource", resource: "money", amount: 200, insufficientFunds: "pay-up-to-available" },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true },
      ],
    },
    {
      // row 21 (xlsx row 22) · Cringe LinkedIn Post · Notes: Negative
      // DIFFERENTIATE — A-condition. The higher you are, the worse it lands; the
      // first card in the deck whose bite grows with the ladder.
      id: "card.networking.cringe-linkedin-post",
      nameKey: "deadlineDash.card.networkingCringeLinkedinPost.name",
      displayName: "Ill-Received Post",
      flavorText: "You closed with a question and the comments stayed empty.",
      polarity: "negative",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -2,
          clampAtZero: true,
          target: "self",
          condition: { kind: "rankIndexAtLeast", who: "target", index: 5 },
        },
      ],
    },
    {
      // row 22 (xlsx row 23) · Oversharing · Notes: Negative
      // DIFFERENTIATE — B-target. The pack's first `actor-to-target` transfer. No
      // heat: the drawer is the one who pays, so this is a cost, not an attack.
      id: "card.networking.oversharing",
      nameKey: "deadlineDash.card.networkingOversharing.name",
      displayName: "Oversharing",
      flavorText: "You told them more than the situation asked for and they remembered it.",
      polarity: "negative",
      effects: [
        {
          type: "transferResource",
          resource: "reputation",
          amount: 1,
          direction: "actor-to-target",
          perTarget: true,
          insufficientFunds: "transfer-up-to-available",
          target: "chosen-opponent",
        },
      ],
    },
    {
      // row 23 (xlsx row 24) · Forgot Their Name · Notes: Negative
      // DIFFERENTIATE — A-condition. The second line only bites while you are
      // already under review, so the same card reads differently depending on
      // what you have been doing.
      id: "card.networking.forgot-their-name",
      nameKey: "deadlineDash.card.networkingForgotTheirName.name",
      displayName: "Forgot Their Name",
      flavorText: "You had met them before and could not produce the name.",
      polarity: "negative",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: -1, clampAtZero: true, target: "self" },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "self",
          condition: { kind: "heatAtLeast", who: "target", value: 1 },
        },
      ],
    },
    {
      // row 25 (xlsx row 26) · Boring Seminar · Notes: Negative
      // DIFFERENTIATE — D-tradeoff. Attendance is its own alibi.
      id: "card.networking.boring-seminar",
      nameKey: "deadlineDash.card.networkingBoringSeminar.name",
      displayName: "Boring Seminar",
      flavorText: "The closing slide was announced well before the session closed.",
      polarity: "negative",
      effects: [
        { type: "modifyResource", resource: "energy", amount: -2, clampAtZero: true, target: "self" },
        { type: "modifyHeat", amount: -1, target: "self" },
      ],
    },
    {
      // row 26 (xlsx row 27) · Office Rumor · Notes: Negative
      // KEEP — networking aggression 1 of 12. The deck's hardest single hit.
      id: "card.networking.office-rumor",
      nameKey: "deadlineDash.card.networkingOfficeRumor.name",
      displayName: "Circulated Rumor",
      flavorText: "You repeated something about their promotion that you did not check.",
      polarity: "negative",
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
      // row 27 (xlsx row 28) · Coffee Spill · Notes: Negative
      // KEEP — networking aggression 2 of 12; holds the
      // energy-1-at-chosen-opponent-with-heat slot 1 of 3.
      id: "card.networking.coffee-spill",
      nameKey: "deadlineDash.card.networkingCoffeeSpill.name",
      displayName: "Coffee Spill",
      flavorText: "You walked into them at the machine and their cup did not survive.",
      polarity: "negative",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 28 (xlsx row 29) · Stolen Spotlight · Notes: Negative
      // KEEP — networking aggression 3 of 12. The deck's only true steal;
      // `direction` is left at its `target-to-actor` default.
      id: "card.networking.stolen-spotlight",
      nameKey: "deadlineDash.card.networkingStolenSpotlight.name",
      displayName: "Stolen Spotlight",
      flavorText: "You clarified in the meeting that the idea had been yours.",
      polarity: "negative",
      effects: [
        {
          type: "transferResource",
          resource: "reputation",
          amount: 1,
          target: "chosen-opponent",
          insufficientFunds: "transfer-up-to-available",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 29 (xlsx row 30) · Recruiter Poached · Notes: Negative
      // KEEP — networking aggression 4 of 12.
      id: "card.networking.recruiter-poached",
      nameKey: "deadlineDash.card.networkingRecruiterPoached.name",
      displayName: "Recruiter Poached",
      flavorText: "You passed their name to an agency and the release fee fell to them.",
      polarity: "negative",
      effects: [
        {
          type: "payResource",
          resource: "money",
          amount: 300,
          insufficientFunds: "pay-up-to-available",
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 30 (xlsx row 31) · Embarrassing Story · Notes: Negative
      // KEEP — networking aggression 5 of 12; holds the
      // reputation-1-at-chosen-opponent-with-heat slot 2 of 3.
      id: "card.networking.embarrassing-story",
      nameKey: "deadlineDash.card.networkingEmbarrassingStory.name",
      displayName: "Embarrassing Story",
      flavorText: "You retold the incident with the reply-all in front of the floor.",
      polarity: "negative",
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
      // row 31 (xlsx row 32) · Loud Speaker · Notes: Negative
      // KEEP — networking aggression 6 of 12; holds the
      // reputation-1-at-chosen-opponent-with-heat slot 3 of 3. The deck is at its
      // in-deck limit of two for that signature, so nothing else may take it.
      id: "card.networking.loud-speaker",
      nameKey: "deadlineDash.card.networkingLoudSpeaker.name",
      displayName: "Loud Speaker",
      flavorText: "Your microphone was open while you were talking about them.",
      polarity: "negative",
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
      // row 32 (xlsx row 33) · Reply All · Notes: Negative
      // DIFFERENTIATE — B-target, networking aggression 7 of 12. The name demands
      // `all-opponents`, and a table-wide hit the actor is exempt from is aimed,
      // so it pays the doubled rate. Flavor rewritten: the old line said "them"
      // singular, which the new target makes false.
      id: "card.networking.reply-all",
      nameKey: "deadlineDash.card.networkingReplyAll.name",
      displayName: "Reply All",
      flavorText: "You answered the whole distribution list and left nobody off it.",
      polarity: "negative",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "all-opponents",
          preventable: true,
        },
        { type: "modifyHeat", amount: 2, target: "self" },
      ],
    },
    {
      // row 33 (xlsx row 34) · Camera Still On · Notes: Negative
      // DIFFERENTIATE — B-target, networking aggression 8 of 12. Two axes on one
      // victim, which is what separates it from the deck's other
      // chosen-opponent cards.
      id: "card.networking.camera-still-on",
      nameKey: "deadlineDash.card.networkingCameraStillOn.name",
      displayName: "Camera Still On",
      flavorText: "You stayed on the call and left their feed running afterward.",
      polarity: "negative",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: -1,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 34 (xlsx row 35) · Mute Button · Notes: Negative · Duration: Next Networking
      // KEEP — networking aggression 9 of 12. `status.skip-next-networking-reward`
      // must drop only the *positive* effects of the victim's next networking
      // card; dropping everything makes the attack backfire half the time.
      id: "card.networking.mute-button",
      nameKey: "deadlineDash.card.networkingMuteButton.name",
      displayName: "Mute Button",
      flavorText: "You closed their microphone ahead of their turn and left it.",
      polarity: "negative",
      effects: [
        {
          type: "applyStatus",
          statusId: "status.skip-next-networking-reward",
          duration: { kind: "uses", count: 1 },
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 35 (xlsx row 36) · Passive Aggressive Email · Notes: Negative
      // KEEP — networking aggression 10 of 12; holds the
      // energy-1-at-chosen-opponent-with-heat slot 2 of 3.
      id: "card.networking.passive-aggressive-email",
      nameKey: "deadlineDash.card.networkingPassiveAggressiveEmail.name",
      displayName: "Passive Aggressive Email",
      flavorText: "A follow-up reached their inbox with the earlier thread attached.",
      polarity: "negative",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: -1,
          clampAtZero: true,
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 36 (xlsx row 37) · Buzzword Overload · Notes: Mixed
      // Previously unauthorable; unblocked by `chooseOne`. Self-only, so the
      // chooser is left at its `"self"` default.
      id: "card.networking.buzzword-overload",
      nameKey: "deadlineDash.card.networkingBuzzwordOverload.name",
      displayName: "Jargon-Heavy Session",
      flavorText: "The session ran entirely in terms nobody defined.",
      polarity: "mixed",
      effects: [
        {
          type: "chooseOne",
          options: [
            {
              id: "impress",
              label: "Match the register",
              effects: [{ type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true }],
            },
            {
              id: "endure",
              label: "Sit it out",
              effects: [{ type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true }],
            },
          ],
        },
      ],
    },
    {
      // row 38 (xlsx row 39) · Open to Work · Notes: Mixed
      // Previously unauthorable; unblocked by `chooseOne`. The reputation arm is
      // conditional, so it never grants an unconditional +2.
      id: "card.networking.open-to-work",
      nameKey: "deadlineDash.card.networkingOpenToWork.name",
      displayName: "Availability Noted",
      flavorText: "You let a few contacts know you would take a call.",
      polarity: "mixed",
      effects: [
        {
          type: "chooseOne",
          options: [
            {
              id: "offer",
              label: "Take the offer",
              effects: [{ type: "modifyResource", resource: "money", amount: 200, clampAtZero: true }],
            },
            {
              id: "profile",
              label: "Leave the profile up",
              effects: [
                {
                  type: "modifyResource",
                  resource: "reputation",
                  amount: 2,
                  clampAtZero: true,
                  condition: { kind: "rankIndexAtMost", who: "target", index: 3 },
                },
              ],
            },
          ],
        },
      ],
    },
    {
      // row 39 (xlsx row 40) · Coffee Machine Gossip · Notes: Mixed
      // Previously unauthorable; unblocked by `chooseOne` plus `chooser`, which
      // exists for exactly this card: the workbook does not say who picks the
      // branch, and "drawer picks" and "target picks the lesser evil" are
      // different cards. Aimed, so it carries heat — and it is the deck's
      // thirteenth aimed card against a target of twelve, a recorded deviation.
      // The hostile arm is deliberately not marked `preventable`: the rule for
      // marking an option's effects preventable is undecided.
      id: "card.networking.coffee-machine-gossip",
      nameKey: "deadlineDash.card.networkingCoffeeMachineGossip.name",
      displayName: "Overheard At The Machine",
      flavorText: "You brought their name up where they could hear it.",
      polarity: "mixed",
      effects: [
        {
          type: "chooseOne",
          chooser: "chosen-opponent",
          options: [
            {
              id: "deny",
              label: "Deny it",
              effects: [
                {
                  type: "modifyResource",
                  resource: "reputation",
                  amount: -1,
                  clampAtZero: true,
                  target: "chosen-opponent",
                },
              ],
            },
            {
              id: "concede",
              label: "Let it stand",
              effects: [
                { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true, target: "self" },
              ],
            },
          ],
        },
        { type: "modifyHeat", amount: 1, target: "self" },
      ],
    },
    {
      // row 40 (xlsx row 41) · Team Building Games · Notes: Mixed
      // KEEP — unaimed: the actor is the only one who pays, so no heat.
      id: "card.networking.team-building-games",
      nameKey: "deadlineDash.card.networkingTeamBuildingGames.name",
      displayName: "Team Building Games",
      flavorText: "Mandatory trust exercises, logged as a morale investment.",
      polarity: "mixed",
      effects: [
        {
          type: "modifyResource",
          resource: "energy",
          amount: 1,
          clampAtZero: true,
          clampAtMaximum: true,
          target: "all-opponents",
        },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true, target: "self" },
      ],
    },
    {
      // row 41 (xlsx row 42) · Conference Selfie · Notes: Positive Global
      // DIFFERENTIATE — B-target. A fixed-relation neighbour instead of the whole
      // table, which actually moves two players relative to the rest. Unaimed, so
      // no heat.
      id: "card.networking.conference-selfie",
      nameKey: "deadlineDash.card.networkingConferenceSelfie.name",
      displayName: "Conference Selfie",
      flavorText: "The photo went up with whoever happened to be standing beside you.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true, target: "self" },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true, target: "right-neighbour" },
      ],
    },
    {
      // row 42 (xlsx row 43) · Networking Overload · Notes: Negative Global
      // DIFFERENTIATE — B-target. The drawer takes the larger share, which is what
      // makes it unaimed pressure rather than an attack, so it carries no heat
      // despite sitting in a deck full of aimed cards.
      id: "card.networking.networking-overload",
      nameKey: "deadlineDash.card.networkingNetworkingOverload.name",
      displayName: "Networking Overload",
      flavorText: "The room ran out of conversation before it ran out of time.",
      polarity: "negative",
      // Written as a table-wide cost the drawer eats too (`@all-players`) plus a
      // second point on themselves, not as `@all-opponents`. The numbers are
      // identical — drawer -2, everyone else -1 — but §5.1 says the heat rule
      // keys off the *effect*, and `@all-opponents` is the shape that means
      // "the actor is exempt", which is exactly what this card is not. Encoded
      // the old way an automated heat audit reads it as free aggression.
      effects: [
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true, target: "all-players" },
        { type: "modifyResource", resource: "energy", amount: -1, clampAtZero: true, target: "self" },
      ],
    },
    {
      // row 43 (xlsx row 44) · HR Takes Attendance · Notes: Positive Global
      // DIFFERENTIATE — A-condition. `who: "target"` means each player is tested
      // individually, so only the ones not already under review are credited.
      // `not(heatAtLeast(1))` is the closed grammar's spelling of "no heat".
      id: "card.networking.hr-takes-attendance",
      nameKey: "deadlineDash.card.networkingHrTakesAttendance.name",
      displayName: "HR Takes Attendance",
      flavorText: "Attendance was taken at the door and cross-checked with open reviews.",
      polarity: "positive",
      effects: [
        {
          type: "modifyResource",
          resource: "reputation",
          amount: 1,
          clampAtZero: true,
          target: "all-players",
          condition: { kind: "not", of: { kind: "heatAtLeast", who: "target", value: 1 } },
        },
      ],
    },
    {
      // row 44 (xlsx row 45) · After Party · Notes: Positive
      // KEEP — unchanged.
      id: "card.networking.after-party",
      nameKey: "deadlineDash.card.networkingAfterParty.name",
      displayName: "Post-Seminar Drinks",
      flavorText: "The useful part of the evening started after the program closed.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "energy", amount: 2, clampAtZero: true, clampAtMaximum: true },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      // row 45 (xlsx row 46) · Corporate Bingo Champion · Notes: Positive
      // DIFFERENTIATE — G-conversion. Holds the money+100 | reputation+1 slot 3 of 3.
      id: "card.networking.corporate-bingo-champion",
      nameKey: "deadlineDash.card.networkingCorporateBingoChampion.name",
      displayName: "Corporate Bingo Champion",
      flavorText: "You called every buzzword on the card before the break.",
      polarity: "positive",
      effects: [
        { type: "modifyResource", resource: "money", amount: 100, clampAtZero: true },
        { type: "modifyResource", resource: "reputation", amount: 1, clampAtZero: true },
      ],
    },
    {
      // row 46 (xlsx row 47) · "Can Everyone Hear Me?" · Notes: Negative
      // DIFFERENTIATE — B-target, networking aggression 11 of 12. A lost turn is
      // one of the swings priced at the doubled heat rate. `source: "card"` is the
      // widened field; the pre-v2 vocabulary only admitted `"tile"`.
      id: "card.networking.can-everyone-hear-me",
      nameKey: "deadlineDash.card.networkingCanEveryoneHearMe.name",
      displayName: "Left On Mute",
      flavorText: "You let them keep talking without saying the line was closed.",
      polarity: "negative",
      effects: [
        {
          type: "skipTurns",
          count: 1,
          source: "card",
          target: "chosen-opponent",
          preventable: true,
        },
        { type: "modifyHeat", amount: 2, target: "self" },
      ],
    },
  ],
} as const satisfies DeckConfig;
