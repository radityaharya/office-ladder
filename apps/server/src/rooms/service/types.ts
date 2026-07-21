import type {
  GameBootstrap,
  RoomBootstrap,
  RoomCapacity,
  RoomMode,
  RoomStatus,
} from "@office-ladder/contracts";
import type {
  CommandId,
  EngineErrorCode,
  GameId,
  GameState,
  PlayerId,
  SetupErrorCode,
} from "@office-ladder/engine";

export type StoredRoom = {
  readonly id: string;
  readonly code: string;
  readonly hostId: PlayerId;
  readonly memberIds: readonly PlayerId[];
  readonly modeId: RoomMode;
  readonly capacity: RoomCapacity;
  readonly status: RoomStatus;
  readonly revision: number;
  readonly createdAt: string;
  readonly game: GameState | null;
  readonly eventSummaries: readonly {
    readonly id: string;
    readonly type: string;
    readonly revision: number;
    readonly occurredAt: string;
    readonly actorPlayerId: string | null;
  }[];
};

export interface RoomRepository {
  create(room: StoredRoom): Promise<void>;
  get(id: string): Promise<StoredRoom | null>;
  getByCode?(code: string): Promise<StoredRoom | null>;
  save(room: StoredRoom): Promise<void>;
}

export type ActiveStoredRoom = Omit<StoredRoom, "game" | "status"> & {
  readonly status: "active";
  readonly game: GameState;
};

export type RoomServiceErrorCode =
  | EngineErrorCode
  | SetupErrorCode
  | "ROOM_NOT_FOUND"
  | "ROOM_CODE_NOT_FOUND"
  | "ROOM_NOT_OPEN"
  | "ROOM_FULL"
  | "ACTOR_ALREADY_MEMBER"
  | "ACTOR_NOT_MEMBER"
  | "ACTOR_NOT_HOST"
  | "MINIMUM_PLAYERS_NOT_MET"
  | "GAME_NOT_ACTIVE";

export type RoomServiceError = {
  readonly code: RoomServiceErrorCode;
};

export type RoomServiceResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: RoomServiceError };

export type RoomServiceDependencies = {
  readonly repository: RoomRepository;
  readonly now: () => string;
  readonly ids: {
    readonly roomId: () => string;
    readonly roomCode?: () => string;
    readonly gameId: () => GameId;
    readonly commandId: () => CommandId;
  };
  readonly gameSeed: () => string;
};

export type CreateRoomInput = {
  readonly hostId: string;
  readonly modeId?: RoomMode;
  readonly mode?: RoomMode;
  readonly capacity?: RoomCapacity;
};

export type JoinRoomInput = {
  readonly roomId: string;
  readonly actorId: string;
};

export type JoinRoomByCodeInput = {
  readonly roomCode: string;
  readonly actorId: string;
};

export type RoomActorInput = {
  readonly roomId: string;
  readonly actorId: string;
  readonly commandId?: string;
  readonly expectedRevision?: number;
};

export type RollRoomInput = RoomActorInput & {
  readonly expectedRevision: number;
};

export type RespondToPromptRoomInput = RoomActorInput & {
  readonly expectedRevision: number;
  readonly decisionPointId: string;
  readonly optionId: string;
};

export type BootstrapRoomInput = {
  readonly roomId: string;
  readonly viewerId: string;
};

export interface RoomService {
  create(input: CreateRoomInput): Promise<RoomServiceResult<StoredRoom>>;
  join(input: JoinRoomInput): Promise<RoomServiceResult<StoredRoom>>;
  joinByCode(input: JoinRoomByCodeInput): Promise<RoomServiceResult<StoredRoom>>;
  bootstrap(
    input: BootstrapRoomInput,
  ): Promise<RoomServiceResult<RoomBootstrap | GameBootstrap>>;
  start(input: RoomActorInput): Promise<RoomServiceResult<ActiveStoredRoom>>;
  roll(input: RollRoomInput): Promise<RoomServiceResult<ActiveStoredRoom>>;
  respondToPrompt(
    input: RespondToPromptRoomInput,
  ): Promise<RoomServiceResult<ActiveStoredRoom>>;
}
