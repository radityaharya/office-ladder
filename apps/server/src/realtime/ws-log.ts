import { log, type LogLevel } from "@/observability/log";
import type { RoomSocketRejectionCode } from "./authorize-room-socket";

/**
 * How a refused subscription is reported.
 *
 * Separate from routes/ws.ts because that module imports `hono/bun`, which reads
 * the global `Bun` object at module scope and therefore cannot be loaded by the
 * Node test runner at all — the same reason the authorizer itself is
 * dependency-injected. Keeping the severity rule here makes it provable.
 */

/**
 * An expired cookie or a stale room id is ordinary traffic; being told "not your
 * room" is not. A member-scope refusal means either a client using an id it
 * should not have, or a real attempt to subscribe to somebody else's match, and
 * that deserves to be findable.
 */
export function roomSocketRejectionLevel(code: RoomSocketRejectionCode): LogLevel {
  switch (code) {
    case "UNAUTHORIZED":
    case "INVALID_ROOM_TOPIC":
    case "ROOM_NOT_FOUND":
      return "info";
    case "FORBIDDEN_ORIGIN":
    case "NOT_ROOM_MEMBER":
    case "SUBSCRIBER_IS_BOT":
    case "SOCKET_LIMIT_REACHED":
      return "warn";
    default:
      code satisfies never;
      return "warn";
  }
}

/**
 * `topic` is the raw path parameter: it is logged before validation on purpose,
 * because a client repeatedly subscribing with a malformed topic is the kind of
 * thing worth seeing. The formatter escapes it.
 */
export function logRoomSocketRejection(
  topic: string | undefined,
  code: RoomSocketRejectionCode,
): void {
  log(roomSocketRejectionLevel(code), "ws.rejected", {
    topic: topic ?? null,
    reason: code,
    stage: "authorize",
  });
}
