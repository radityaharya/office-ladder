import type { CharacterConfig, CharacterId } from "../schema";

export const deadlineDashCharacters = {
  "character.workaholic": {
    id: "character.workaholic",
    displayNameKey: "deadlineDash.character.workaholic.name",
    loreKey: "deadlineDash.character.workaholic.lore",
    strengthKey: "deadlineDash.character.workaholic.strength",
    passive: { type: "workLandingMoneyBonus", amount: 50 },
    active: {
      cooldown: { unit: "laps", amount: 2 },
      effect: { type: "payToRestoreEnergy", moneyCost: 100 },
    },
  },
  "character.social-butterfly": {
    id: "character.social-butterfly",
    displayNameKey: "deadlineDash.character.socialButterfly.name",
    loreKey: "deadlineDash.character.socialButterfly.lore",
    strengthKey: "deadlineDash.character.socialButterfly.strength",
    passive: { type: "meetingLandingReputationBonus", amount: 1 },
    active: {
      cooldown: { unit: "laps", amount: 3 },
      effect: { type: "swapBoardPositions", target: "another-player" },
    },
    sourceNotes: [
      "The dedicated character section says swap positions; the promotion section instead says teleport to CEO's Office. This metadata follows the dedicated character definition and preserves the conflict here.",
    ],
  },
  "character.sales-star": {
    id: "character.sales-star",
    displayNameKey: "deadlineDash.character.salesStar.name",
    loreKey: "deadlineDash.character.salesStar.lore",
    strengthKey: "deadlineDash.character.salesStar.strength",
    passive: { type: "salaryMultiplier", multiplier: 1.2 },
    active: {
      cooldown: { unit: "laps", amount: 3 },
      effect: { type: "nextSalaryMultiplier", multiplier: 2 },
    },
  },
  "character.tech-genius": {
    id: "character.tech-genius",
    displayNameKey: "deadlineDash.character.techGenius.name",
    loreKey: "deadlineDash.character.techGenius.lore",
    strengthKey: "deadlineDash.character.techGenius.strength",
    passive: {
      type: "ignoreNegativeEffect",
      usesPerLap: 1,
      sources: ["tile", "card"],
    },
    active: {
      cooldown: { unit: "laps", amount: 3 },
      effect: {
        type: "teleport",
        destination: "any-board-tile",
        traversal: false,
      },
    },
  },
  "character.office-politician": {
    id: "character.office-politician",
    displayNameKey: "deadlineDash.character.officePolitician.name",
    loreKey: "deadlineDash.character.officePolitician.lore",
    strengthKey: "deadlineDash.character.officePolitician.strength",
    passive: {
      type: "modifyPromotionRequirement",
      resource: "reputation",
      amount: -1,
    },
    active: {
      cooldown: { unit: "laps", amount: 3 },
      effect: {
        type: "stealResource",
        resource: "reputation",
        amount: 2,
        target: "another-player",
        insufficientFunds: "transfer-up-to-available",
      },
    },
  },
  "character.lucky-employee": {
    id: "character.lucky-employee",
    displayNameKey: "deadlineDash.character.luckyEmployee.name",
    loreKey: "deadlineDash.character.luckyEmployee.lore",
    strengthKey: "deadlineDash.character.luckyEmployee.strength",
    passive: { type: "doublesMoneyBonus", amount: 100 },
    active: {
      cooldown: { unit: "turns", amount: 5 },
      effect: {
        type: "rerollDice",
        dice: "last-eligible-2d6",
        timing: "after-result",
      },
    },
    sourceNotes: [
      "The accepted rules restrict Lucky Employee rerolls to explicitly eligible operations; board checks are currently marked ineligible.",
    ],
  },
} as const satisfies Record<CharacterId, CharacterConfig>;
