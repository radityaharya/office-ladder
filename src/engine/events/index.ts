import type {
  CardInstanceId,
  CommandId,
  DeckId,
  EffectId,
  EventId,
  FrameId,
  GameId,
  PlayerId,
  RankId,
  ResourceId,
  StatusId,
  TileId,
} from "../model/ids";
import type { JsonObject } from "../model/json";
import type {
  LogicalTimestamp,
  MatchOutcome,
  PromptState,
  ReactionWindowState,
  RoleKind,
  TurnPhase,
} from "../model/game";

export type EventVisibility =
  | { readonly kind: "public" }
  | { readonly kind: "private"; readonly playerIds: readonly PlayerId[] }
  | { readonly kind: "sealed"; readonly playerIds: readonly PlayerId[] }
  | { readonly kind: "server" };

export interface EventEnvelope<Type extends string, Payload> {
  readonly eventId: EventId;
  readonly gameId: GameId;
  readonly sequence: number;
  readonly revision: number;
  readonly causationCommandId: CommandId;
  readonly correlationFrameId: FrameId | null;
  readonly logicalTimestamp: LogicalTimestamp;
  readonly schemaVersion: number;
  readonly visibility: EventVisibility;
  readonly type: Type;
  readonly payload: Payload;
}

export type GameStartedEvent = EventEnvelope<
  "GameStarted",
  { readonly playerOrder: readonly PlayerId[] }
>;
export type TurnStartedEvent = EventEnvelope<
  "TurnStarted",
  {
    readonly playerId: PlayerId;
    readonly turnNumber: number;
    readonly round: number;
    readonly phase: TurnPhase;
    readonly deadlineAt: LogicalTimestamp | null;
  }
>;
export type DiceRolledEvent = EventEnvelope<
  "DiceRolled",
  {
    readonly playerId: PlayerId;
    readonly dice: readonly number[];
    readonly total: number;
    readonly purpose: string;
    readonly rngStream: string;
    readonly rngCursor: number;
  }
>;
export type PlayerMovedEvent = EventEnvelope<
  "PlayerMoved",
  {
    readonly playerId: PlayerId;
    readonly from: number;
    readonly to: number;
    readonly distance: number;
    readonly direction: "forward" | "backward" | "teleport";
    readonly lapsGained: number;
  }
>;
export type SalaryAwardedEvent = EventEnvelope<
  "SalaryAwarded",
  { readonly playerId: PlayerId; readonly amount: number; readonly rankId: RankId }
>;
export type TileResolvedEvent = EventEnvelope<
  "TileResolved",
  { readonly playerId: PlayerId; readonly tileId: TileId; readonly position: number }
>;
export type CardDrawnEvent = EventEnvelope<
  "CardDrawn",
  { readonly playerId: PlayerId | null; readonly cardId: CardInstanceId; readonly deckId: DeckId }
>;
export type CardStoredEvent = EventEnvelope<
  "CardStored",
  { readonly playerId: PlayerId; readonly cardId: CardInstanceId }
>;
export type CardPlayedEvent = EventEnvelope<
  "CardPlayed",
  { readonly playerId: PlayerId; readonly cardId: CardInstanceId; readonly targets: readonly PlayerId[] }
>;
export type EffectProposedEvent = EventEnvelope<
  "EffectProposed",
  { readonly effectId: EffectId; readonly affectedPlayerIds: readonly PlayerId[]; readonly effect: JsonObject }
>;
export type EffectPreventedEvent = EventEnvelope<
  "EffectPrevented",
  { readonly effectId: EffectId; readonly preventedByPlayerId: PlayerId; readonly sourceId: string }
>;
export type ResourceChangedEvent = EventEnvelope<
  "ResourceChanged",
  {
    readonly playerId: PlayerId;
    readonly resourceId: ResourceId;
    readonly previousValue: number;
    readonly newValue: number;
    readonly reason: string;
  }
>;
export type StatusAppliedEvent = EventEnvelope<
  "StatusApplied",
  { readonly playerId: PlayerId; readonly statusId: StatusId; readonly stacks: number; readonly data: JsonObject }
>;
export type PromptOpenedEvent = EventEnvelope<"PromptOpened", { readonly prompt: PromptState }>;
export type ReactionWindowOpenedEvent = EventEnvelope<
  "ReactionWindowOpened",
  { readonly reactionWindow: ReactionWindowState }
>;
export type PromotionAttemptedEvent = EventEnvelope<
  "PromotionAttempted",
  { readonly playerId: PlayerId; readonly fromRankId: RankId; readonly toRankId: RankId }
>;
export type PromotionBlockedEvent = EventEnvelope<
  "PromotionBlocked",
  { readonly playerId: PlayerId; readonly blockedByPlayerId: PlayerId }
>;
export type ManagementRevealedEvent = EventEnvelope<
  "ManagementRevealed",
  { readonly playerId: PlayerId; readonly role: RoleKind }
>;
export type PlayerPromotedEvent = EventEnvelope<
  "PlayerPromoted",
  { readonly playerId: PlayerId; readonly fromRankId: RankId; readonly toRankId: RankId; readonly cost: number }
>;
export type ClockDeckExhaustedEvent = EventEnvelope<
  "ClockDeckExhausted",
  { readonly remainingMeetingCards: number; readonly remainingEventCards: number }
>;
export type MatchEndedEvent = EventEnvelope<"MatchEnded", { readonly outcome: MatchOutcome }>;

export type GameEvent =
  | GameStartedEvent
  | TurnStartedEvent
  | DiceRolledEvent
  | PlayerMovedEvent
  | SalaryAwardedEvent
  | TileResolvedEvent
  | CardDrawnEvent
  | CardStoredEvent
  | CardPlayedEvent
  | EffectProposedEvent
  | EffectPreventedEvent
  | ResourceChangedEvent
  | StatusAppliedEvent
  | PromptOpenedEvent
  | ReactionWindowOpenedEvent
  | PromotionAttemptedEvent
  | PromotionBlockedEvent
  | ManagementRevealedEvent
  | PlayerPromotedEvent
  | ClockDeckExhaustedEvent
  | MatchEndedEvent;

export type GameEventType = GameEvent["type"];
