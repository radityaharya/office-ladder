import type { JsonObject, JsonValue } from "./json";
import type {
  AbilityId,
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
  ModeId,
  PlayerId,
  PromptOptionId,
  RankId,
  ResourceId,
  RoleId,
  RulesetId,
  StatusId,
  TileId,
  TokenId,
} from "./ids";

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
  | "terminated-no-contest";

export interface MatchOutcome {
  readonly reason: MatchEndReason;
  readonly winnerPlayerIds: readonly PlayerId[];
  readonly winningRole: RoleKind | null;
  readonly endedAt: LogicalTimestamp;
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
  readonly rng: RngState;
  readonly marathonEndgame: MarathonEndgameState | null;
  readonly outcome: MatchOutcome | null;
  readonly quarantine: EngineQuarantineState | null;
  readonly lastCommandId: CommandId | null;
  readonly stateHash: StateHash | null;
}
