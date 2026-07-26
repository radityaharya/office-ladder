/**
 * Gameplay v2 shared vocabulary and projection DTOs (spec §5, §7.2).
 *
 * Two jobs:
 *
 * 1. The **vocabulary** every gameplay command and projection agrees on — the
 *    placement kinds, project statuses, trade item kinds, win paths. Enumerated at
 *    runtime, like the room vocabularies in `rooms.ts`, because the server has to
 *    validate these strings inside untrusted request bodies and inside persisted
 *    snapshots.
 * 2. The **projection DTOs**, which are where the redaction guarantees of §7.2
 *    are actually made. Those guarantees are structural here, not conventional:
 *    where the engine's state has a field that must not reach every viewer, the
 *    public DTO has no field of that shape at all, and the private counterpart is
 *    a separate type that only ever appears under `self`. A DTO that *can* carry
 *    another player's hand, secret objective, hidden sabotage or `owner-only`
 *    placement is a bug even when the server never populates it — so none of them
 *    can.
 *
 * **Mapping from the engine's `PlayerGameProjection`.** The engine ships one
 * already-redacted array per concept, with the viewer's own hidden items merged
 * in and marked (an `owner-only` placement, a `hidden: true` sabotage, a
 * `parties-only` agreement, a secret objective with its detail fields non-null).
 * These DTOs split that array in two instead, because a single array can only be
 * typed loosely enough to hold both. The server's projection mapper partitions:
 *
 * | Engine entry | Contracts home |
 * | --- | --- |
 * | `placement.visibility === "public"` | `placements` |
 * | `placement.visibility === "owner-only"` | `self.ownPlacements` |
 * | `agreement.visibility === "public"` | `agreements` |
 * | `agreement.visibility === "parties-only"` | `self.agreements` |
 * | objective `visibility === "public"` | `objectives` (public variant) |
 * | secret objective with `definitionId === null` | `objectives` (secret variant) |
 * | secret objective with details filled in | `self.objectives` |
 * | `sabotage.hidden === false`, or revealed on resolution | `projects[].sabotage` |
 * | the viewer's own unresolved hidden sabotage | `self.sabotage` |
 * | `ballot.castBy === null` (sealed, in flight) | sealed `BallotProjection` |
 * | `SelfProjection.ballotCasts` | `self.ballotCasts` |
 *
 * The partition is mechanical and total: nothing the engine projects has no home,
 * and nothing lands in a public array that the engine had marked private.
 */
import type { ModeRules } from "./mode-rules";
import type { GameBootstrap } from "./rooms";
import type { JsonObject, JsonValue } from "./validate";

export const PLACEMENT_KINDS = [
  /** Next lander loses their next turn. */
  "placement.meeting-invite",
  /** Next lander pays the owner. */
  "placement.sabotage",
  /** Owner learns the lander's hidden info. */
  "placement.surveillance",
  /** Next lander loses reputation. */
  "placement.rumour",
  /** Next lander gains; owner paid to place it. */
  "placement.favour",
] as const;

export type PlacementKind = (typeof PLACEMENT_KINDS)[number];

export const PLACEMENT_VISIBILITIES = ["public", "owner-only"] as const;

export type PlacementVisibility = (typeof PLACEMENT_VISIBILITIES)[number];

export const PROJECT_STATUSES = ["open", "funded", "completed", "failed"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const AGREEMENT_STATUSES = [
  "offered",
  "accepted",
  "declined",
  "expired",
  "settled",
  "broken",
] as const;

export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const AGREEMENT_VISIBILITIES = ["public", "parties-only"] as const;

export type AgreementVisibility = (typeof AGREEMENT_VISIBILITIES)[number];

export const TRADE_ITEM_KINDS = [
  "money",
  "card",
  "token",
  "tile",
  "immunity",
  "promise",
] as const;

export type TradeItemKind = (typeof TRADE_ITEM_KINDS)[number];

/**
 * One side of one clause of an agreement (spec §5.5).
 *
 * `promise` is unenforceable by design and the engine transfers nothing for it —
 * it is recorded so the table can see who broke what. Everything else is a real
 * transfer the engine settles on accept.
 */
export type TradeItem =
  | { readonly kind: "money"; readonly amount: number }
  | { readonly kind: "card"; readonly cardId: string }
  | { readonly kind: "token"; readonly tokenId: string; readonly quantity: number }
  | { readonly kind: "tile"; readonly tileId: string }
  | { readonly kind: "immunity"; readonly rounds: number }
  | { readonly kind: "promise"; readonly text: string };

export const OBJECTIVE_VISIBILITIES = ["public", "secret"] as const;

export type ObjectiveVisibility = (typeof OBJECTIVE_VISIBILITIES)[number];

export const BALLOT_KINDS = ["vote", "auction"] as const;

export type BallotKind = (typeof BALLOT_KINDS)[number];

export const BALLOT_VISIBILITIES = ["open", "sealed"] as const;

export type BallotVisibility = (typeof BALLOT_VISIBILITIES)[number];

export const INCOME_STREAM_KINDS = ["asset", "rent", "project", "side-gig"] as const;

export type IncomeStreamKind = (typeof INCOME_STREAM_KINDS)[number];

export const WIN_PATHS = ["promotion", "wealth", "influence", "survival"] as const;

export type WinPath = (typeof WIN_PATHS)[number];

/**
 * Includes the pre-v2 reasons: a completed match persisted before this change
 * still has to project.
 */
export const MATCH_END_REASONS = [
  "director-reached",
  "clock-deck-exhausted",
  "marathon-scored",
  "terminated-no-contest",
  "quarters-elapsed",
  "objectives-complete",
  "last-standing",
] as const;

export type MatchEndReason = (typeof MATCH_END_REASONS)[number];

/**
 * The free action a player may take on their own turn (spec §6.2, `turn.action`).
 *
 * Enumerated rather than left as an open string. The spec types the payload field
 * as `string` and names these four; an open string would mean the transport
 * boundary vouches for nothing and every unknown action has to be caught deeper
 * in, by which point it has already been counted against the turn's free-action
 * budget. Adding a fifth action means adding it here — deliberately, so the
 * vocabulary stays a decision rather than a side effect.
 */
export const TURN_ACTIONS = ["work", "network", "scheme", "rest"] as const;

export type TurnAction = (typeof TURN_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Shared board state — §5.1
// ---------------------------------------------------------------------------

export type TileOwnershipProjection = {
  readonly tileId: string;
  readonly ownerId: string;
  /** 0 = claimed, >0 = upgraded. */
  readonly level: number;
  readonly claimedAtRound: number;
  readonly tollPaidCount: number;
};

/**
 * A placement every player can see.
 *
 * Two redactions are built into this type rather than left to the server:
 *
 * - `visibility` is the literal `"public"`, so an `owner-only` placement cannot be
 *   assigned into a public list even by accident. Owner-only placements are
 *   absent from other players' views entirely (§7.2) and appear on
 *   {@link SelfGameplayProjection.ownPlacements}.
 * - there is no `data` field. `data` is where a surveillance placement records
 *   what it learned about a lander, which is the one thing on a placement that
 *   must never be public. The owner reads it from
 *   {@link OwnPlacementProjection}.
 */
export type PublicPlacementProjection = {
  readonly id: string;
  readonly kind: PlacementKind;
  readonly tileId: string;
  readonly ownerId: string;
  readonly charges: number;
  readonly visibility: "public";
  readonly placedAtRound: number;
};

/** The owner's own placement, including what it has learned. */
export type OwnPlacementProjection = {
  readonly id: string;
  readonly kind: PlacementKind;
  readonly tileId: string;
  readonly ownerId: string;
  readonly charges: number;
  readonly visibility: PlacementVisibility;
  readonly placedAtRound: number;
  readonly data: JsonObject;
};

// ---------------------------------------------------------------------------
// Projects — §5.2
// ---------------------------------------------------------------------------

export type ProjectContributionProjection = {
  readonly playerId: string;
  readonly money: number;
  readonly work: number;
  readonly atRound: number;
};

/**
 * A sabotage the table can see.
 *
 * Hidden sabotage is revealed only on resolution (§5.2), so an unresolved hidden
 * entry is **absent** from this list rather than present-and-masked: there is no
 * "hidden" variant of this shape to leak an amount or an actor through. Once
 * resolution reveals it, the same entry appears here with `hidden: true`, which is
 * how the feed can say "and it was sabotaged in secret" after the fact.
 */
export type RevealedProjectSabotageProjection = {
  readonly playerId: string;
  readonly amount: number;
  readonly hidden: boolean;
  readonly atRound: number;
};

/** The viewer's own sabotage, visible to them before resolution. */
export type OwnProjectSabotageProjection = {
  readonly projectId: string;
  readonly amount: number;
  readonly hidden: boolean;
  readonly atRound: number;
};

export type ProjectPayoutProjection = {
  readonly money: number;
  readonly reputation: number;
  readonly objectiveProgress: number;
};

export type PublicProjectProjection = {
  readonly id: string;
  readonly definitionId: string;
  readonly leadPlayerId: string;
  readonly tileId: string | null;
  readonly status: ProjectStatus;
  readonly requiredMoney: number;
  readonly requiredWork: number;
  /** Sum of `contributions[].money`, pre-summed so the client never has to. */
  readonly contributedMoney: number;
  /** Sum of `contributions[].work`. */
  readonly contributedWork: number;
  readonly contributions: readonly ProjectContributionProjection[];
  readonly sabotage: readonly RevealedProjectSabotageProjection[];
  readonly deadlineRound: number;
  readonly payout: ProjectPayoutProjection;
  readonly openToJoin: boolean;
  /** Contributors share the payout pro rata; the lead takes this on top. */
  readonly leadBonusBasisPoints: number;
};

// ---------------------------------------------------------------------------
// Economy — §5.3 — and conflict — §5.4
// ---------------------------------------------------------------------------

export type UpkeepProjection = {
  readonly perRound: number;
  readonly lastChargedRound: number;
  readonly missedPayments: number;
};

export type LoanProjection = {
  readonly id: string;
  readonly principal: number;
  readonly outstanding: number;
  readonly interestBasisPoints: number;
  readonly takenAtRound: number;
};

export type IncomeStreamProjection = {
  readonly id: string;
  readonly kind: IncomeStreamKind;
  readonly perRound: number;
  readonly remainingRounds: number | null;
  readonly sourceId: string | null;
};

/**
 * Public by design. Heat is the price of aggression, and a price nobody else can
 * see does not deter anything — the table has to be able to point at the player
 * who has been swinging.
 */
export type HeatProjection = {
  readonly value: number;
  readonly threshold: number;
  readonly investigationsOpened: number;
  readonly lastIncrementedAtRound: number | null;
};

/**
 * The v2 per-player state every viewer may see.
 *
 * `handCount` is the redaction: a hidden hand projects as a number of cards and
 * this type has no field that could carry the cards themselves. The viewer's own
 * hand stays where it already is, on `CallerSelfProjection.hand`.
 */
export type PublicPlayerGameplayProjection = {
  readonly playerId: string;
  readonly handCount: number;
  readonly heat: HeatProjection;
  readonly upkeep: UpkeepProjection;
  readonly loans: readonly LoanProjection[];
  readonly incomeStreams: readonly IncomeStreamProjection[];
};

// ---------------------------------------------------------------------------
// Agreements — §5.5
// ---------------------------------------------------------------------------

/**
 * An agreement the whole table can see. `visibility` is the literal `"public"`, so
 * a `parties-only` agreement cannot be assigned into the public list; the parties
 * read theirs from {@link SelfGameplayProjection.agreements}.
 */
export type PublicAgreementProjection = {
  readonly id: string;
  readonly proposerId: string;
  readonly recipientIds: readonly string[];
  readonly give: readonly TradeItem[];
  readonly receive: readonly TradeItem[];
  readonly status: AgreementStatus;
  readonly offeredAtRound: number;
  readonly expiresAtRound: number;
  readonly acceptedBy: readonly string[];
  readonly visibility: "public";
};

/** An agreement this viewer is a party to, whatever its visibility. */
export type PartyAgreementProjection = {
  readonly id: string;
  readonly proposerId: string;
  readonly recipientIds: readonly string[];
  readonly give: readonly TradeItem[];
  readonly receive: readonly TradeItem[];
  readonly status: AgreementStatus;
  readonly offeredAtRound: number;
  readonly expiresAtRound: number;
  readonly acceptedBy: readonly string[];
  readonly visibility: AgreementVisibility;
};

// ---------------------------------------------------------------------------
// Objectives and scoring — §5.6
// ---------------------------------------------------------------------------

/**
 * A secret objective projects as **existence only** (§7.2): who has one, and
 * whether it has been completed. The secret variant of this union has no
 * `definitionId`, `progress`, `target` or reward, so there is nothing for a
 * careless server to fill in — knowing that a rival has one unfinished objective
 * is information; knowing which one it is would be the whole game.
 */
export type PublicObjectiveProjection =
  | {
      readonly visibility: "public";
      readonly id: string;
      readonly definitionId: string;
      /** `null` = table-wide. */
      readonly ownerId: string | null;
      readonly progress: number;
      readonly target: number;
      readonly completedAtRound: number | null;
      readonly rewardPoints: number;
      readonly rewardMoney: number;
    }
  | {
      readonly visibility: "secret";
      readonly id: string;
      readonly ownerId: string | null;
      readonly completedAtRound: number | null;
    };

/** The viewer's own objectives, secret ones included, in full. */
export type SelfObjectiveProjection = {
  readonly visibility: ObjectiveVisibility;
  readonly id: string;
  readonly definitionId: string;
  readonly ownerId: string | null;
  readonly progress: number;
  readonly target: number;
  readonly completedAtRound: number | null;
  readonly rewardPoints: number;
  readonly rewardMoney: number;
};

export type ScoreBreakdownProjection = {
  readonly playerId: string;
  readonly rankPoints: number;
  readonly moneyPoints: number;
  readonly reputationPoints: number;
  readonly objectivePoints: number;
  readonly ownershipPoints: number;
  readonly projectPoints: number;
  readonly penaltyPoints: number;
  readonly total: number;
};

// ---------------------------------------------------------------------------
// Quarters — §5.7 — and ballots — §5.8
// ---------------------------------------------------------------------------

export type QuarterProjection = {
  readonly index: number;
  readonly startedAtRound: number;
  readonly endsAtRound: number;
  /** Announced when the quarter opens so players can position for it. */
  readonly scheduledEventId: string | null;
  readonly resolvedEventIds: readonly string[];
};

/**
 * A ballot, redacted by its own visibility.
 *
 * The sealed variant has **no `castBy` field**, not an emptied one: §7.2 requires
 * that in-flight votes and bids do not leak "including via `castBy` keys", and a
 * map whose keys are the players who have already voted leaks exactly that even
 * when the values are stripped. So a sealed ballot projects a count, whether *this
 * viewer* has cast, and — once it closes — the `resolution` the engine wrote.
 * The viewer's own in-flight vote comes back on
 * {@link SelfGameplayProjection.ballotVotes}, which only ever contains their own.
 */
export type BallotProjection =
  | {
      readonly visibility: "open";
      readonly id: string;
      readonly kind: BallotKind;
      readonly subjectId: string;
      readonly subject: JsonObject;
      readonly audience: readonly string[];
      readonly castBy: Readonly<Record<string, JsonValue>>;
      readonly deadlineAt: string | null;
      readonly closesAtRound: number;
      readonly resolution: JsonObject | null;
    }
  | {
      readonly visibility: "sealed";
      readonly id: string;
      readonly kind: BallotKind;
      readonly subjectId: string;
      readonly subject: JsonObject;
      readonly audience: readonly string[];
      readonly castCount: number;
      readonly viewerHasCast: boolean;
      readonly deadlineAt: string | null;
      readonly closesAtRound: number;
      readonly resolution: JsonObject | null;
    };

// ---------------------------------------------------------------------------
// Per-viewer aggregate — §5.9, §7.2
// ---------------------------------------------------------------------------

/**
 * Everything this viewer — and only this viewer — may see.
 *
 * The existence of this block is what lets every public type above be honestly
 * public: each private field has exactly one home, and it is here.
 */
export type SelfGameplayProjection = {
  readonly ownPlacements: readonly OwnPlacementProjection[];
  readonly agreements: readonly PartyAgreementProjection[];
  readonly objectives: readonly SelfObjectiveProjection[];
  readonly sabotage: readonly OwnProjectSabotageProjection[];
  /**
   * The viewer's own ballot casts, keyed by ballot id. Named for the engine's
   * `SelfProjection.ballotCasts`, which it mirrors one for one.
   *
   * Needed because a sealed ballot projects no `castBy` at all — without this a
   * player could not see the bid they themselves just placed.
   */
  readonly ballotCasts: Readonly<Record<string, JsonValue>>;
  /** Free actions still available this turn, from `agency.freeActionsPerTurn`. */
  readonly freeActionsRemaining: number;
};

/**
 * The v2 shared state, projected for one viewer.
 *
 * `rules` is the ruleset snapshotted into the match at `game.start` (§5.9) rather
 * than whatever the content pack says today, so a client renders the game it is
 * actually in — and so a mid-match content deploy cannot change what the UI claims
 * the rules are.
 *
 * Every collection here is already redacted for its recipient: this is a
 * per-socket payload (§7.2), not one broadcast shared by the table.
 */
export type GameplayProjection = {
  readonly rules: ModeRules;
  readonly tileOwnership: readonly TileOwnershipProjection[];
  readonly placements: readonly PublicPlacementProjection[];
  readonly projects: readonly PublicProjectProjection[];
  readonly agreements: readonly PublicAgreementProjection[];
  readonly objectives: readonly PublicObjectiveProjection[];
  readonly ballots: readonly BallotProjection[];
  readonly quarters: readonly QuarterProjection[];
  readonly currentQuarterIndex: number;
  readonly eliminatedPlayerIds: readonly string[];
  readonly players: readonly PublicPlayerGameplayProjection[];
  readonly self: SelfGameplayProjection;
  /** Populated once the match ends; empty while it is running. */
  readonly scores: readonly ScoreBreakdownProjection[];
  readonly winPath: WinPath | null;
  readonly endReason: MatchEndReason | null;
};

/**
 * The v1 game bootstrap plus the v2 blocks.
 *
 * Intersection rather than a new field on `GameBootstrap`, so this is purely
 * additive: a `GameplayBootstrap` *is* a `GameBootstrap`, so every existing
 * caller — the turn-timer's `shouldEnforce`, the bot driver's `shouldDrive`, the
 * whole web client — keeps compiling and keeps working against a server that has
 * started returning the richer payload. A client that knows about `gameplay`
 * narrows to this type; one that does not never notices.
 */
export type GameplayBootstrap = GameBootstrap & {
  readonly gameplay: GameplayProjection;
};
