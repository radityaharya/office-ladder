import type {
  DeckId,
  ResourceId,
  StatusId,
} from "./ids";

export type DiceSpec =
  | { readonly count: 1; readonly sides: 6 }
  | { readonly count: 2; readonly sides: 6 };

export type EffectDescriptor =
  | {
      readonly type: "drawCards";
      readonly deckId: DeckId;
      readonly count: number;
    }
  | {
      readonly type: "modifyResource";
      readonly resource: ResourceId;
      readonly amount: number;
      readonly clampAtZero?: boolean;
      readonly clampAtMaximum?: boolean;
    }
  | {
      readonly type: "restoreResourceToMaximum";
      readonly resource: "energy";
    }
  | {
      readonly type: "payResource";
      readonly resource: "money";
      readonly amount: number;
      readonly insufficientFunds: "pay-up-to-available";
    }
  | {
      readonly type: "incrementWorkCounter";
      readonly amount: 1;
      readonly rewardEvery: 5;
      readonly reward: {
        readonly resource: "reputation";
        readonly amount: 1;
      };
      readonly cumulative: true;
    }
  | {
      readonly type: "rollCheck";
      readonly dice: DiceSpec;
      readonly rerollEligible: boolean;
      readonly outcomes: readonly RollOutcome[];
    }
  | {
      readonly type: "applyStatus";
      readonly statusId: StatusId;
      readonly duration:
        | { readonly kind: "uses"; readonly count: number }
        | { readonly kind: "turns"; readonly count: number };
      readonly parameters?: Readonly<Record<string, number | string | boolean>>;
    }
  | {
      readonly type: "skipTurns";
      readonly count: number;
      readonly source: "tile";
    }
  | {
      readonly type: "gainSalary";
      readonly trigger: "pass" | "land";
    }
  | {
      readonly type: "grantExtraRoll";
      readonly count: 1;
    }
  | {
      readonly type: "attemptPromotion";
    }
  | {
      readonly type: "auditConfinement";
      readonly release: {
        readonly roll: DiceSpec;
        readonly requiresTrueDoubles: true;
        readonly rerollEligible: false;
        readonly alternativeFine: 500;
      };
    };

export type RollOutcome = {
  readonly when:
    | { readonly total: readonly [number, number] }
    | { readonly doubles: true }
    | { readonly doubles: false };
  readonly effects: readonly EffectDescriptor[];
};
