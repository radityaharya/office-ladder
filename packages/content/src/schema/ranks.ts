import type { EffectDescriptor } from "./effects";
import type { ModeId, RankId } from "./ids";

export type RankBenefitDescriptor =
  | {
      readonly type: "salaryBonusOnReceptionistPass";
      readonly amount: 100;
    }
  | {
      readonly type: "extraWorkMilestoneReward";
      readonly milestone: 5;
      readonly effects: readonly EffectDescriptor[];
    }
  | {
      readonly type: "increaseMaximumEnergy";
      readonly amount: 2;
    }
  | {
      readonly type: "rerollNormalMovement";
      readonly usesPerLap: 1;
    }
  | {
      readonly type: "meetingLandingBonus";
      readonly effects: readonly EffectDescriptor[];
    }
  | {
      readonly type: "multiplyAnnualEventReward";
      readonly multiplier: 2;
    }
  | {
      readonly type: "ignoreNegativeEffect";
      readonly usesPerLap: 1;
      readonly sources: readonly ["tile", "card"];
    }
  | { readonly type: "directorOutcome" };

export type RankConfig = {
  readonly id: RankId;
  readonly tier: number;
  readonly displayNameKey: `deadlineDash.rank.${string}.name`;
  readonly salary: number;
  readonly promotionFromPrevious: null | {
    readonly moneyCost: Readonly<Record<ModeId, number>>;
    readonly reputationRequired: number;
  };
  readonly benefits: readonly RankBenefitDescriptor[];
  readonly sourceNotes?: readonly string[];
};
