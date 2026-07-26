import type { WSContext } from "hono/ws";

import { describeError, log } from "@/observability/log";

/**
 * Maximum concurrent sockets one subscriber may hold across all rooms.
 *
 * Every socket costs a live connection plus a Map entry that lives until it
 * closes, and nothing else bounds how many a single authenticated account can
 * open. Six is the largest room, and a real client holds one socket per open tab
 * on one room, so eight leaves generous headroom for reloads and reconnect
 * overlap while keeping a single account from parking hundreds of them.
 *
 * Not configurable on purpose: a wrong value here is a security regression, and
 * an env var that nobody sets is just a second place for the number to be wrong.
 */
export const MAX_SOCKETS_PER_SUBSCRIBER = 8;

type RoomSocket = {
  readonly subscriberId: string;
  readonly ws: WSContext;
  /** Only so the close line can report how long the socket actually lived. */
  readonly registeredAt: number;
};

/**
 * Why a socket left. The distinction is the point: a clean close is the client
 * navigating away, while a failed send means the socket was already gone and the
 * hub only found out by writing to it — the second used to be an empty `catch`.
 */
type ReleaseReason = "closed" | "send-failed";

export type RegisterRoomSocketInput = {
  readonly roomTopic: string;
  /**
   * The authenticated member the socket belongs to — the room-scoped PlayerId,
   * which is the raw auth user id. Authorization is the caller's job (see
   * authorize-room-socket.ts); the hub only counts.
   */
  readonly subscriberId: string;
  readonly ws: WSContext;
};

export type RegisterRoomSocketResult =
  | { readonly ok: true; readonly value: { readonly unregister: () => void } }
  | { readonly ok: false; readonly error: { readonly code: "SOCKET_LIMIT_REACHED" } };

const rooms = new Map<string, Set<RoomSocket>>();
const socketsPerSubscriber = new Map<string, number>();

export function registerRoomSocket(
  input: RegisterRoomSocketInput,
): RegisterRoomSocketResult {
  const held = socketsPerSubscriber.get(input.subscriberId) ?? 0;
  if (held >= MAX_SOCKETS_PER_SUBSCRIBER) {
    // Logged here rather than at the route, because the quota count is the only
    // interesting part: one account parked at the ceiling is either a leaking
    // client or an abuse attempt, and neither is visible from a close code.
    log("warn", "ws.rejected", {
      topic: input.roomTopic,
      subscriber: input.subscriberId,
      reason: "SOCKET_LIMIT_REACHED",
      held,
      limit: MAX_SOCKETS_PER_SUBSCRIBER,
    });
    return { ok: false, error: { code: "SOCKET_LIMIT_REACHED" } };
  }

  const socket: RoomSocket = {
    subscriberId: input.subscriberId,
    ws: input.ws,
    registeredAt: Date.now(),
  };
  let sockets = rooms.get(input.roomTopic);
  if (sockets === undefined) {
    sockets = new Set();
    rooms.set(input.roomTopic, sockets);
  }
  sockets.add(socket);
  socketsPerSubscriber.set(input.subscriberId, held + 1);

  // Half of the socket lifecycle summary. A deployment where realtime is dead
  // produces no line at all here, which is exactly the symptom that went
  // unnoticed twice.
  log("info", "ws.registered", {
    topic: input.roomTopic,
    subscriber: input.subscriberId,
    topicSockets: sockets.size,
    held: held + 1,
  });

  return {
    ok: true,
    value: {
      unregister: () => {
        release(input.roomTopic, socket, "closed");
      },
    },
  };
}

export function broadcastToRoom(roomTopic: string, payload: unknown): number {
  const sockets = rooms.get(roomTopic);
  if (sockets === undefined || sockets.size === 0) {
    return 0;
  }

  const message = JSON.stringify(payload);
  let sent = 0;
  for (const socket of sockets) {
    try {
      socket.ws.send(message);
      sent += 1;
    } catch (error) {
      // A socket that cannot be written to is gone. Released through the same
      // path as a clean close, so its subscriber's quota is returned too —
      // dropping it from the topic alone would leak the count and eventually
      // lock that account out of its own rooms. Reported, because a room that
      // loses its realtime feed one client at a time otherwise looks fine.
      release(roomTopic, socket, "send-failed", describeError(error));
    }
  }
  return sent;
}

/** Sockets a subscriber currently holds. Exposed for tests and diagnostics. */
export function socketsHeldBy(subscriberId: string): number {
  return socketsPerSubscriber.get(subscriberId) ?? 0;
}

/**
 * Idempotent: Set.delete reports whether the socket was still registered, so a
 * double unregister (a close that races a failed send) cannot decrement twice.
 */
function release(
  roomTopic: string,
  socket: RoomSocket,
  reason: ReleaseReason,
  error?: string,
): void {
  const sockets = rooms.get(roomTopic);
  if (sockets === undefined || !sockets.delete(socket)) {
    return;
  }
  if (sockets.size === 0) {
    rooms.delete(roomTopic);
  }

  // The other half of the lifecycle summary. `reason` is what makes a dropped
  // socket distinguishable from a client that simply left, and `durationMs`
  // turns a reconnect loop into something you can see rather than infer.
  log(reason === "send-failed" ? "warn" : "info", "ws.closed", {
    topic: roomTopic,
    subscriber: socket.subscriberId,
    reason,
    topicSockets: sockets.size,
    durationMs: Date.now() - socket.registeredAt,
    error,
  });

  const held = socketsPerSubscriber.get(socket.subscriberId) ?? 0;
  if (held <= 1) {
    socketsPerSubscriber.delete(socket.subscriberId);
    return;
  }
  socketsPerSubscriber.set(socket.subscriberId, held - 1);
}
