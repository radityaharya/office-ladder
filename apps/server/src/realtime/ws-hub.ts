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

/**
 * The messages one subscriber is entitled to for this broadcast.
 *
 * Called with the **authenticated** subscriber id the socket was registered
 * with (authorize-room-socket.ts resolves that from the session at upgrade
 * time, never from anything the client sent), so a builder cannot be tricked
 * into projecting somebody else's view.
 *
 * Returning an empty array is a legitimate answer: a `window-opened` push for a
 * player who is not eligible for that window has nothing to say to them, and
 * saying nothing is different from saying "null".
 */
export type PerSubscriberMessageBuilder = (
  subscriberId: string,
) => readonly unknown[];

/**
 * What one per-subscriber fan-out cost. `viewers` is the number of times the
 * builder actually ran — the unit of work for a per-viewer projection — while
 * `recipients` counts sockets and `messages` counts frames. The three diverge
 * exactly where it matters: six players with two tabs each is twelve sockets,
 * six projections.
 */
export type BroadcastStats = {
  readonly recipients: number;
  readonly viewers: number;
  readonly messages: number;
};

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

/**
 * Fans out a payload built **per subscriber**, which is what hidden information
 * makes mandatory: one shared frame on a topic cannot carry a hand, a secret
 * objective or a sealed ballot without carrying it to everybody (spec §7.2,
 * §11.3).
 *
 * The builder runs once per *distinct subscriber*, not once per socket. Three
 * tabs on one account are three sockets but one view of the game, so they cost
 * one projection and one JSON.stringify between them — see `BroadcastStats`,
 * which reports both numbers so the difference is measurable rather than
 * assumed.
 *
 * A builder that throws takes out that one viewer's frame and nothing else. The
 * alternative is worse than it looks: `projectGameView` throws on a state that
 * names a player it does not hold, and letting that escape here would abort the
 * fan-out mid-Set, silently cutting off every socket after the bad one.
 */
export function broadcastToRoomPerSubscriber(
  roomTopic: string,
  build: PerSubscriberMessageBuilder,
): BroadcastStats {
  const sockets = rooms.get(roomTopic);
  if (sockets === undefined || sockets.size === 0) {
    return { recipients: 0, viewers: 0, messages: 0 };
  }

  const encodedByViewer = new Map<string, readonly string[]>();
  let recipients = 0;
  let messages = 0;

  for (const socket of sockets) {
    let encoded = encodedByViewer.get(socket.subscriberId);
    if (encoded === undefined) {
      encoded = encodeFor(roomTopic, socket.subscriberId, build);
      encodedByViewer.set(socket.subscriberId, encoded);
    }
    if (encoded.length === 0) continue;

    let delivered = false;
    for (const message of encoded) {
      try {
        socket.ws.send(message);
        messages += 1;
        delivered = true;
      } catch (error) {
        // Same release path as broadcastToRoom: a socket that cannot be written
        // to is gone, and dropping it from the topic without returning its
        // subscriber's quota would eventually lock that account out of its own
        // rooms. Stop writing to it — the frames after this one would only
        // throw again.
        release(roomTopic, socket, "send-failed", describeError(error));
        delivered = false;
        break;
      }
    }
    if (delivered) recipients += 1;
  }

  return { recipients, viewers: encodedByViewer.size, messages };
}

/**
 * The distinct authenticated subscribers attached to a topic on this instance.
 *
 * Exposed so a publisher can decide whether the work of building per-viewer
 * payloads is worth doing at all: a room nobody is watching (a bot-only match, a
 * host who started before anyone connected) should not cost a repository read.
 */
export function roomSubscriberIds(roomTopic: string): readonly string[] {
  const sockets = rooms.get(roomTopic);
  if (sockets === undefined) return [];
  const subscribers = new Set<string>();
  for (const socket of sockets) subscribers.add(socket.subscriberId);
  return [...subscribers];
}

/** Sockets a subscriber currently holds. Exposed for tests and diagnostics. */
export function socketsHeldBy(subscriberId: string): number {
  return socketsPerSubscriber.get(subscriberId) ?? 0;
}

function encodeFor(
  roomTopic: string,
  subscriberId: string,
  build: PerSubscriberMessageBuilder,
): readonly string[] {
  try {
    return build(subscriberId).map((message) => JSON.stringify(message));
  } catch (error) {
    log("error", "ws.payload-failed", {
      topic: roomTopic,
      subscriber: subscriberId,
      error: describeError(error),
    });
    return [];
  }
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
