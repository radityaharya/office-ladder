import type {
  AbilityId,
  CardDefinitionId,
  CardInstanceId,
  CharacterId,
  DecisionPointId,
  DeckId,
  DeckKind,
  GameStatus,
  JsonObject,
  JsonValue,
  LogicalTimestamp,
  MatchOutcome,
  PlayerId,
  PromptOptionId,
  RankState,
  ResourceState,
  RoleId,
  RoleKind,
  StatusId,
  TokenState,
  TurnState,
} from "../model";

export type PublicRoleProjection =
  | {
      readonly revealed: false;
    }
  | {
      readonly revealed: true;
      readonly kind: RoleKind | null;
    };

export interface PublicStatusProjection {
  readonly id: StatusId;
  readonly sourceId: string | null;
  readonly stacks: number;
  readonly remainingTurns: number | null;
  readonly expiresAtRound: number | null;
  readonly data: JsonObject;
}

export interface PublicPlayerProjection {
  readonly id: PlayerId;
  readonly order: number;
  readonly connected: boolean;
  readonly position: number;
  readonly lapsCompleted: number;
  readonly rank: RankState;
  readonly role: PublicRoleProjection;
  readonly resources: Readonly<Record<string, ResourceState>>;
  readonly tokens: Readonly<Record<string, TokenState>>;
  readonly statuses: readonly PublicStatusProjection[];
  readonly skipTurns: number;
  readonly inAudit: boolean;
}

export interface ProjectedCard {
  readonly id: CardInstanceId;
  readonly definitionId: CardDefinitionId;
  readonly deckId: DeckId;
  readonly data: JsonObject;
}

export interface PublicDeckProjection {
  readonly id: DeckId;
  readonly kind: DeckKind | null;
  readonly drawCount: number;
  readonly discardCount: number;
  readonly visibleCards: readonly ProjectedCard[];
}

export interface PublicGameProjection {
  readonly status: GameStatus;
  readonly revision: number;
  readonly turn: TurnState;
  readonly boardSize: number;
  readonly players: readonly PublicPlayerProjection[];
  readonly decks: readonly PublicDeckProjection[];
  readonly outcome: MatchOutcome | null;
}

export interface PrivateStatusProjection {
  readonly id: StatusId;
  readonly sourceId: string | null;
  readonly stacks: number;
  readonly remainingTurns: number | null;
  readonly expiresAtRound: number | null;
  readonly data: JsonObject;
}

export interface PrivateAbilityProjection {
  readonly id: AbilityId;
  readonly usesRemaining: number | null;
  readonly cooldownLapsRemaining: number;
  readonly data: JsonObject;
}

export interface PrivateRoleProjection {
  readonly id: RoleId;
  readonly kind: RoleKind | null;
  readonly revealed: boolean;
}

export interface SelfProjection {
  readonly role: PrivateRoleProjection;
  readonly characterId: CharacterId;
  readonly hand: readonly ProjectedCard[];
  readonly privateStatuses: readonly PrivateStatusProjection[];
  readonly abilities: readonly PrivateAbilityProjection[];
}

export interface PlayerPromptOptionProjection {
  readonly id: PromptOptionId;
  readonly value: JsonValue;
}

export interface PlayerPromptResponseProjection {
  readonly optionId: PromptOptionId;
  readonly value: JsonValue;
}

export interface PlayerPromptProjection {
  readonly id: DecisionPointId;
  readonly kind: string;
  readonly legalResponses: readonly PlayerPromptOptionProjection[];
  readonly deadlineAt: LogicalTimestamp | null;
  readonly defaultResponse: PlayerPromptResponseProjection;
  readonly response: PlayerPromptResponseProjection | null;
}

export interface PlayerReactionProjection {
  readonly id: DecisionPointId;
  readonly kind: "prevention" | "end-turn" | "promotion-block";
  readonly hasPriority: boolean;
  readonly hasPassed: boolean;
  readonly hasPlayed: boolean;
  readonly deadlineAt: LogicalTimestamp | null;
}

export interface PlayerGameProjection extends PublicGameProjection {
  readonly self: SelfProjection;
  readonly prompts: readonly PlayerPromptProjection[];
  readonly reactions: readonly PlayerReactionProjection[];
}
