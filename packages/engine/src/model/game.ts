import type { ModeRules } from "@office-ladder/content";

import type { JsonObject, JsonValue } from "./json";
import type {
  AbilityId,
  AgreementId,
  BallotId,
  CardDefinitionId,
  CardInstanceId,
  CharacterId,
  CommandId,
  ContentReleaseId,
  DecisionPointId,
  DeckId,
  EffectId,
  FrameId,
  GameId,
  IncomeStreamId,
  LoanId,
  ModeId,
  ObjectiveId,
  PlacementId,
  PlayerId,
  ProjectId,
  PromptOptionId,
  RankId,
  ResourceId,
  RoleId,
  RulesetId,
  StatusId,
  TileId,
  TokenId,
} from "./ids";

/**
 * The canonical-state schema version every game created by this engine build
 * carries in `VersionState.stateSchemaVersion`.
 *
 * Bumped to 2 for gameplay v2 (plans/24-gameplay-v2-spec.md §5.10): `GameState`
 * gained the shared-space collections, `PlayerState` gained the economy and
 * heat blocks, and `rules` is now snapshotted into the state. It lives here,
 * exported as a value, so the serialization contract and the setup path read
 * one number instead of drifting apart.
 */
export const GAME_STATE_SCHEMA_VERSION = 2;

export type LogicalTimestamp = string;
export type ContentHash = string;
export type StateHash = string;

export type GameStatus =
  | "setup"
  | "active"
  | "paused"
  | "quarantined"
  | "ended";

export type TurnPhase =
  | "not-started"
  | "turn-start"
  | "audit"
  | "pre-roll"
  | "roll"
  | "post-roll"
  | "movement"
  | "tile-resolution"
  | "prompt"
  | "reaction"
  | "promotion"
  | "turn-end"
  | "game-over";

export type ResourceKind =
  | "resource.money"
  | "resource.reputation"
  | "resource.energy"
  | "resource.work-counter";

export type TokenKind =
  | "token.move"
  | "token.momentum"
  | "token.reputation"
  | "token.money";

export type RankKind =
  | "rank.intern"
  | "rank.staff"
  | "rank.senior-staff"
  | "rank.supervisor"
  | "rank.assistant-manager"
  | "rank.manager"
  | "rank.senior-manager"
  | "rank.general-manager"
  | "rank.director";

export type RoleKind = "role.worker" | "role.management";

export type DeckKind =
  | "deck.work"
  | "deck.meeting"
  | "deck.event"
  | "deck.networking"
  | "deck.board-meeting"
  | "deck.annual-event";

export interface VersionState {
  readonly stateSchemaVersion: number;
  readonly replaySchemaVersion: number;
  readonly engineVersion: string;
  readonly rulesVersion: string;
  readonly rulesetId: RulesetId;
  readonly contentReleaseId: ContentReleaseId;
  readonly contentHash: ContentHash;
}

export interface ResourceState {
  readonly id: ResourceId;
  readonly kind: ResourceKind | null;
  readonly value: number;
  readonly minimum: number | null;
  readonly maximum: number | null;
}

export interface TokenState {
  readonly id: TokenId;
  readonly kind: TokenKind | null;
  readonly count: number;
  readonly maximum: number;
}

export interface RankState {
  readonly id: RankId;
  readonly kind: RankKind | null;
  readonly index: number;
}

export interface RoleState {
  readonly id: RoleId;
  readonly kind: RoleKind | null;
  readonly revealed: boolean;
}

export interface PlayerStatusState {
  readonly id: StatusId;
  readonly sourceId: string | null;
  readonly stacks: number;
  readonly remainingTurns: number | null;
  readonly expiresAtRound: number | null;
  readonly visibility: "public" | "private";
  readonly data: JsonObject;
}

export interface AbilityState {
  readonly id: AbilityId;
  readonly usesRemaining: number | null;
  readonly cooldownLapsRemaining: number;
  readonly data: JsonObject;
}

/**
 * A player's recurring cost of existing at their current rank — the money sink
 * that makes promotion a trade-off rather than a free upgrade.
 *
 * `perRound` is resolved from `GameState.rules.economy.upkeepByRankIndex` at the
 * player's rank index, never from a constant.
 */
export interface UpkeepState {
  readonly perRound: number;
  readonly lastChargedRound: number;
  readonly missedPayments: number;
}

export interface LoanState {
  readonly id: LoanId;
  readonly principal: number;
  readonly outstanding: number;
  readonly interestBasisPoints: number;
  readonly takenAtRound: number;
}

export interface IncomeStreamState {
  readonly id: IncomeStreamId;
  readonly kind: "asset" | "rent" | "project" | "side-gig";
  readonly perRound: number;
  /** `null` means it never expires on its own. */
  readonly remainingRounds: number | null;
  readonly sourceId: string | null;
}

/**
 * HR suspicion: the price of aggression.
 *
 * Attacking raises `value`; crossing `threshold` opens an investigation prompt
 * against the *attacker*. Without this, every table alpha-strikes the leader
 * every match.
 */
export interface HeatState {
  readonly value: number;
  readonly threshold: number;
  readonly investigationsOpened: number;
  readonly lastIncrementedAtRound: number | null;
}

export interface PlayerState {
  readonly id: PlayerId;
  readonly order: number;
  readonly connected: boolean;
  readonly position: number;
  readonly lapsCompleted: number;
  readonly rank: RankState;
  readonly role: RoleState;
  readonly characterId: CharacterId;
  readonly resources: Readonly<Record<string, ResourceState>>;
  readonly tokens: Readonly<Record<string, TokenState>>;
  readonly hand: readonly CardInstanceId[];
  readonly statuses: readonly PlayerStatusState[];
  readonly abilities: readonly AbilityState[];
  readonly skipTurns: number;
  readonly inAudit: boolean;
  /**
   * How many negative effects this player's `ignoreNegativeEffect` passive has
   * already absorbed during the lap they are currently on. Lives in canonical
   * state (not a closure) so it serializes and replays; reset to 0 by the
   * movement that completes a lap.
   */
  readonly negativeEffectsIgnoredThisLap: number;
  readonly upkeep: UpkeepState;
  readonly loans: readonly LoanState[];
  readonly incomeStreams: readonly IncomeStreamState[];
  readonly heat: HeatState;
}

export type CardZone =
  | "draw-pile"
  | "discard-pile"
  | "hand"
  | "visible"
  | "resolving"
  | "removed";

export interface CardState {
  readonly id: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly deckId: DeckId;
  readonly zone: CardZone;
  readonly ownerId: PlayerId | null;
  readonly faceUp: boolean;
  readonly data: JsonObject;
}

export interface DeckState {
  readonly id: DeckId;
  readonly kind: DeckKind | null;
  readonly drawPile: readonly CardInstanceId[];
  readonly discardPile: readonly CardInstanceId[];
  readonly visibleCards: readonly CardInstanceId[];
  readonly reshufflesWhenEmpty: boolean;
  readonly managementShuffleEligible: boolean;
  readonly shuffleCount: number;
}

export type FrameKind =
  | "resolve-turn-start"
  | "resolve-movement"
  | "resolve-tile"
  | "draw-card"
  | "resolve-card"
  | "apply-effect"
  | "open-prompt"
  | "open-reaction-window"
  | "resolve-promotion"
  | "check-win-conditions"
  | "finish-turn"
  | "custom";

export type StateVisibility = "public" | "private" | "sealed" | "server";

export interface ResolutionFrame {
  readonly id: FrameId;
  readonly kind: FrameKind;
  readonly parentFrameId: FrameId | null;
  readonly sourceId: string | null;
  readonly actingPlayerId: PlayerId | null;
  readonly affectedPlayerIds: readonly PlayerId[];
  readonly remainingOperations: readonly JsonValue[];
  readonly capturedValues: JsonObject;
  readonly visibility: StateVisibility;
}

export interface PromptOption {
  readonly id: PromptOptionId;
  readonly value: JsonValue;
}

export interface PromptResponse {
  readonly optionId: PromptOptionId;
  readonly value: JsonValue;
}

export interface PromptState {
  readonly id: DecisionPointId;
  readonly frameId: FrameId;
  readonly kind: string;
  readonly audience: readonly PlayerId[];
  readonly legalResponses: readonly PromptOption[];
  readonly deadlineAt: LogicalTimestamp | null;
  readonly defaultResponse: PromptResponse;
  readonly visibility: "public" | "private" | "sealed";
  readonly responses: Readonly<Record<string, PromptResponse>>;
}

export interface PendingEffectState {
  readonly id: EffectId;
  readonly frameId: FrameId;
  readonly sourceId: string | null;
  readonly affectedPlayerIds: readonly PlayerId[];
  readonly effect: JsonObject;
  readonly preventionEligible: boolean;
  readonly visibility: StateVisibility;
}

export interface ReactionWindowState {
  readonly id: DecisionPointId;
  readonly frameId: FrameId;
  readonly kind: "prevention" | "end-turn" | "promotion-block";
  readonly eligiblePlayerIds: readonly PlayerId[];
  readonly priorityPlayerId: PlayerId | null;
  readonly passedPlayerIds: readonly PlayerId[];
  readonly playedByPlayerIds: readonly PlayerId[];
  readonly deadlineAt: LogicalTimestamp | null;
  readonly pendingEffectId: EffectId | null;
}

/**
 * Per-tile mutable ownership. The first genuinely shared, contestable state in
 * the game: a tile someone else owns is a tile that costs you money to land on.
 */
export interface TileOwnershipState {
  readonly tileId: TileId;
  readonly ownerId: PlayerId;
  /** 0 = claimed, >0 = upgraded. */
  readonly level: number;
  readonly claimedAtRound: number;
  readonly tollPaidCount: number;
}

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

export interface PlacementState {
  readonly id: PlacementId;
  readonly kind: PlacementKind;
  readonly tileId: TileId;
  readonly ownerId: PlayerId;
  readonly charges: number;
  readonly visibility: "public" | "owner-only";
  readonly placedAtRound: number;
  readonly data: JsonObject;
}

export type ProjectStatus = "open" | "funded" | "completed" | "failed";

export interface ProjectContribution {
  readonly playerId: PlayerId;
  readonly money: number;
  readonly work: number;
  readonly atRound: number;
}

export interface ProjectSabotage {
  readonly playerId: PlayerId;
  readonly amount: number;
  /** Hidden sabotage is revealed only on resolution — see the spec's §7.3. */
  readonly hidden: boolean;
  readonly atRound: number;
}

export interface ProjectPayout {
  readonly money: number;
  readonly reputation: number;
  readonly objectiveProgress: number;
}

/**
 * A public, multi-turn commitment with a stake: simultaneously a money sink,
 * something placed in shared space, a reason to co-operate, and something worth
 * ruining.
 */
export interface ProjectState {
  readonly id: ProjectId;
  readonly definitionId: string;
  readonly leadPlayerId: PlayerId;
  readonly tileId: TileId | null;
  readonly status: ProjectStatus;
  readonly requiredMoney: number;
  readonly requiredWork: number;
  readonly contributions: readonly ProjectContribution[];
  readonly sabotage: readonly ProjectSabotage[];
  readonly deadlineRound: number;
  readonly payout: ProjectPayout;
  readonly openToJoin: boolean;
  /** Contributors share the payout pro rata; the lead takes this slice on top. */
  readonly leadBonusBasisPoints: number;
}

export type TradeItem =
  | { readonly kind: "money"; readonly amount: number }
  | { readonly kind: "card"; readonly cardId: CardInstanceId }
  | { readonly kind: "token"; readonly tokenId: TokenId; readonly quantity: number }
  | { readonly kind: "tile"; readonly tileId: TileId }
  | { readonly kind: "immunity"; readonly rounds: number }
  /** Unenforceable. Recorded so the table can see who broke what. */
  | { readonly kind: "promise"; readonly text: string };

export type AgreementStatus =
  | "offered"
  | "accepted"
  | "declined"
  | "expired"
  | "settled"
  | "broken";

/**
 * A multi-party offer. Transfers are enforced; promises are not — betrayal is
 * the point, and engineering it away removes the only reason table talk matters.
 *
 * Affordability is validated at *accept* time, not offer time, so a stale offer
 * cannot be cashed after the state it referenced has changed.
 */
export interface AgreementState {
  readonly id: AgreementId;
  readonly proposerId: PlayerId;
  readonly recipientIds: readonly PlayerId[];
  readonly give: readonly TradeItem[];
  readonly receive: readonly TradeItem[];
  readonly status: AgreementStatus;
  readonly offeredAtRound: number;
  readonly expiresAtRound: number;
  readonly acceptedBy: readonly PlayerId[];
  readonly visibility: "public" | "parties-only";
}

export type WinPath = "promotion" | "wealth" | "influence" | "survival";

export interface ObjectiveState {
  readonly id: ObjectiveId;
  readonly definitionId: string;
  /** `null` = table-wide rather than owned by one player. */
  readonly ownerId: PlayerId | null;
  readonly progress: number;
  readonly target: number;
  readonly completedAtRound: number | null;
  readonly visibility: "public" | "secret";
  readonly rewardPoints: number;
  readonly rewardMoney: number;
}

export interface ScoreBreakdown {
  readonly playerId: PlayerId;
  readonly rankPoints: number;
  readonly moneyPoints: number;
  readonly reputationPoints: number;
  readonly objectivePoints: number;
  readonly ownershipPoints: number;
  readonly projectPoints: number;
  readonly penaltyPoints: number;
  readonly total: number;
}

export interface QuarterState {
  readonly index: number;
  readonly startedAtRound: number;
  readonly endsAtRound: number;
  /**
   * Announced when the quarter opens so players can position for it: a
   * known-in-advance shock is a decision, an unannounced one is just variance.
   */
  readonly scheduledEventId: string | null;
  readonly resolvedEventIds: readonly string[];
}

/**
 * A vote or an auction: the first first-class resolvable whose outcome is
 * decided by several players at once.
 */
export interface BallotState {
  readonly id: BallotId;
  readonly kind: "vote" | "auction";
  readonly subjectId: string;
  readonly subject: JsonObject;
  readonly audience: readonly PlayerId[];
  /** Keyed by `PlayerId`. Never projected in flight while `visibility` is sealed. */
  readonly castBy: Readonly<Record<string, JsonValue>>;
  readonly deadlineAt: LogicalTimestamp | null;
  readonly closesAtRound: number;
  /** Sealed until close: nobody sees votes or bids in flight. */
  readonly visibility: "open" | "sealed";
  readonly resolution: JsonObject | null;
}

export interface RngStreamState {
  readonly algorithm: string;
  readonly version: string;
  readonly state: string;
  readonly cursor: number;
}

export interface RngState {
  readonly streams: Readonly<Record<string, RngStreamState>>;
}

export interface TurnState {
  readonly number: number;
  readonly round: number;
  readonly activePlayerId: PlayerId | null;
  readonly phase: TurnPhase;
  readonly startedAt: LogicalTimestamp | null;
  readonly deadlineAt: LogicalTimestamp | null;
}

export interface MarathonEndgameState {
  readonly startedAtRound: number;
  readonly finalRound: number;
  readonly triggerPlayerId: PlayerId;
}

export type MatchEndReason =
  | "director-reached"
  | "clock-deck-exhausted"
  | "marathon-scored"
  | "terminated-no-contest"
  | "quarters-elapsed"
  | "objectives-complete"
  | "last-standing";

export interface MatchOutcome {
  readonly reason: MatchEndReason;
  readonly winnerPlayerIds: readonly PlayerId[];
  readonly winningRole: RoleKind | null;
  readonly endedAt: LogicalTimestamp;
  /**
   * Every player's final score, whatever the end reason. A race win still fills
   * this in so the end screen can show the table how close it was.
   */
  readonly scores: readonly ScoreBreakdown[];
  /** Which of `rules.winPaths` decided it; `null` when no path applies. */
  readonly winPath: WinPath | null;
  readonly data: JsonObject;
}

export interface EngineQuarantineState {
  readonly errorCode: string;
  readonly message: string;
  readonly commandId: CommandId | null;
  readonly frameId: FrameId | null;
  readonly diagnostics: JsonObject;
}

export interface GameState {
  readonly gameId: GameId;
  readonly modeId: ModeId;
  /**
   * The resolved ruleset, **snapshotted at creation and frozen for the match**.
   *
   * Never read rules live from `@office-ladder/content` inside a transition: a
   * match must replay identically after the content pack changes, and a custom
   * mode (spec §8.4) has no content entry to read from at all.
   */
  readonly rules: ModeRules;
  readonly versions: VersionState;
  readonly status: GameStatus;
  readonly revision: number;
  readonly eventSequence: number;
  readonly startAuthorizedPlayerId: PlayerId;
  readonly playerOrder: readonly PlayerId[];
  readonly players: Readonly<Record<string, PlayerState>>;
  readonly turn: TurnState;
  readonly boardSize: number;
  readonly tileIds: readonly TileId[];
  readonly decks: Readonly<Record<string, DeckState>>;
  readonly cards: Readonly<Record<string, CardState>>;
  readonly resolutionStack: readonly ResolutionFrame[];
  readonly prompts: readonly PromptState[];
  readonly pendingEffects: readonly PendingEffectState[];
  readonly reactionWindows: readonly ReactionWindowState[];
  /** Keyed by `TileId`. Absent key = unowned. */
  readonly tileOwnership: Readonly<Record<string, TileOwnershipState>>;
  readonly placements: readonly PlacementState[];
  readonly projects: readonly ProjectState[];
  readonly agreements: readonly AgreementState[];
  readonly objectives: readonly ObjectiveState[];
  readonly ballots: readonly BallotState[];
  /** Empty when `rules.quarters.enabled` is false. */
  readonly quarters: readonly QuarterState[];
  readonly currentQuarterIndex: number;
  readonly eliminatedPlayerIds: readonly PlayerId[];
  readonly rng: RngState;
  readonly marathonEndgame: MarathonEndgameState | null;
  readonly outcome: MatchOutcome | null;
  readonly quarantine: EngineQuarantineState | null;
  readonly lastCommandId: CommandId | null;
  readonly stateHash: StateHash | null;
}
