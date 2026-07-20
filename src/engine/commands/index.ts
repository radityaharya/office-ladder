import type {
  AbilityId,
  CardInstanceId,
  CommandId,
  DecisionPointId,
  DeckId,
  GameId,
  PlayerId,
  PromptOptionId,
  TokenId,
} from "../model/ids";
import type { JsonValue } from "../model/json";

export interface CommandEnvelope<Type extends string, Payload> {
  readonly commandId: CommandId;
  readonly gameId: GameId;
  readonly actorId: PlayerId;
  readonly expectedRevision: number;
  readonly type: Type;
  readonly payload: Payload;
}

export interface DecisionCommandEnvelope<Type extends string, Payload>
  extends CommandEnvelope<Type, Payload> {
  readonly decisionPointId: DecisionPointId;
}

export type StartGameCommand = CommandEnvelope<"game.start", Record<string, never>>;
export type RollTurnCommand = CommandEnvelope<"turn.roll", Record<string, never>>;
export type PlayCardCommand = CommandEnvelope<
  "turn.play-card",
  {
    readonly cardId: CardInstanceId;
    readonly targetPlayerIds: readonly PlayerId[];
    readonly choice: JsonValue;
  }
>;
export type ActivateCharacterCommand = CommandEnvelope<
  "turn.activate-character",
  {
    readonly abilityId: AbilityId;
    readonly targetPlayerIds: readonly PlayerId[];
    readonly choice: JsonValue;
  }
>;
export type SpendTokenCommand = CommandEnvelope<
  "turn.spend-token",
  {
    readonly tokenId: TokenId;
    readonly quantity: number;
    readonly use: string;
  }
>;
export type RespondToPromptCommand = DecisionCommandEnvelope<
  "prompt.respond",
  {
    readonly optionId: PromptOptionId;
    readonly value: JsonValue;
  }
>;
export type PlayReactionCommand = DecisionCommandEnvelope<
  "reaction.play",
  {
    readonly cardId: CardInstanceId | null;
    readonly abilityId: AbilityId | null;
    readonly targetPlayerIds: readonly PlayerId[];
    readonly choice: JsonValue;
  }
>;
export type PassReactionCommand = DecisionCommandEnvelope<
  "reaction.pass",
  Record<string, never>
>;
export type PayAuditFineCommand = CommandEnvelope<
  "audit.pay-fine",
  Record<string, never>
>;
export type AttemptPromotionCommand = CommandEnvelope<
  "promotion.attempt",
  Record<string, never>
>;
export type ShuffleManagementDeckCommand = CommandEnvelope<
  "management.shuffle-deck",
  { readonly deckId: DeckId }
>;
export type BlockPromotionCommand = DecisionCommandEnvelope<
  "management.block-promotion",
  Record<string, never>
>;
export type TurnTimeoutCommand = DecisionCommandEnvelope<
  "turn.timeout",
  Record<string, never>
>;

export type GameCommand =
  | StartGameCommand
  | RollTurnCommand
  | PlayCardCommand
  | ActivateCharacterCommand
  | SpendTokenCommand
  | RespondToPromptCommand
  | PlayReactionCommand
  | PassReactionCommand
  | PayAuditFineCommand
  | AttemptPromotionCommand
  | ShuffleManagementDeckCommand
  | BlockPromotionCommand
  | TurnTimeoutCommand;

export type GameCommandType = GameCommand["type"];
