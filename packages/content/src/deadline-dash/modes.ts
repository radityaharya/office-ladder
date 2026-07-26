import type { ModeConfig, ModeId } from "../schema";

/**
 * The scoring block shared by every score-resolved mode. Identical to the
 * marathon endgame that already shipped, so `mode.standard` and `mode.campaign`
 * resolve on the same rank/money/reputation basis rather than inventing a
 * second scale.
 */
const SCORE_RESOLVED_ENDGAME = {
  type: "additional-rounds",
  rounds: 3,
  clockExhaustionStillEndsMatch: true,
  scoring: {
    rankTierPoints: 1000,
    moneyMultiplier: 0.1,
    reputationPoints: 50,
  },
} as const;

const UNPLAYTESTED_RULES_NOTE =
  "The `rules` block is authored from the gameplay-v2 spec (plans/24-gameplay-v2-spec.md §4.2), not from the design workbook: every tunable in it is a first-pass value and unplaytested.";

const NO_DIRECT_MESSAGES_NOTE =
  "`social.directMessages` is false in every shipped preset by design (spec §8.1): private channels are an abuse surface and a moderation obligation, so the field exists as an off switch, not as a v1 feature.";

/**
 * Values for a subsystem a mode switches **off** are deliberately neutral
 * rather than plausible-if-enabled: 0 for counts and charges, 1 for multipliers,
 * `"none"` for the policy enums. If a mechanic ever reads a tunable without
 * first checking its enablement flag, a neutral value degrades to a no-op
 * instead of silently switching the mechanic on.
 *
 * The exception is a *threshold* or a *duration* — `quarters.count`,
 * `quarters.roundsEach`, `projects.deadlineRounds`, `conflict.heatThreshold`.
 * Zero is not inert for those: a heat threshold of 0 trips an investigation on
 * the first attack, and a project deadline of 0 rounds fails on creation. They
 * carry their minimum legal value instead, which is also what keeps every
 * preset inside `MODE_RULES_BOUNDS` in
 * `packages/contracts/src/mode-rules.ts` — a preset a lobby cannot re-save as a
 * custom ruleset would be a bug in the preset, not in the validator.
 */
const DISABLED_UPKEEP_LADDER = [0, 0, 0, 0, 0, 0, 0, 0, 0] as const;

export const deadlineDashModes = {
  "mode.quick": {
    id: "mode.quick",
    displayNameKey: "deadlineDash.mode.quick.name",
    targetDurationMinutes: [20, 30],
    turnTimerSeconds: 20,
    startingResources: {
      money: 1000,
      reputation: 0,
      energy: 8,
      energyMaximum: 8,
      workCounter: 0,
    },
    startingTokens: { move: 1 },
    handLimit: 1,
    tokenCaps: {
      move: 3,
      momentum: 3,
      reputation: 2,
      money: 2,
    },
    deckQuantities: {
      "deck.work": 25,
      "deck.meeting": 15,
      "deck.event": 15,
      "deck.networking": 24,
      "deck.board-meeting": 13,
      "deck.annual-event": 13,
    },
    clockDeck: {
      deckIds: ["deck.meeting", "deck.event"],
      quantities: { meeting: 15, event: 15, total: 30 },
      provisional: true,
      source: "plans/01-product-scope-and-rules-decisions.md#clock-deck",
    },
    endgame: { type: "immediate" },
    rules: {
      winShape: "race",
      quarters: { enabled: false, count: 1, roundsEach: 1, globalEvents: false },
      winPaths: {
        promotion: true,
        wealth: false,
        influence: false,
        survival: false,
      },
      economy: {
        upkeepEnabled: false,
        upkeepByRankIndex: DISABLED_UPKEEP_LADDER,
        loansEnabled: false,
        maxLoanPrincipal: 0,
        interestBasisPoints: 0,
        bankruptcy: "none",
        incomeStreamsEnabled: false,
      },
      board: {
        ownershipEnabled: false,
        claimCostMultiplier: 1,
        tollMultiplier: 1,
        upgradesEnabled: false,
        placementsEnabled: false,
        maxPlacementsPerPlayer: 0,
      },
      projects: {
        enabled: false,
        maxConcurrentPerPlayer: 0,
        joinable: false,
        sabotageable: false,
        deadlineRounds: 1,
      },
      conflict: {
        targetedAttacks: false,
        heatEnabled: false,
        heatPerAttack: 0,
        heatThreshold: 1,
        defenceEnabled: false,
        leaderProtection: "none",
        elimination: false,
      },
      agency: {
        promotionIsChoice: true,
        promotionRaisesUpkeep: false,
        diceAdjustEnabled: true,
        energyPerPip: 1,
        maxPipAdjust: 2,
        freeActionsPerTurn: 1,
        handEnabled: true,
      },
      interaction: {
        reactionWindows: true,
        reactionWindowSeconds: 10,
        votesEnabled: false,
        auctionsEnabled: false,
        tradesEnabled: false,
        promisesRecorded: false,
      },
      hidden: {
        rolesEnabled: false,
        roleWinConditions: false,
        secretObjectives: false,
        hiddenHands: false,
      },
      social: { chat: "quick", emoteReactions: true, directMessages: false },
      timers: { turnSeconds: 20, onTimeout: "auto-roll", chessClockSeconds: null },
      bots: { pacing: "paced", thinkMsRange: [400, 1200], canNegotiate: false },
    },
    sourceNotes: [
      "Clock quantities are the proposed alpha defaults and require playtesting approval.",
      "Per-token caps use the detailed GDD token table (3/3/2/2), not the simplified mode table's '3 per type'.",
      UNPLAYTESTED_RULES_NOTE,
      NO_DIRECT_MESSAGES_NOTE,
      "Quick keeps only the cheap depth (hand, reaction windows, promotion-as-choice, dice adjust). Ownership, projects, loans, roles and auctions are off so a 20-30 minute match still resolves as a race.",
    ],
  },
  "mode.standard": {
    id: "mode.standard",
    displayNameKey: "deadlineDash.mode.standard.name",
    targetDurationMinutes: [40, 60],
    turnTimerSeconds: 25,
    startingResources: {
      money: 1200,
      reputation: 0,
      energy: 8,
      energyMaximum: 8,
      workCounter: 0,
    },
    startingTokens: { move: 1 },
    handLimit: 2,
    tokenCaps: {
      move: 4,
      momentum: 4,
      reputation: 3,
      money: 3,
    },
    deckQuantities: {
      "deck.work": 38,
      "deck.meeting": 22,
      "deck.event": 22,
      "deck.networking": 36,
      "deck.board-meeting": 19,
      "deck.annual-event": 19,
    },
    clockDeck: {
      deckIds: ["deck.meeting", "deck.event"],
      quantities: { meeting: 22, event: 22, total: 44 },
      provisional: true,
      source: "plans/01-product-scope-and-rules-decisions.md#clock-deck",
    },
    endgame: SCORE_RESOLVED_ENDGAME,
    rules: {
      winShape: "fixed-length",
      quarters: { enabled: true, count: 4, roundsEach: 4, globalEvents: true },
      winPaths: {
        promotion: true,
        wealth: true,
        influence: true,
        survival: false,
      },
      economy: {
        upkeepEnabled: true,
        upkeepByRankIndex: [0, 50, 75, 100, 150, 200, 250, 300, 400],
        loansEnabled: true,
        maxLoanPrincipal: 3000,
        interestBasisPoints: 1000,
        bankruptcy: "demote",
        incomeStreamsEnabled: true,
      },
      board: {
        ownershipEnabled: true,
        claimCostMultiplier: 1,
        tollMultiplier: 1,
        upgradesEnabled: true,
        placementsEnabled: true,
        maxPlacementsPerPlayer: 2,
      },
      projects: {
        enabled: true,
        maxConcurrentPerPlayer: 2,
        joinable: true,
        sabotageable: true,
        deadlineRounds: 3,
      },
      conflict: {
        targetedAttacks: true,
        heatEnabled: true,
        heatPerAttack: 1,
        heatThreshold: 3,
        defenceEnabled: true,
        leaderProtection: "soft",
        elimination: false,
      },
      agency: {
        promotionIsChoice: true,
        promotionRaisesUpkeep: true,
        diceAdjustEnabled: true,
        energyPerPip: 1,
        maxPipAdjust: 2,
        freeActionsPerTurn: 1,
        handEnabled: true,
      },
      interaction: {
        reactionWindows: true,
        reactionWindowSeconds: 12,
        votesEnabled: true,
        auctionsEnabled: true,
        tradesEnabled: true,
        promisesRecorded: true,
      },
      hidden: {
        rolesEnabled: true,
        roleWinConditions: false,
        secretObjectives: true,
        hiddenHands: true,
      },
      social: { chat: "full", emoteReactions: true, directMessages: false },
      timers: { turnSeconds: 25, onTimeout: "best-move", chessClockSeconds: null },
      bots: { pacing: "paced", thinkMsRange: [500, 1600], canNegotiate: true },
    },
    sourceNotes: [
      "New in gameplay v2 and the intended default mode. Nothing about it comes from the design workbook — duration, timer, starting money, hand limit, token caps and deck quantities are all interpolated between the shipped quick and marathon presets and are unplaytested.",
      "Clock quantities are derived (marathon x 0.75, rounded) rather than authored, and require playtesting approval.",
      UNPLAYTESTED_RULES_NOTE,
      NO_DIRECT_MESSAGES_NOTE,
      "Everything is on except `conflict.elimination`, `social.directMessages` and `hidden.roleWinConditions`, per spec §4.2.",
      "`winPaths.survival` is false because it is only meaningful where a player can actually be removed: this mode has `elimination: false` and `bankruptcy: 'demote'`, so nobody is ever last-standing.",
      "`endgame` reuses the marathon score-resolved block. A fixed-length match ends on quarters elapsing, so the three additional rounds and the clock-exhaustion fallback are a safety valve rather than the primary trigger.",
    ],
  },
  "mode.marathon": {
    id: "mode.marathon",
    displayNameKey: "deadlineDash.mode.marathon.name",
    targetDurationMinutes: [60, 120],
    turnTimerSeconds: 30,
    startingResources: {
      money: 1500,
      reputation: 0,
      energy: 8,
      energyMaximum: 8,
      workCounter: 0,
    },
    startingTokens: { move: 1 },
    handLimit: 3,
    tokenCaps: {
      move: 5,
      momentum: 5,
      reputation: 3,
      money: 4,
    },
    // Capped at each deck's real physical size (designs × `copies`). A quantity
    // above it does not fail loudly — `buildDecks` cycles the pool — it just
    // silently reprints the same cards, which is the rarity curve lying.
    deckQuantities: {
      "deck.work": 50,
      "deck.meeting": 30,
      "deck.event": 30,
      "deck.networking": 47,
      "deck.board-meeting": 23,
      "deck.annual-event": 24,
    },
    clockDeck: {
      deckIds: ["deck.meeting", "deck.event"],
      quantities: { meeting: 30, event: 30, total: 60 },
      provisional: true,
      source: "plans/01-product-scope-and-rules-decisions.md#clock-deck",
    },
    endgame: {
      type: "additional-rounds",
      rounds: 3,
      clockExhaustionStillEndsMatch: true,
      scoring: {
        rankTierPoints: 1000,
        moneyMultiplier: 0.1,
        reputationPoints: 50,
      },
    },
    rules: {
      winShape: "fixed-length",
      quarters: { enabled: true, count: 4, roundsEach: 6, globalEvents: true },
      winPaths: {
        promotion: true,
        wealth: true,
        influence: true,
        survival: true,
      },
      economy: {
        upkeepEnabled: true,
        upkeepByRankIndex: [0, 75, 100, 150, 200, 275, 350, 450, 600],
        loansEnabled: true,
        maxLoanPrincipal: 5000,
        interestBasisPoints: 1000,
        bankruptcy: "eliminate",
        incomeStreamsEnabled: true,
      },
      board: {
        ownershipEnabled: true,
        claimCostMultiplier: 1,
        tollMultiplier: 1,
        upgradesEnabled: true,
        placementsEnabled: true,
        maxPlacementsPerPlayer: 3,
      },
      projects: {
        enabled: true,
        maxConcurrentPerPlayer: 2,
        joinable: true,
        sabotageable: true,
        deadlineRounds: 4,
      },
      conflict: {
        targetedAttacks: true,
        heatEnabled: true,
        heatPerAttack: 1,
        heatThreshold: 3,
        defenceEnabled: true,
        leaderProtection: "soft",
        elimination: true,
      },
      agency: {
        promotionIsChoice: true,
        promotionRaisesUpkeep: true,
        diceAdjustEnabled: true,
        energyPerPip: 1,
        maxPipAdjust: 3,
        freeActionsPerTurn: 1,
        handEnabled: true,
      },
      interaction: {
        reactionWindows: true,
        reactionWindowSeconds: 15,
        votesEnabled: true,
        auctionsEnabled: true,
        tradesEnabled: true,
        promisesRecorded: true,
      },
      hidden: {
        rolesEnabled: true,
        roleWinConditions: true,
        secretObjectives: true,
        hiddenHands: true,
      },
      social: { chat: "full", emoteReactions: true, directMessages: false },
      timers: { turnSeconds: 30, onTimeout: "best-move", chessClockSeconds: null },
      bots: { pacing: "paced", thinkMsRange: [600, 2000], canNegotiate: true },
    },
    sourceNotes: [
      "Clock quantities are the proposed alpha defaults and require playtesting approval.",
      "Clock exhaustion during the three additional rounds remains enabled per the proposed rules baseline.",
      "Per-token caps use the detailed GDD token table (5/5/3/4), not the simplified mode table's '5 per type'.",
      UNPLAYTESTED_RULES_NOTE,
      NO_DIRECT_MESSAGES_NOTE,
      "The only preset with `conflict.elimination` and `bankruptcy: 'eliminate'` on, which is also what makes `winPaths.survival` meaningful here: a last-standing outcome is reachable.",
    ],
  },
  "mode.campaign": {
    id: "mode.campaign",
    displayNameKey: "deadlineDash.mode.campaign.name",
    targetDurationMinutes: [120, 240],
    turnTimerSeconds: 45,
    startingResources: {
      money: 2000,
      reputation: 0,
      energy: 8,
      energyMaximum: 8,
      workCounter: 0,
    },
    startingTokens: { move: 1, momentum: 1 },
    handLimit: 4,
    tokenCaps: {
      move: 6,
      momentum: 6,
      reputation: 4,
      money: 5,
    },
    // Capped at each deck's real physical size — see `mode.marathon`. Campaign
    // asked for more cards than the pack has in four of six decks.
    deckQuantities: {
      "deck.work": 55,
      "deck.meeting": 38,
      "deck.event": 38,
      "deck.networking": 49,
      "deck.board-meeting": 23,
      "deck.annual-event": 24,
    },
    clockDeck: {
      deckIds: ["deck.meeting", "deck.event"],
      quantities: { meeting: 38, event: 38, total: 76 },
      provisional: true,
      source: "plans/01-product-scope-and-rules-decisions.md#clock-deck",
    },
    endgame: SCORE_RESOLVED_ENDGAME,
    rules: {
      winShape: "objectives",
      quarters: { enabled: true, count: 8, roundsEach: 4, globalEvents: true },
      winPaths: {
        promotion: true,
        wealth: true,
        influence: true,
        survival: false,
      },
      economy: {
        upkeepEnabled: true,
        upkeepByRankIndex: [0, 100, 150, 200, 275, 350, 450, 575, 750],
        loansEnabled: true,
        maxLoanPrincipal: 8000,
        interestBasisPoints: 1200,
        bankruptcy: "demote",
        incomeStreamsEnabled: true,
      },
      board: {
        ownershipEnabled: true,
        claimCostMultiplier: 1.25,
        tollMultiplier: 1.25,
        upgradesEnabled: true,
        placementsEnabled: true,
        maxPlacementsPerPlayer: 4,
      },
      projects: {
        enabled: true,
        maxConcurrentPerPlayer: 3,
        joinable: true,
        sabotageable: true,
        deadlineRounds: 5,
      },
      conflict: {
        targetedAttacks: true,
        heatEnabled: true,
        heatPerAttack: 1,
        heatThreshold: 4,
        defenceEnabled: true,
        leaderProtection: "soft",
        elimination: false,
      },
      agency: {
        promotionIsChoice: true,
        promotionRaisesUpkeep: true,
        diceAdjustEnabled: true,
        energyPerPip: 1,
        maxPipAdjust: 3,
        freeActionsPerTurn: 2,
        handEnabled: true,
      },
      interaction: {
        reactionWindows: true,
        reactionWindowSeconds: 20,
        votesEnabled: true,
        auctionsEnabled: true,
        tradesEnabled: true,
        promisesRecorded: true,
      },
      hidden: {
        rolesEnabled: true,
        roleWinConditions: true,
        secretObjectives: true,
        hiddenHands: true,
      },
      social: { chat: "full", emoteReactions: true, directMessages: false },
      timers: { turnSeconds: 45, onTimeout: "best-move", chessClockSeconds: null },
      bots: { pacing: "paced", thinkMsRange: [800, 2500], canNegotiate: true },
    },
    sourceNotes: [
      "New in gameplay v2 and the longest preset. Nothing about it comes from the design workbook — duration, timer, starting resources, hand limit and token caps are all extrapolated past marathon and are unplaytested.",
      "Deck and clock quantities are derived (marathon x 1.25, rounded to whole cards) rather than authored, and require playtesting approval.",
      UNPLAYTESTED_RULES_NOTE,
      NO_DIRECT_MESSAGES_NOTE,
      "The only preset with `winShape: 'objectives'`: the match resolves on objective completion, with secret objectives, role win conditions, hidden hands and auctions all on per spec §4.2.",
      "`conflict.elimination` is off despite everything else being on: removing a player from a two-to-four-hour social match leaves them spectating for hours, which is a worse outcome than a demotion.",
      "`endgame` reuses the marathon score-resolved block so that a campaign that runs out of quarters without an objective win still has a defined winner.",
    ],
  },
} as const satisfies Record<ModeId, ModeConfig>;
