import type { LogLevel } from "@/observability/log";
import type { RoomServiceErrorCode } from "./types";

/**
 * Rejections a *correct* client can legitimately provoke: a stale revision from
 * a double-click, a room that filled up between the lobby render and the join, a
 * prompt option the player could no longer afford.
 *
 * Everything not listed is a bug in this server, the engine or the content pack
 * — an `INVARIANT_VIOLATION` or a `CONTENT_MISMATCH` is nobody's fault but ours.
 * The list is therefore an allow-list with a `warn` default, so a newly added
 * engine error code starts out loud rather than starting out invisible because
 * somebody forgot to classify it.
 *
 * Typed as the real union, so renaming a code in the engine breaks this file
 * instead of silently reclassifying it.
 */
const EXPECTED_REJECTIONS: readonly RoomServiceErrorCode[] = [
  "ACTOR_ALREADY_MEMBER",
  "ACTOR_NOT_AUTHORIZED",
  "ACTOR_NOT_FOUND",
  "ACTOR_NOT_HOST",
  "ACTOR_NOT_MEMBER",
  // Reachable from a well-behaved client now that a hand and a token economy
  // exist: playing a card somebody else's reaction already removed, or spending
  // a token past its cap, is a lost race, not a defect.
  "CARD_NOT_AVAILABLE",
  "DECISION_POINT_NOT_FOUND",
  "DECISION_POINT_REQUIRED",
  "DECISION_POINT_STALE",
  "GAME_ALREADY_ENDED",
  "GAME_NOT_ACTIVE",
  "ILLEGAL_ACTION",
  "INSUFFICIENT_RESOURCE",
  "INVALID_COMMAND",
  /**
   * A lobby-authored ruleset that failed the contracts validator. The lobby's
   * own controls are built from `MODE_RULES_BOUNDS` and cannot produce one, so
   * this is either a stale client or somebody posting by hand — a refusal, not
   * this server malfunctioning.
   */
  "INVALID_MODE_RULES",
  "INVALID_PHASE",
  "INVALID_PROMPT_RESPONSE",
  "LAST_HUMAN_REQUIRED",
  "MEMBER_NOT_BOT",
  "MINIMUM_PLAYERS_NOT_MET",
  "NOT_ACTOR_TURN",
  "ROOM_CODE_NOT_FOUND",
  "ROOM_FULL",
  "ROOM_NOT_FOUND",
  "ROOM_NOT_OPEN",
  "STALE_REVISION",
  "TOKEN_LIMIT_EXCEEDED",
  "UNSUPPORTED_MODE",
];

export function commandRejectionLevel(code: RoomServiceErrorCode): LogLevel {
  return EXPECTED_REJECTIONS.includes(code) ? "info" : "warn";
}
