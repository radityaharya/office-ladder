import type { RankConfig } from "../schema";

export const deadlineDashRanks = [
  {
    id: "rank.intern",
    tier: 1,
    displayNameKey: "deadlineDash.rank.intern.name",
    salary: 200,
    promotionFromPrevious: null,
    benefits: [],
  },
  {
    id: "rank.staff",
    tier: 2,
    displayNameKey: "deadlineDash.rank.staff.name",
    salary: 400,
    promotionFromPrevious: {
      moneyCost: { "mode.quick": 250, "mode.marathon": 500 },
      reputationRequired: 3,
    },
    benefits: [{ type: "salaryBonusOnReceptionistPass", amount: 100 }],
  },
  {
    id: "rank.senior-staff",
    tier: 3,
    displayNameKey: "deadlineDash.rank.seniorStaff.name",
    salary: 600,
    promotionFromPrevious: {
      moneyCost: { "mode.quick": 600, "mode.marathon": 1200 },
      reputationRequired: 5,
    },
    benefits: [
      {
        type: "extraWorkMilestoneReward",
        milestone: 5,
        effects: [
          { type: "modifyResource", resource: "reputation", amount: 1 },
        ],
      },
    ],
    sourceNotes: [
      "The GDD says 'Work tile ke-5'; encoded as the fifth cumulative Work landing, pending confirmation whether it repeats at later milestones.",
    ],
  },
  {
    id: "rank.supervisor",
    tier: 4,
    displayNameKey: "deadlineDash.rank.supervisor.name",
    salary: 800,
    promotionFromPrevious: {
      moneyCost: { "mode.quick": 1000, "mode.marathon": 2000 },
      reputationRequired: 7,
    },
    benefits: [{ type: "increaseMaximumEnergy", amount: 2 }],
  },
  {
    id: "rank.assistant-manager",
    tier: 5,
    displayNameKey: "deadlineDash.rank.assistantManager.name",
    salary: 1000,
    promotionFromPrevious: {
      moneyCost: { "mode.quick": 1500, "mode.marathon": 3000 },
      reputationRequired: 9,
    },
    benefits: [{ type: "rerollNormalMovement", usesPerLap: 1 }],
  },
  {
    id: "rank.manager",
    tier: 6,
    displayNameKey: "deadlineDash.rank.manager.name",
    salary: 1200,
    promotionFromPrevious: {
      moneyCost: { "mode.quick": 2250, "mode.marathon": 4500 },
      reputationRequired: 11,
    },
    benefits: [
      {
        type: "meetingLandingBonus",
        effects: [
          { type: "modifyResource", resource: "reputation", amount: 1 },
        ],
      },
    ],
  },
  {
    id: "rank.senior-manager",
    tier: 7,
    displayNameKey: "deadlineDash.rank.seniorManager.name",
    salary: 1400,
    promotionFromPrevious: {
      moneyCost: { "mode.quick": 3000, "mode.marathon": 6000 },
      reputationRequired: 13,
    },
    benefits: [{ type: "multiplyAnnualEventReward", multiplier: 2 }],
    sourceNotes: [
      "Only positive Annual Event rewards are intended to double; treatment of negative or mixed effects remains release-blocking in the rules plan.",
    ],
  },
  {
    id: "rank.general-manager",
    tier: 8,
    displayNameKey: "deadlineDash.rank.generalManager.name",
    salary: 1600,
    promotionFromPrevious: {
      moneyCost: { "mode.quick": 4000, "mode.marathon": 8000 },
      reputationRequired: 15,
    },
    benefits: [
      {
        type: "ignoreNegativeEffect",
        usesPerLap: 1,
        sources: ["tile", "card"],
      },
    ],
  },
  {
    id: "rank.director",
    tier: 9,
    displayNameKey: "deadlineDash.rank.director.name",
    salary: 2000,
    promotionFromPrevious: {
      moneyCost: { "mode.quick": 5000, "mode.marathon": 10000 },
      reputationRequired: 17,
    },
    benefits: [{ type: "directorOutcome" }],
  },
] as const satisfies readonly RankConfig[];
