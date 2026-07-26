import type { RankConfig } from "../schema";

/**
 * `RankCostByMode` is `Record<ModeId, number>`, so adding `mode.standard` and
 * `mode.campaign` forced a cost for both onto every promotable rank. Neither
 * number is authored: standard takes the marathon curve unchanged (it is the
 * same fixed-length shape at a shorter length, so the ladder's *slope* is what
 * matters and marathon's is the only one that has ever been costed), and
 * campaign is marathon x 1.25, which lands exactly on a multiple of 25 at every
 * rung so no rounding judgement was needed.
 *
 * Recorded on every rank that gained a column rather than in a single place,
 * because `sourceNotes` is per-rank and a reader looking at one rung's costs has
 * to be able to see that two of the four are derived.
 */
const DERIVED_MODE_COST_NOTE =
  "`mode.standard` and `mode.campaign` money costs are underived and unplaytested: standard copies `mode.marathon` unchanged, campaign is `mode.marathon` x 1.25. Neither came from the design workbook, which only ever costed quick and marathon.";

/**
 * The `reputationRequired` ladder is **3, 5, 8, 12, 18, 27, 40, 58** — geometric,
 * roughly x1.5 per rung, deliberately shaped like the money ladder rather than
 * against it.
 *
 * It used to be dead linear (3/5/7/9/11/13/15/17, +2 per rung) while money is
 * geometric (500 -> 10,000 in `mode.standard`, x1.4-x1.5 per rung). Measured
 * against the shipped board and card pack that meant reputation was co-binding
 * for three rungs and then completely slack: Director was reputation-reachable
 * around turn 47 and money-reachable around turn 201, so above `rank.supervisor`
 * reputation was not a win axis, it was a formality. A linear requirement
 * against a geometric cost cannot be anything else.
 *
 * With these numbers the ratio of reputation-limited turns to money-limited
 * turns across the ladder is 4.0, 2.0, 1.5, 1.3, 1.1, 1.1, 1.1, 1.15 — a real
 * gate at every rung and the *binding* gate at the top, with money staying the
 * mid-game constraint. The first rung stays at 3 on purpose: the on-ramp should
 * not be a wall.
 *
 * Two things a reader should know:
 * - `reputationRequired` is a **threshold, never spent**. `resolvePromotion`
 *   compares `reputation.value >= reputationRequired` and deducts money only.
 *   Making reputation spent would fix the ratchet at the root and is the cleaner
 *   design, but it changes promotion semantics everywhere; it was considered and
 *   declined, not missed.
 * - `packages/content/src/validation/deadline-dash.ts` mirrors this table. Both
 *   files change together or the content suite goes red.
 */
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
      moneyCost: {
        "mode.quick": 250,
        "mode.standard": 500,
        "mode.marathon": 500,
        "mode.campaign": 625,
      },
      reputationRequired: 3,
    },
    benefits: [{ type: "salaryBonusOnReceptionistPass", amount: 100 }],
    sourceNotes: [DERIVED_MODE_COST_NOTE],
  },
  {
    id: "rank.senior-staff",
    tier: 3,
    displayNameKey: "deadlineDash.rank.seniorStaff.name",
    salary: 600,
    promotionFromPrevious: {
      moneyCost: {
        "mode.quick": 600,
        "mode.standard": 1200,
        "mode.marathon": 1200,
        "mode.campaign": 1500,
      },
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
      DERIVED_MODE_COST_NOTE,
    ],
  },
  {
    id: "rank.supervisor",
    tier: 4,
    displayNameKey: "deadlineDash.rank.supervisor.name",
    salary: 800,
    promotionFromPrevious: {
      moneyCost: {
        "mode.quick": 1000,
        "mode.standard": 2000,
        "mode.marathon": 2000,
        "mode.campaign": 2500,
      },
      reputationRequired: 8,
    },
    benefits: [{ type: "increaseMaximumEnergy", amount: 2 }],
    sourceNotes: [DERIVED_MODE_COST_NOTE],
  },
  {
    id: "rank.assistant-manager",
    tier: 5,
    displayNameKey: "deadlineDash.rank.assistantManager.name",
    salary: 1000,
    promotionFromPrevious: {
      moneyCost: {
        "mode.quick": 1500,
        "mode.standard": 3000,
        "mode.marathon": 3000,
        "mode.campaign": 3750,
      },
      reputationRequired: 12,
    },
    benefits: [{ type: "rerollNormalMovement", usesPerLap: 1 }],
    sourceNotes: [DERIVED_MODE_COST_NOTE],
  },
  {
    id: "rank.manager",
    tier: 6,
    displayNameKey: "deadlineDash.rank.manager.name",
    salary: 1200,
    promotionFromPrevious: {
      moneyCost: {
        "mode.quick": 2250,
        "mode.standard": 4500,
        "mode.marathon": 4500,
        "mode.campaign": 5625,
      },
      reputationRequired: 18,
    },
    benefits: [
      {
        type: "meetingLandingBonus",
        effects: [
          { type: "modifyResource", resource: "reputation", amount: 1 },
        ],
      },
    ],
    sourceNotes: [DERIVED_MODE_COST_NOTE],
  },
  {
    id: "rank.senior-manager",
    tier: 7,
    displayNameKey: "deadlineDash.rank.seniorManager.name",
    salary: 1400,
    promotionFromPrevious: {
      moneyCost: {
        "mode.quick": 3000,
        "mode.standard": 6000,
        "mode.marathon": 6000,
        "mode.campaign": 7500,
      },
      reputationRequired: 27,
    },
    benefits: [{ type: "multiplyAnnualEventReward", multiplier: 2 }],
    sourceNotes: [
      "Only positive Annual Event rewards are intended to double; treatment of negative or mixed effects remains release-blocking in the rules plan.",
      DERIVED_MODE_COST_NOTE,
    ],
  },
  {
    id: "rank.general-manager",
    tier: 8,
    displayNameKey: "deadlineDash.rank.generalManager.name",
    salary: 1600,
    promotionFromPrevious: {
      moneyCost: {
        "mode.quick": 4000,
        "mode.standard": 8000,
        "mode.marathon": 8000,
        "mode.campaign": 10000,
      },
      reputationRequired: 40,
    },
    benefits: [
      {
        type: "ignoreNegativeEffect",
        usesPerLap: 1,
        sources: ["tile", "card"],
      },
    ],
    sourceNotes: [DERIVED_MODE_COST_NOTE],
  },
  {
    id: "rank.director",
    tier: 9,
    displayNameKey: "deadlineDash.rank.director.name",
    salary: 2000,
    promotionFromPrevious: {
      moneyCost: {
        "mode.quick": 5000,
        "mode.standard": 10000,
        "mode.marathon": 10000,
        "mode.campaign": 12500,
      },
      reputationRequired: 58,
    },
    benefits: [{ type: "directorOutcome" }],
    sourceNotes: [DERIVED_MODE_COST_NOTE],
  },
] as const satisfies readonly RankConfig[];
