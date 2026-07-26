import type { DeckId, ResourceId, StatusId, TileId } from "./ids";

/**
 * The authored effect vocabulary, gameplay v2 — `plans/24-gameplay-v2-spec.md`
 * §10.1–§10.6 plus the amendments in the card re-cut plan's §3.
 *
 * ## What changed, and why it is backward compatible
 *
 * v1 expressed **immediate self-effects only**, which is why only ~61 of 221
 * designed cards could be typed at all. v2 adds four optional envelope fields
 * (`target`, `preventable`, `condition`, `scale`) to *every* effect, plus twenty
 * new effect types. Every default reproduces v1 behaviour exactly — `target`
 * defaults to `"self"`, `preventable` to `false`, `condition`/`scale` absent —
 * so every already-authored tile, card and global event still types unchanged.
 *
 * ## Timing is deliberately absent from this file
 *
 * §10.5 rules that `timing` lives on `DeckCard`, not on the effect: per-effect
 * makes `[{stored}, {immediate}]` representable, and that card has no defined
 * answer for which zone it ends up in. `EffectTiming` is declared here because
 * it is effect vocabulary; it is *attached* in `./decks`.
 *
 * ## The engine is the reference implementation
 *
 * `packages/engine/src/execution/effects-v2/` interprets this vocabulary and its
 * field names are the contract — `condition` in particular is the closed grammar
 * `effects-v2/conditions.ts` evaluates, not an open JSON object, because a guard
 * nothing can evaluate is a guard that does not guard. Nothing declared here is
 * speculative: every member is used by a card in the re-cut plan.
 */

/** A JSON value, matching the engine's `JsonValue` exactly (deep-readonly). */
export type EffectJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly EffectJsonValue[]
  | { readonly [key: string]: EffectJsonValue };

/** A JSON object, matching the engine's `JsonObject` exactly. */
export type EffectJsonObject = { readonly [key: string]: EffectJsonValue };

export type DiceSpec =
  | { readonly count: 1; readonly sides: 6 }
  | { readonly count: 2; readonly sides: 6 };

/**
 * Who an effect lands on. §10.1. Default `"self"`.
 *
 * Every derived target (`highest-rank`, `richest`, …) breaks ties by
 * `GameState.playerOrder` and **never** by object-key iteration over
 * `GameState.players`: key order is not a contract across the repository's
 * `JSON.parse(JSON.stringify(…))` boundary, so a tie-break that read it would
 * silently change which player an effect hit after a reload.
 *
 * `chosen-opponent` requires a decision, so an effect carrying it **must** open
 * a `PromptState` rather than silently picking one.
 */
export type EffectTarget =
  | "self"
  | "active-player"
  /** The actor picks. Opens a `PromptState`; never resolved silently. */
  | "chosen-opponent"
  | "all-opponents"
  | "all-players"
  | "left-neighbour"
  | "right-neighbour"
  | "highest-rank"
  | "lowest-rank"
  | "richest"
  | "poorest";

/**
 * When a card resolves. §10.2. Attached to `DeckCard.timing`, never to an
 * effect.
 *
 * `stored` requires `agency.handEnabled`; `reaction` requires
 * `interaction.reactionWindows`. A card whose timing is disabled by the active
 * mode is filtered out at deck construction, not drawn and then discarded.
 */
export type EffectTiming =
  /** Resolves on draw or on play — v1's only behaviour, and the default. */
  | "immediate"
  /** Enters the hand and is played later on your own turn. */
  | "stored"
  /** Playable out of turn into an open reaction window. */
  | "reaction";

/**
 * Whose state a `condition` clause or a `scale` metric reads.
 *
 * `"target"` — the player the effect is currently being applied to. This is the
 * default, and it is what makes a guard on an `@all-players` effect mean "each
 * player is tested individually" rather than "test the drawer once". The two
 * readings produce different cards, so the default is stated rather than
 * implied.
 *
 * `"actor"` — the player who caused the effect (the card's drawer or player).
 */
export type EffectConditionSubject = "actor" | "target";

/**
 * Resources a condition may read. A superset of `ResourceId`: the engine tracks
 * the Work counter as a resource (`player.resources["work-counter"]`), which is
 * what makes a work-counter guard expressible without a bespoke clause.
 */
export type EffectConditionResource = ResourceId | "work-counter";

/**
 * §10.3's `condition` guard, given the **closed** grammar the engine's
 * `effects-v2/conditions.ts` actually evaluates.
 *
 * The spec typed it as a bare `JsonObject`, which is unusable as written, and
 * four authored cards had already each invented a private shape inside it.
 * Every member here is JSON-shaped, so an authored condition round-trips
 * through the repository unchanged and the engine's `parseEffectCondition`
 * accepts it back.
 *
 * Unrecognised conditions **fail closed** — the effect does not apply. A typo in
 * content must never silently arm an unconditional effect.
 */
export type EffectCondition =
  | { readonly kind: "always" }
  | { readonly kind: "never" }
  | {
      readonly kind: "resourceAtLeast";
      readonly who: EffectConditionSubject;
      readonly resource: EffectConditionResource;
      readonly amount: number;
    }
  | {
      readonly kind: "resourceAtMost";
      readonly who: EffectConditionSubject;
      readonly resource: EffectConditionResource;
      readonly amount: number;
    }
  | {
      readonly kind: "rankIndexAtLeast";
      readonly who: EffectConditionSubject;
      readonly index: number;
    }
  | {
      readonly kind: "rankIndexAtMost";
      readonly who: EffectConditionSubject;
      readonly index: number;
    }
  | {
      readonly kind: "heatAtLeast";
      readonly who: EffectConditionSubject;
      readonly value: number;
    }
  | {
      readonly kind: "hasStatus";
      readonly who: EffectConditionSubject;
      readonly statusId: StatusId;
    }
  | {
      readonly kind: "ownsTile";
      readonly who: EffectConditionSubject;
      /** `null` = the tile the subject is standing on. */
      readonly tileId: TileId | null;
    }
  | { readonly kind: "roundAtLeast"; readonly round: number }
  | { readonly kind: "quarterIndex"; readonly index: number }
  | { readonly kind: "not"; readonly of: EffectCondition }
  | { readonly kind: "all"; readonly of: readonly EffectCondition[] }
  | { readonly kind: "any"; readonly of: readonly EffectCondition[] };

/**
 * Metrics an effect's magnitude may scale off. Re-cut plan §3.7.
 *
 * §10.6 mandate 4 — "all-player does not mean identical-to-every-player" — is
 * unsatisfiable without this: a symmetric effect applied to everyone changes
 * nobody's relative standing, which is what made 49 of 50 corner cards
 * ceremonial.
 */
export type EffectScaleMetric =
  | "rank-tier"
  | "board-position"
  | "laps"
  | "heat"
  | "debt"
  | "work-counter"
  | "opponent-count";

/**
 * Effective amount = `amount + perUnit × metric(of)`, clamped to `cap` when
 * present. `cap` bounds the *magnitude* of the final amount and never flips its
 * sign.
 */
export type EffectScale = {
  readonly by: EffectScaleMetric;
  readonly perUnit: number;
  /** Absolute cap on the final amount, sign-aware. */
  readonly cap?: number;
  /** Default `"target"` — the player the effect is being applied to. */
  readonly of?: EffectConditionSubject;
};

/** Where a placed object or a claim lands. `null` = the actor's current tile. */
export type EffectTileRef = TileId | null;

/**
 * The four fields §10.1/§10.3 and the re-cut plan's §3.7 add to *every* effect.
 * All optional; every default reproduces v1 behaviour exactly.
 */
export type EffectEnvelope = {
  /** Default `"self"` — which is why every pre-v2 card types unchanged. */
  readonly target?: EffectTarget;
  /**
   * May a reaction cancel this? Default `false`.
   *
   * `true` is the *only* thing that makes an effect eligible to raise a
   * `ReactionWindowState` carrying a `pendingEffectId`.
   */
  readonly preventable?: boolean;
  /** Guard evaluated per (actor, target) pair before the effect is applied. */
  readonly condition?: EffectCondition;
  /** Makes an amount depend on state. See `EffectScale`. */
  readonly scale?: EffectScale;
};

/** Objects a player can leave on a tile. Mirrors the engine's `PlacementKind`. */
export type PlacementKind =
  /** Next lander loses their next turn. */
  | "placement.meeting-invite"
  /** Next lander pays the owner. */
  | "placement.sabotage"
  /** Owner learns the lander's hidden info. */
  | "placement.surveillance"
  /** Next lander loses reputation. */
  | "placement.rumour"
  /** Next lander gains; the owner paid to place it. */
  | "placement.favour";

/** Polarity of a status, of a single effect's provenance, or of a whole card. */
export type EffectPolarity = "positive" | "negative";

/**
 * What a `grantImmunity` charge actually blocks. Re-cut plan §3.4.
 *
 * Declared rather than smuggled into `condition`: four authored cards had each
 * invented their own filter inside the open guard object, which meant four
 * mutually incompatible, unevaluable encodings of the same idea.
 */
export type EffectImmunityScope = {
  readonly resource?: ResourceId;
  readonly direction?: "loss" | "gain";
  /** `EffectDescriptor["type"]` values this immunity blocks. */
  readonly effectTypes?: readonly string[];
  /** Blocks only effects originating from cards of this deck. */
  readonly sourceDeckId?: DeckId;
};

/** Which statuses `removeStatuses` strips. Re-cut plan §3.5. */
export type EffectStatusFilter = {
  readonly polarity?: EffectPolarity;
  readonly sourceDeckId?: DeckId;
  readonly statusId?: StatusId;
};

/** One branch of a `chooseOne`. */
export type EffectChoiceOption = {
  readonly id: string;
  readonly label: string;
  readonly effects: readonly EffectDescriptor[];
};

/**
 * The v1 vocabulary — things that happen to a single player immediately —
 * unchanged except for the two widenings called out inline.
 */
export type CoreEffectDescriptor =
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
      /**
       * Widened from the literal `1`: the re-cut's `WC(n)` notation needs cards
       * that advance the counter by more than one step, and the reward
       * arithmetic (`rewardEvery`) was already written to handle a stride.
       */
      readonly amount: number;
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
      /**
       * Re-cut plan §3.9 rule 3. `"shared"` (the default) rolls once and applies
       * the matching outcome to every target; `"per-target"` rolls once per
       * target. Nested `outcomes[].effects` inherit the target of the roll they
       * belong to, never the actor — otherwise a six-player table pays one
       * player six times.
       */
      readonly resolution?: "shared" | "per-target";
    }
  | {
      readonly type: "applyStatus";
      readonly statusId: StatusId;
      readonly duration:
        | { readonly kind: "uses"; readonly count: number }
        | { readonly kind: "turns"; readonly count: number };
      readonly parameters?: Readonly<Record<string, number | string | boolean>>;
      /**
       * Provenance, so `removeStatuses` has something to filter on. Re-cut plan
       * §3.5: "remove all negative Work card effects" is an unevaluable
       * predicate without both of these reaching `PlayerStatusState`.
       * `sourceDeckId` can be inferred by the engine when a card applies the
       * status; `polarity` cannot be inferred at all and must be authored.
       */
      readonly polarity?: EffectPolarity;
      readonly sourceDeckId?: DeckId;
    }
  | {
      readonly type: "skipTurns";
      readonly count: number;
      /** Widened from `"tile"`: cards skip turns too, and the source is logged. */
      readonly source: "tile" | "card";
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

/**
 * §10.3's new types, plus the four the re-cut plan's §3 and §11 add
 * (`removeStatuses`, `chooseOne`, `noEffect`, `opposedRoll`).
 *
 * Authoring rule §10.4, enforced by a content test rather than by the resolver:
 * every *aimed* aggressive effect — one whose `target` is not `"self"` and whose
 * shape is hostile — must be accompanied on the same card by a `modifyHeat` with
 * a positive `amount` and an explicit `target: "self"`. Free aggression
 * collapses the game into alpha-striking the leader. Conversely, *unaimed*
 * pressure (a fixed-relation neighbour, a table-wide cost the actor eats too)
 * carries no heat: heat is the price of choosing, and charging it where there
 * was no choice is as much a defect as not charging it at all.
 */
export type AdvancedEffectDescriptor =
  /**
   * Move a resource between the target and the actor. The steal primitive.
   *
   * A transfer that cannot be paid in full moves what is available rather than
   * failing, matching `payResource`'s `pay-up-to-available`.
   */
  | {
      readonly type: "transferResource";
      readonly resource: ResourceId;
      readonly amount: number;
      /** Default `"target-to-actor"` — the steal direction. */
      readonly direction?: "target-to-actor" | "actor-to-target";
      /**
       * Default `true`: `amount` is per resolved target. This is what makes an
       * `@all-opponents` transfer correct at three players *and* at six; a fixed
       * self-side `payResource` is not.
       */
      readonly perTarget?: boolean;
      readonly insufficientFunds?: "transfer-up-to-available" | "all-or-nothing";
    }
  /** Raise or lower suspicion. Every aimed aggressive card carries one (§10.4). */
  | {
      readonly type: "modifyHeat";
      readonly amount: number;
    }
  | {
      readonly type: "placeObject";
      readonly placementKind: PlacementKind;
      readonly tileId?: EffectTileRef;
      readonly charges?: number;
      readonly visibility?: "public" | "owner-only";
      readonly data?: EffectJsonObject;
    }
  | {
      readonly type: "claimTile";
      readonly tileId?: EffectTileRef;
      /** Multiplied by `rules.board.claimCostMultiplier` to get the real price. */
      readonly baseCost: number;
    }
  | {
      readonly type: "releaseTile";
      readonly tileId?: EffectTileRef;
    }
  | {
      readonly type: "startProject";
      readonly definitionId: string;
      readonly requiredMoney: number;
      readonly requiredWork: number;
      readonly payout: {
        readonly money: number;
        readonly reputation: number;
        readonly objectiveProgress: number;
      };
      readonly tileId?: EffectTileRef;
      readonly openToJoin?: boolean;
      readonly leadBonusBasisPoints?: number;
      /** Default: `rules.projects.deadlineRounds`. */
      readonly deadlineRounds?: number;
    }
  | {
      readonly type: "contributeToProject";
      /** `null` = the contributor's own open project, else the one on their tile. */
      readonly projectId?: string | null;
      readonly money: number;
      readonly work: number;
    }
  | {
      readonly type: "sabotageProject";
      /** `null` = the first open project the actor does not lead. */
      readonly projectId?: string | null;
      readonly amount: number;
      readonly hidden?: boolean;
    }
  | {
      readonly type: "openBallot";
      readonly ballotKind: "vote" | "auction";
      readonly subjectId: string;
      readonly subject?: EffectJsonObject;
      readonly closesInRounds?: number;
      readonly visibility?: "open" | "sealed";
    }
  /**
   * Blocks the next N *preventable* effects matching `scope` that target this
   * player. Exactly one of `count` / `duration` is set: "ignore one negative
   * Networking card" is a count, "ignore all Energy loss this turn" is a
   * duration and cannot be written as a count without inventing a number.
   */
  | {
      readonly type: "grantImmunity";
      readonly count?: number;
      readonly duration?: { readonly kind: "turns"; readonly count: number };
      readonly scope: EffectImmunityScope;
    }
  | {
      readonly type: "forceDiscard";
      readonly count: number;
    }
  | {
      readonly type: "swapBoardPositions";
    }
  | {
      readonly type: "teleport";
      readonly destination:
        | { readonly kind: "tileIndex"; readonly index: number }
        | { readonly kind: "tileId"; readonly tileId: TileId };
    }
  | {
      readonly type: "modifyUpkeep";
      readonly amount: number;
    }
  /** Explicitly raise a window. Pairs with `preventable`. */
  | {
      readonly type: "openReactionWindow";
      readonly windowKind: "prevention" | "end-turn" | "promotion-block";
    }
  | {
      readonly type: "grantIncomeStream";
      readonly streamKind: "asset" | "rent" | "project" | "side-gig";
      readonly perRound: number;
      /** `null` = indefinite. */
      readonly remainingRounds: number | null;
      readonly sourceId?: string | null;
    }
  /**
   * The only verb that *removes* state — all thirteen of §10.3's original types
   * add it. Re-cut plan §3.5.
   */
  | {
      readonly type: "removeStatuses";
      readonly filter: EffectStatusFilter;
      /** Omitted = remove every match. */
      readonly limit?: number;
    }
  /**
   * The choice primitive. Targeting says *who*, timing says *when*, `condition`
   * guards — nothing else offers the controller a branch, and the GDD names
   * Choice as a category across all six decks.
   *
   * Resolves by opening a `PromptState` addressed to `chooser`, exactly as
   * `chosen-opponent` does.
   */
  | {
      readonly type: "chooseOne";
      readonly options: readonly EffectChoiceOption[];
      /**
       * Who picks. Default `"self"` — the actor. `"chosen-opponent"` is the
       * "target picks the lesser evil" reading, which is a materially different
       * card from "drawer picks after targeting".
       */
      readonly chooser?: EffectTarget;
    }
  /**
   * Does nothing, on purpose. Two Clock Deck cards exist precisely to burn a
   * draw, and an empty `effects` array is indistinguishable from an authoring
   * mistake — so this is a declared verb rather than a relaxed validator rule.
   * It is the one signature whose repetition is the design.
   */
  | {
      readonly type: "noEffect";
    }
  /**
   * Two rollers and a comparison. Not approximable with `rollCheck`, which has
   * one roller and no opponent.
   */
  | {
      readonly type: "opposedRoll";
      /** Who the actor rolls against. Default `"chosen-opponent"`. */
      readonly opponent?: EffectTarget;
      /** Default `{ count: 2, sides: 6 }`, rolled by both sides. */
      readonly dice?: DiceSpec;
      /** Applied when the actor's total is strictly higher. */
      readonly onWin: readonly EffectDescriptor[];
      /** Applied when the actor's total is strictly lower. */
      readonly onLose: readonly EffectDescriptor[];
      /** Applied on an exact tie. Omitted = nothing happens. */
      readonly onTie?: readonly EffectDescriptor[];
    };

/** Distributes the envelope across the union so `.type` still narrows. */
type WithEffectEnvelope<T> = T extends unknown ? T & EffectEnvelope : never;

/**
 * The full authored vocabulary: every v1 effect and every v2 effect, each
 * carrying `target` / `preventable` / `condition` / `scale`.
 */
export type EffectDescriptor = WithEffectEnvelope<
  CoreEffectDescriptor | AdvancedEffectDescriptor
>;

/** Every effect type name, as a union. For validators and content tests. */
export type EffectDescriptorType = EffectDescriptor["type"];

export type RollOutcome = {
  readonly when:
    | { readonly total: readonly [number, number] }
    | { readonly doubles: true }
    | { readonly doubles: false };
  readonly effects: readonly EffectDescriptor[];
};
