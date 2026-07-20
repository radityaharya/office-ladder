import type { JsonObject } from "./json";
import type { CommandId, DecisionPointId, FrameId, GameId, PlayerId } from "./ids";

export type EngineErrorCode =
  | "GAME_NOT_ACTIVE"
  | "GAME_ALREADY_ENDED"
  | "ACTOR_NOT_FOUND"
  | "ACTOR_NOT_AUTHORIZED"
  | "NOT_ACTOR_TURN"
  | "INVALID_PHASE"
  | "INVALID_COMMAND"
  | "ILLEGAL_ACTION"
  | "STALE_REVISION"
  | "DECISION_POINT_REQUIRED"
  | "DECISION_POINT_NOT_FOUND"
  | "DECISION_POINT_STALE"
  | "INVALID_PROMPT_RESPONSE"
  | "INSUFFICIENT_RESOURCE"
  | "TOKEN_LIMIT_EXCEEDED"
  | "CARD_NOT_AVAILABLE"
  | "INVARIANT_VIOLATION"
  | "RESOLUTION_DEPTH_EXCEEDED"
  | "FRAME_LIMIT_EXCEEDED"
  | "CHAINED_DRAW_LIMIT_EXCEEDED"
  | "RESOLUTION_CYCLE_DETECTED"
  | "NO_PROGRESS_DETECTED"
  | "CONTENT_MISMATCH"
  | "SERIALIZATION_FAILED"
  | "INVALID_PLAYER_COUNT"
  | "DUPLICATE_PLAYER_ID"
  | "DUPLICATE_CHARACTER_ID"
  | "AUTHORIZED_STARTER_NOT_FOUND"
  | "UNSUPPORTED_MODE";

export interface EngineError {
  readonly name: "EngineError";
  readonly code: EngineErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly gameId: GameId | null;
  readonly commandId: CommandId | null;
  readonly actorId: PlayerId | null;
  readonly decisionPointId: DecisionPointId | null;
  readonly frameId: FrameId | null;
  readonly details: JsonObject;
}

export type EngineResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: EngineError };
