import type { DeckId, ModeId, RankId, TokenId } from "./ids";

export type ModeConfig = {
  readonly id: ModeId;
  readonly displayNameKey: `deadlineDash.mode.${string}.name`;
  readonly targetDurationMinutes: readonly [number, number];
  readonly turnTimerSeconds: number;
  readonly startingResources: {
    readonly money: number;
    readonly reputation: 0;
    readonly energy: 5;
    readonly workCounter: 0;
  };
  readonly startingTokens: Partial<Readonly<Record<TokenId, number>>>;
  readonly handLimit: number;
  readonly tokenCaps: Readonly<Record<TokenId, number>>;
  readonly deckQuantities: Readonly<Record<DeckId, number>>;
  readonly clockDeck: {
    readonly deckIds: readonly ["deck.meeting", "deck.event"];
    readonly quantities: {
      readonly meeting: number;
      readonly event: number;
      readonly total: number;
    };
    readonly provisional: true;
    readonly source: "plans/01-product-scope-and-rules-decisions.md#clock-deck";
  };
  readonly endgame:
    | { readonly type: "immediate" }
    | {
        readonly type: "additional-rounds";
        readonly rounds: 3;
        readonly clockExhaustionStillEndsMatch: true;
        readonly scoring: {
          readonly rankTierPoints: 1000;
          readonly moneyMultiplier: 0.1;
          readonly reputationPoints: 50;
        };
      };
  readonly sourceNotes: readonly string[];
};

export type RankCostByMode = Readonly<Record<ModeId, number>>;

export type PromotionTarget = Exclude<RankId, "rank.intern">;
