import type {
  CharacterId,
  ContentReleaseId,
  EngineErrorCode,
  GameId,
  GameState,
  ModeId,
  PlayerId,
  RankId,
  RoleId,
  RoleKind,
  RulesetId,
  TileId,
} from "../model";

export type SetupPlayer = {
  readonly id: PlayerId;
  readonly order: number;
  readonly characterId: CharacterId;
  readonly role: {
    readonly id: RoleId;
    readonly kind: RoleKind;
  };
};

export type GameSetup = {
  readonly gameId: GameId;
  readonly modeId: ModeId;
  readonly players: readonly SetupPlayer[];
  readonly authorizedStarterId: PlayerId;
};

export type SetupModeContent = {
  readonly id: string;
  readonly startingResources: {
    readonly money: number;
    readonly reputation: number;
    readonly energy: number;
    readonly workCounter: number;
  };
  readonly startingTokens: Readonly<Record<string, number | undefined>>;
  readonly tokenCaps: Readonly<Record<string, number>>;
};

export type SetupContent = {
  readonly rulesetId: string;
  readonly board: {
    readonly spaces: readonly { readonly id: string }[];
  };
  readonly modes: Readonly<Record<string, SetupModeContent>>;
  readonly ranks: readonly { readonly id: string; readonly tier: number }[];
  readonly characters: Readonly<Record<string, { readonly id: string }>>;
};

export type SetupGameState = GameState;

export type SetupErrorCode =
  | EngineErrorCode
  | "INVALID_PLAYER_COUNT"
  | "DUPLICATE_PLAYER_ID"
  | "DUPLICATE_CHARACTER_ID"
  | "INVALID_PLAYER_ORDER"
  | "AUTHORIZED_STARTER_NOT_FOUND"
  | "UNSUPPORTED_MODE"
  | "INVALID_CONTENT";

export type SetupEngineError = {
  readonly name: "EngineError";
  readonly code: SetupErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly gameId: GameId | null;
  readonly commandId: null;
  readonly actorId: PlayerId | null;
  readonly decisionPointId: null;
  readonly frameId: null;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
};

export type SetupResult =
  | { readonly ok: true; readonly value: SetupGameState }
  | { readonly ok: false; readonly error: SetupEngineError };

export type SetupIds = {
  readonly contentReleaseId: ContentReleaseId;
  readonly internRankId: RankId;
  readonly rulesetId: RulesetId;
  readonly tileIds: readonly TileId[];
};
