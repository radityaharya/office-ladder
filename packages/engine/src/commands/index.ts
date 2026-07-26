import type { PlacementKind, TradeItem } from "../model/game";
import type {
  AbilityId,
  AgreementId,
  BallotId,
  CardInstanceId,
  CommandId,
  DecisionPointId,
  DeckId,
  GameId,
  LoanId,
  PlayerId,
  ProjectId,
  PromptOptionId,
  TileId,
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

/**
 * Spend energy to shift the roll. `pips` may be negative; its magnitude is
 * bounded by `rules.agency.maxPipAdjust` and priced at
 * `rules.agency.energyPerPip`.
 */
export type AdjustRollCommand = CommandEnvelope<
  "turn.adjust-roll",
  { readonly pips: number }
>;
/**
 * The free action — work / network / scheme / rest — and the main answer to
 * "the only verb is roll". How many are available per turn comes from
 * `rules.agency.freeActionsPerTurn`.
 */
export type TakeTurnActionCommand = CommandEnvelope<
  "turn.action",
  {
    readonly action: string;
    readonly targetPlayerIds: readonly PlayerId[];
    readonly choice: JsonValue;
  }
>;
/** Only legal when `rules.agency.promotionIsChoice`. */
export type DeclinePromotionCommand = CommandEnvelope<
  "promotion.decline",
  Record<string, never>
>;
export type ClaimTileCommand = CommandEnvelope<
  "tile.claim",
  { readonly tileId: TileId }
>;
export type UpgradeTileCommand = CommandEnvelope<
  "tile.upgrade",
  { readonly tileId: TileId }
>;
export type PlacePlacementCommand = CommandEnvelope<
  "placement.place",
  {
    readonly kind: PlacementKind;
    readonly tileId: TileId;
  }
>;
export type StartProjectCommand = CommandEnvelope<
  "project.start",
  {
    readonly definitionId: string;
    readonly tileId: TileId | null;
    readonly openToJoin: boolean;
  }
>;
export type ContributeToProjectCommand = CommandEnvelope<
  "project.contribute",
  {
    readonly projectId: ProjectId;
    readonly money: number;
    readonly work: number;
  }
>;
/** Raises the actor's heat. */
export type SabotageProjectCommand = CommandEnvelope<
  "project.sabotage",
  {
    readonly projectId: ProjectId;
    readonly amount: number;
    readonly hidden: boolean;
  }
>;
export type OfferAgreementCommand = CommandEnvelope<
  "agreement.offer",
  {
    readonly recipientIds: readonly PlayerId[];
    readonly give: readonly TradeItem[];
    readonly receive: readonly TradeItem[];
    readonly expiresAtRound: number;
    readonly visibility: "public" | "parties-only";
  }
>;
export type RespondToAgreementCommand = CommandEnvelope<
  "agreement.respond",
  {
    readonly agreementId: AgreementId;
    readonly accept: boolean;
  }
>;
/** Raises the actor's heat. */
export type TargetAttackCommand = CommandEnvelope<
  "attack.target",
  {
    readonly targetPlayerId: PlayerId;
    readonly vector: string;
    readonly cardId: CardInstanceId | null;
  }
>;
/** Votes and auction bids share this command; `value` is interpreted per ballot kind. */
export type CastBallotCommand = CommandEnvelope<
  "ballot.cast",
  {
    readonly ballotId: BallotId;
    readonly value: JsonValue;
  }
>;
export type TakeLoanCommand = CommandEnvelope<
  "loan.take",
  { readonly principal: number }
>;
export type RepayLoanCommand = CommandEnvelope<
  "loan.repay",
  {
    readonly loanId: LoanId;
    readonly amount: number;
  }
>;
/**
 * A wall-clock boundary crossing, **server-injected only** (spec §7.1): the
 * engine writes `deadlineAt` and takes no further interest, and the server's
 * scheduler submits this through the ordinary command path. Must be rejected
 * when it arrives from a player, and must be idempotent — firing twice cannot
 * double-resolve, and a window whose deadline already passed resolves on load.
 */
export type ExpireWindowCommand = CommandEnvelope<
  "window.expire",
  { readonly decisionPointId: DecisionPointId }
>;
/** Engine-internal or server-injected; never accepted from a player. */
export type AdvanceQuarterCommand = CommandEnvelope<
  "quarter.advance",
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
  | TurnTimeoutCommand
  | AdjustRollCommand
  | TakeTurnActionCommand
  | DeclinePromotionCommand
  | ClaimTileCommand
  | UpgradeTileCommand
  | PlacePlacementCommand
  | StartProjectCommand
  | ContributeToProjectCommand
  | SabotageProjectCommand
  | OfferAgreementCommand
  | RespondToAgreementCommand
  | TargetAttackCommand
  | CastBallotCommand
  | TakeLoanCommand
  | RepayLoanCommand
  | ExpireWindowCommand
  | AdvanceQuarterCommand;

export type GameCommandType = GameCommand["type"];
