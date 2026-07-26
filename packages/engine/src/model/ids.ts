declare const idBrand: unique symbol;

export type StableId<Kind extends string> = string & {
  readonly [idBrand]: Kind;
};

export type AbilityId = StableId<"AbilityId">;
export type AgreementId = StableId<"AgreementId">;
export type BallotId = StableId<"BallotId">;
export type CardDefinitionId = StableId<"CardDefinitionId">;
export type CardInstanceId = StableId<"CardInstanceId">;
export type CharacterId = StableId<"CharacterId">;
export type CommandId = StableId<"CommandId">;
export type ContentReleaseId = StableId<"ContentReleaseId">;
export type DecisionPointId = StableId<"DecisionPointId">;
export type DeckId = StableId<"DeckId">;
export type EffectId = StableId<"EffectId">;
export type EventId = StableId<"EventId">;
export type FrameId = StableId<"FrameId">;
export type GameId = StableId<"GameId">;
export type IncomeStreamId = StableId<"IncomeStreamId">;
export type LoanId = StableId<"LoanId">;
export type ModeId = StableId<"ModeId">;
export type ObjectiveId = StableId<"ObjectiveId">;
export type PlacementId = StableId<"PlacementId">;
export type PlayerId = StableId<"PlayerId">;
export type ProjectId = StableId<"ProjectId">;
export type PromptOptionId = StableId<"PromptOptionId">;
export type RankId = StableId<"RankId">;
export type ResourceId = StableId<"ResourceId">;
export type RoleId = StableId<"RoleId">;
export type RulesetId = StableId<"RulesetId">;
export type StatusId = StableId<"StatusId">;
export type TileId = StableId<"TileId">;
export type TokenId = StableId<"TokenId">;

export type StableIdKind =
  | "AbilityId"
  | "AgreementId"
  | "BallotId"
  | "CardDefinitionId"
  | "CardInstanceId"
  | "CharacterId"
  | "CommandId"
  | "ContentReleaseId"
  | "DecisionPointId"
  | "DeckId"
  | "EffectId"
  | "EventId"
  | "FrameId"
  | "GameId"
  | "IncomeStreamId"
  | "LoanId"
  | "ModeId"
  | "ObjectiveId"
  | "PlacementId"
  | "PlayerId"
  | "ProjectId"
  | "PromptOptionId"
  | "RankId"
  | "ResourceId"
  | "RoleId"
  | "RulesetId"
  | "StatusId"
  | "TileId"
  | "TokenId";

export type StableIdByKind = {
  readonly AbilityId: AbilityId;
  readonly AgreementId: AgreementId;
  readonly BallotId: BallotId;
  readonly CardDefinitionId: CardDefinitionId;
  readonly CardInstanceId: CardInstanceId;
  readonly CharacterId: CharacterId;
  readonly CommandId: CommandId;
  readonly ContentReleaseId: ContentReleaseId;
  readonly DecisionPointId: DecisionPointId;
  readonly DeckId: DeckId;
  readonly EffectId: EffectId;
  readonly EventId: EventId;
  readonly FrameId: FrameId;
  readonly GameId: GameId;
  readonly IncomeStreamId: IncomeStreamId;
  readonly LoanId: LoanId;
  readonly ModeId: ModeId;
  readonly ObjectiveId: ObjectiveId;
  readonly PlacementId: PlacementId;
  readonly PlayerId: PlayerId;
  readonly ProjectId: ProjectId;
  readonly PromptOptionId: PromptOptionId;
  readonly RankId: RankId;
  readonly ResourceId: ResourceId;
  readonly RoleId: RoleId;
  readonly RulesetId: RulesetId;
  readonly StatusId: StatusId;
  readonly TileId: TileId;
  readonly TokenId: TokenId;
};

export function createStableId<Kind extends StableIdKind>(
  kind: Kind,
  value: string,
): StableIdByKind[Kind];
export function createStableId(_kind: StableIdKind, value: string): string {
  if (value.length === 0) {
    throw new TypeError("Stable ID value must be a non-empty string");
  }

  return value;
}
