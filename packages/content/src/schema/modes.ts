import type { DeckId, ModeId, RankId, TokenId } from "./ids";

export type WinShape = "race" | "fixed-length" | "objectives" | "survival";
export type BankruptcyRule = "none" | "demote" | "eliminate";
export type LeaderProtection = "none" | "soft" | "hard";
export type TimeoutBehaviour = "auto-roll" | "auto-pass" | "best-move";
export type ChatMode = "off" | "quick" | "full";
export type BotPacing = "instant" | "paced";

/**
 * The whole configurable ruleset, per plans/24-gameplay-v2-spec.md §4.
 *
 * Binding rule for every mechanic that reads this: **no mechanic may be gated
 * on a hardcoded constant or on a `modeId` string comparison.** Enablement and
 * tunables both come from here, so a mechanic that cannot be switched off from
 * config is a bug.
 *
 * This shape is also what a lobby authors for a custom mode (§8.4), so it is
 * validated as untrusted input by contracts — every field is required and every
 * numeric is bounded.
 */
export type ModeRules = {
  readonly winShape: WinShape;

  readonly quarters: {
    readonly enabled: boolean;
    readonly count: number;
    readonly roundsEach: number;
    readonly globalEvents: boolean;
  };

  /** Which win paths score. At least one must be true. */
  readonly winPaths: {
    readonly promotion: boolean;
    readonly wealth: boolean;
    readonly influence: boolean;
    readonly survival: boolean;
  };

  readonly economy: {
    readonly upkeepEnabled: boolean;
    /** Charge per round, indexed by rank index. Length must equal the rank ladder. */
    readonly upkeepByRankIndex: readonly number[];
    readonly loansEnabled: boolean;
    readonly maxLoanPrincipal: number;
    readonly interestBasisPoints: number;
    readonly bankruptcy: BankruptcyRule;
    readonly incomeStreamsEnabled: boolean;
  };

  readonly board: {
    readonly ownershipEnabled: boolean;
    readonly claimCostMultiplier: number;
    readonly tollMultiplier: number;
    readonly upgradesEnabled: boolean;
    readonly placementsEnabled: boolean;
    readonly maxPlacementsPerPlayer: number;
  };

  readonly projects: {
    readonly enabled: boolean;
    readonly maxConcurrentPerPlayer: number;
    readonly joinable: boolean;
    readonly sabotageable: boolean;
    readonly deadlineRounds: number;
  };

  readonly conflict: {
    readonly targetedAttacks: boolean;
    readonly heatEnabled: boolean;
    readonly heatPerAttack: number;
    readonly heatThreshold: number;
    readonly defenceEnabled: boolean;
    readonly leaderProtection: LeaderProtection;
    readonly elimination: boolean;
  };

  readonly agency: {
    readonly promotionIsChoice: boolean;
    readonly promotionRaisesUpkeep: boolean;
    readonly diceAdjustEnabled: boolean;
    readonly energyPerPip: number;
    readonly maxPipAdjust: number;
    readonly freeActionsPerTurn: number;
    readonly handEnabled: boolean;
  };

  readonly interaction: {
    readonly reactionWindows: boolean;
    readonly reactionWindowSeconds: number;
    readonly votesEnabled: boolean;
    readonly auctionsEnabled: boolean;
    readonly tradesEnabled: boolean;
    /** Unenforceable promises are recorded in the agreement log for social pressure. */
    readonly promisesRecorded: boolean;
  };

  readonly hidden: {
    readonly rolesEnabled: boolean;
    readonly roleWinConditions: boolean;
    readonly secretObjectives: boolean;
    readonly hiddenHands: boolean;
  };

  readonly social: {
    readonly chat: ChatMode;
    readonly emoteReactions: boolean;
    readonly directMessages: boolean;
  };

  readonly timers: {
    readonly turnSeconds: number;
    readonly onTimeout: TimeoutBehaviour;
    readonly chessClockSeconds: number | null;
  };

  readonly bots: {
    readonly pacing: BotPacing;
    readonly thinkMsRange: readonly [number, number];
    readonly canNegotiate: boolean;
  };
};

export type ModeConfig = {
  readonly id: ModeId;
  readonly displayNameKey: `deadlineDash.mode.${string}.name`;
  readonly targetDurationMinutes: readonly [number, number];
  readonly turnTimerSeconds: number;
  readonly startingResources: {
    readonly money: number;
    readonly reputation: 0;
    /**
     * Starting energy and the base ceiling are separate numbers on purpose.
     * `create-game.ts` used to pass `energy` as both the value *and* the
     * maximum, which pinned the ceiling to the starting value — so every
     * `+energy` grant and every `restoreResourceToMaximum` in the pack was a
     * guaranteed no-op for a rested player, and `rank.supervisor`'s
     * `increaseMaximumEnergy` benefit had nothing to widen. GDD numbers: 8
     * base, 10 once Supervisor's benefit applies.
     */
    readonly energy: 8;
    readonly energyMaximum: 8;
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
  /**
   * The data-driven ruleset. Snapshotted into `GameState.rules` at
   * `game.start` and frozen for the match, so a content-pack edit can never
   * change how an in-flight (or replayed) game behaves.
   */
  readonly rules: ModeRules;
  readonly sourceNotes: readonly string[];
};

export type RankCostByMode = Readonly<Record<ModeId, number>>;

export type PromotionTarget = Exclude<RankId, "rank.intern">;
