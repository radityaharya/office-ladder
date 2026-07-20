import type { CharacterId, ResourceId } from "./ids";

export type CharacterAbilityDescriptor =
  | {
      readonly type: "workLandingMoneyBonus";
      readonly amount: 50;
    }
  | {
      readonly type: "payToRestoreEnergy";
      readonly moneyCost: 100;
    }
  | {
      readonly type: "meetingLandingReputationBonus";
      readonly amount: 1;
    }
  | {
      readonly type: "swapBoardPositions";
      readonly target: "another-player";
    }
  | {
      readonly type: "salaryMultiplier";
      readonly multiplier: 1.2;
    }
  | {
      readonly type: "nextSalaryMultiplier";
      readonly multiplier: 2;
    }
  | {
      readonly type: "ignoreNegativeEffect";
      readonly usesPerLap: 1;
      readonly sources: readonly ["tile", "card"];
    }
  | {
      readonly type: "teleport";
      readonly destination: "any-board-tile";
      readonly traversal: false;
    }
  | {
      readonly type: "modifyPromotionRequirement";
      readonly resource: "reputation";
      readonly amount: -1;
    }
  | {
      readonly type: "stealResource";
      readonly resource: Extract<ResourceId, "reputation">;
      readonly amount: 2;
      readonly target: "another-player";
      readonly insufficientFunds: "transfer-up-to-available";
    }
  | {
      readonly type: "doublesMoneyBonus";
      readonly amount: 100;
    }
  | {
      readonly type: "rerollDice";
      readonly dice: "last-eligible-2d6";
      readonly timing: "after-result";
    };

export type CharacterCooldown =
  | { readonly unit: "laps"; readonly amount: number }
  | { readonly unit: "turns"; readonly amount: number };

export type CharacterConfig = {
  readonly id: CharacterId;
  readonly displayNameKey: `deadlineDash.character.${string}.name`;
  readonly loreKey: `deadlineDash.character.${string}.lore`;
  readonly strengthKey: `deadlineDash.character.${string}.strength`;
  readonly passive: CharacterAbilityDescriptor;
  readonly active: {
    readonly cooldown: CharacterCooldown;
    readonly effect: CharacterAbilityDescriptor;
  };
  readonly sourceNotes?: readonly string[];
};
