import type { ModeConfig, ModeId } from "../schema";

export const deadlineDashModes = {
  "mode.quick": {
    id: "mode.quick",
    displayNameKey: "deadlineDash.mode.quick.name",
    targetDurationMinutes: [20, 30],
    turnTimerSeconds: 20,
    startingResources: {
      money: 1000,
      reputation: 0,
      energy: 5,
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
    sourceNotes: [
      "Clock quantities are the proposed alpha defaults and require playtesting approval.",
      "Per-token caps use the detailed GDD token table (3/3/2/2), not the simplified mode table's '3 per type'.",
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
      energy: 5,
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
    deckQuantities: {
      "deck.work": 50,
      "deck.meeting": 30,
      "deck.event": 30,
      "deck.networking": 47,
      "deck.board-meeting": 25,
      "deck.annual-event": 25,
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
    sourceNotes: [
      "Clock quantities are the proposed alpha defaults and require playtesting approval.",
      "Clock exhaustion during the three additional rounds remains enabled per the proposed rules baseline.",
      "Per-token caps use the detailed GDD token table (5/5/3/4), not the simplified mode table's '5 per type'.",
    ],
  },
} as const satisfies Record<ModeId, ModeConfig>;
