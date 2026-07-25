export const ROOM_CAPACITIES = [3, 4, 5, 6] as const;

export const ROOM_MODES = ["mode.quick", "mode.marathon"] as const;

export type RoomCapacity = (typeof ROOM_CAPACITIES)[number];
export type RoomMode = (typeof ROOM_MODES)[number];
export type RoomStatus =
  | "open"
  | "starting"
  | "active"
  | "completed"
  | "abandoned";

export type CreateRoomRequest = {
  readonly mode: RoomMode;
  readonly capacity: RoomCapacity;
  readonly playerName: string;
};

export type JoinRoomRequest = {
  readonly roomCode: string;
  readonly playerName: string;
};

type RevisionCommandRequest = {
  readonly commandId: string;
  readonly expectedRevision: number;
};

export type StartGameRequest = RevisionCommandRequest;
export type RollRequest = RevisionCommandRequest;

export type RespondToPromptRequest = RevisionCommandRequest & {
  readonly decisionPointId: string;
  readonly optionId: string;
};

export type RoomMemberProjection = {
  readonly id: string;
  readonly displayName: string;
  readonly seat: number;
  readonly isHost: boolean;
  readonly isReady: boolean;
  readonly isConnected: boolean;
};

export type RoomProjection = {
  readonly id: string;
  readonly code: string;
  readonly status: RoomStatus;
  readonly mode: RoomMode;
  readonly capacity: RoomCapacity;
  readonly revision: number;
  readonly members: readonly RoomMemberProjection[];
};

export type RoomBootstrap = {
  readonly room: RoomProjection;
  readonly selfMemberId: string;
};

export type PublicRoleProjection =
  | { readonly revealed: false }
  | { readonly revealed: true; readonly kind: "role.worker" | "role.management" | null };

export type PublicPlayerProjection = {
  readonly id: string;
  readonly seat: number;
  readonly connected: boolean;
  readonly position: number;
  readonly lapsCompleted: number;
  readonly rank: {
    readonly id: string;
    readonly kind: string | null;
    readonly index: number;
  };
  readonly role: PublicRoleProjection;
  readonly resources: Readonly<Record<string, number>>;
  readonly tokens: Readonly<Record<string, number>>;
  readonly statusIds: readonly string[];
};

export type PublicGameProjection = {
  readonly id: string;
  readonly revision: number;
  readonly status: "setup" | "active" | "paused" | "ended";
  readonly activePlayerId: string | null;
  readonly turnNumber: number;
  readonly round: number;
  readonly phase: string;
  readonly deadlineAt: string | null;
  readonly players: readonly PublicPlayerProjection[];
  readonly eventSummaries: readonly SafeEventSummary[];
  readonly winnerPlayerIds: readonly string[];
};

export type CallerSelfProjection = {
  readonly playerId: string;
  readonly role: {
    readonly id: string;
    readonly kind: "role.worker" | "role.management" | null;
    readonly revealed: boolean;
  };
  readonly characterId: string;
  readonly hand: readonly {
    readonly id: string;
    readonly definitionId: string;
  }[];
  readonly privateStatusIds: readonly string[];
  readonly abilityIds: readonly string[];
};

export type PromptProjection = {
  readonly id: string;
  readonly kind: string;
  readonly deadlineAt: string | null;
  readonly optionIds: readonly string[];
};

export type ReactionProjection = {
  readonly id: string;
  readonly kind: "prevention" | "end-turn" | "promotion-block";
  readonly deadlineAt: string | null;
  readonly hasPriority: boolean;
  readonly hasPassed: boolean;
  readonly hasPlayed: boolean;
};

export type LegalActionSummary =
  | {
      readonly type: "game.start";
      readonly expectedRevision: number;
    }
  | {
      readonly type: "turn.roll";
      readonly expectedRevision: number;
    }
  | {
      readonly type: "prompt.respond";
      readonly expectedRevision: number;
      readonly decisionPointId: string;
      readonly kind: string;
      readonly options: readonly string[];
    };

type SafeEventSummaryMetadata = {
  readonly id: string;
  readonly type: string;
  readonly revision: number;
  readonly occurredAt: string;
  readonly actorPlayerId: string | null;
};

export type SafeEventSummary =
  | (SafeEventSummaryMetadata & {
      readonly type: "CardDrawn";
      readonly card: {
        readonly definitionId: string;
        readonly deckId: string;
        readonly nameKey: string;
      };
    })
  | (SafeEventSummaryMetadata & {
      readonly type:
        | "GameStarted"
        | "TurnStarted"
        | "DiceRolled"
        | "PlayerMoved"
        | "SalaryAwarded"
        | "TileResolved"
        | "CardStored"
        | "CardPlayed"
        | "EffectProposed"
        | "EffectPrevented"
        | "ResourceChanged"
        | "StatusApplied"
        | "PromptOpened"
        | "ReactionWindowOpened"
        | "PromotionAttempted"
        | "PromotionBlocked"
        | "ManagementRevealed"
        | "PlayerPromoted"
        | "ClockDeckExhausted"
        | "MatchEnded";
    });

export type GameBootstrap = {
  readonly room: RoomProjection;
  readonly publicProjection: PublicGameProjection;
  readonly self: CallerSelfProjection;
  readonly prompts: readonly PromptProjection[];
  readonly reactions: readonly ReactionProjection[];
  readonly legalActions: readonly LegalActionSummary[];
  readonly serverTime: string;
};

export class ContractValidationError extends Error {
  readonly name = "ContractValidationError";

  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path} ${reason}`);
  }
}

const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ContractValidationError(path, "must be an object");
  }

  return value;
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const expectedKeys = new Set(keys);
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length ||
    actualKeys.some((key) => !expectedKeys.has(key))
  ) {
    throw new ContractValidationError(path, "contains unknown or missing fields");
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ContractValidationError(path, "must be a string");
  }

  return value;
}

function requirePlayerName(value: unknown, path: string): string {
  const name = requireString(value, path).trim();
  if (name.length < 1 || name.length > 40) {
    throw new ContractValidationError(path, "must be between 1 and 40 characters");
  }

  return name;
}

function requireRevision(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ContractValidationError(path, "must be a non-negative safe integer");
  }

  return value;
}

function requireRoomMode(value: unknown, path: string): RoomMode {
  if (value !== "mode.quick" && value !== "mode.marathon") {
    throw new ContractValidationError(path, "must be a supported room mode");
  }

  return value;
}

function requireRoomCapacity(value: unknown, path: string): RoomCapacity {
  if (value !== 3 && value !== 4 && value !== 5 && value !== 6) {
    throw new ContractValidationError(path, "must be between 3 and 6");
  }

  return value;
}

export function parseRoomCode(value: unknown): string {
  const normalized = requireString(value, "roomCode").trim().toUpperCase();
  if (!ROOM_CODE_PATTERN.test(normalized)) {
    throw new ContractValidationError(
      "roomCode",
      "must be a six-character alphanumeric room code",
    );
  }

  return normalized;
}

export function parseOpaqueId(value: unknown, path = "id"): string {
  const id = requireString(value, path);
  if (!ID_PATTERN.test(id)) {
    throw new ContractValidationError(path, "must be a valid opaque identifier");
  }

  return id;
}

export function parseCommandId(value: unknown): string {
  return parseOpaqueId(value, "commandId");
}

export function parseCreateRoomRequest(value: unknown): CreateRoomRequest {
  const input = requireObject(value, "createRoom");
  requireExactKeys(input, ["mode", "capacity", "playerName"], "createRoom");

  return {
    mode: requireRoomMode(input["mode"], "mode"),
    capacity: requireRoomCapacity(input["capacity"], "capacity"),
    playerName: requirePlayerName(input["playerName"], "playerName"),
  };
}

export function parseJoinRoomRequest(value: unknown): JoinRoomRequest {
  const input = requireObject(value, "joinRoom");
  requireExactKeys(input, ["roomCode", "playerName"], "joinRoom");

  return {
    roomCode: parseRoomCode(input["roomCode"]),
    playerName: requirePlayerName(input["playerName"], "playerName"),
  };
}

function parseRevisionCommandRequest(
  value: unknown,
  path: string,
): RevisionCommandRequest {
  const input = requireObject(value, path);
  requireExactKeys(input, ["commandId", "expectedRevision"], path);

  return {
    commandId: parseCommandId(input["commandId"]),
    expectedRevision: requireRevision(input["expectedRevision"], "expectedRevision"),
  };
}

export function parseStartGameRequest(value: unknown): StartGameRequest {
  return parseRevisionCommandRequest(value, "startGame");
}

export function parseRollRequest(value: unknown): RollRequest {
  return parseRevisionCommandRequest(value, "roll");
}

export function parseRespondToPromptRequest(value: unknown): RespondToPromptRequest {
  const input = requireObject(value, "respondToPrompt");
  requireExactKeys(
    input,
    ["commandId", "expectedRevision", "decisionPointId", "optionId"],
    "respondToPrompt",
  );

  return {
    commandId: parseCommandId(input["commandId"]),
    expectedRevision: requireRevision(input["expectedRevision"], "expectedRevision"),
    decisionPointId: parseOpaqueId(input["decisionPointId"], "decisionPointId"),
    optionId: parseOpaqueId(input["optionId"], "optionId"),
  };
}
