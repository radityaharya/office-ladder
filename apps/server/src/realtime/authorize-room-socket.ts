import { ContractValidationError } from "@office-ladder/contracts";
import type { PlayerId } from "@office-ladder/engine";
import type { HttpResult } from "@/http";
import type {
  AuthorizeSubscriptionInput,
  RoomServiceErrorCode,
  RoomServiceResult,
} from "@/rooms/service/types";
import { parseRoomTopic } from "./room-topic";

/**
 * Why the room id alone is not authorization: the Realtime topic *is* the room
 * id, and the room id travels in a URL. Registering a socket on the strength of
 * a valid session plus a well-shaped topic therefore let any authenticated
 * account subscribe to any room whose id it had seen — a live turn-timing and
 * activity side channel, plus confirmation that the room exists and is being
 * played. The payload is invalidation metadata only, so no game content leaked,
 * but plans/11 requires membership-scoped topics ("Better Auth users can join
 * only authorized private Realtime topics", "Another player's private topic
 * denied") and this is where that is enforced.
 */
export type RoomSocketRejectionCode =
  | "FORBIDDEN_ORIGIN"
  | "UNAUTHORIZED"
  | "INVALID_ROOM_TOPIC"
  | "ROOM_NOT_FOUND"
  | "NOT_ROOM_MEMBER"
  | "SUBSCRIBER_IS_BOT"
  | "SOCKET_LIMIT_REACHED";

export type RoomSocketAuthorization =
  | {
      readonly ok: true;
      readonly value: {
        readonly roomTopic: string;
        readonly subscriberId: PlayerId;
      };
    }
  | { readonly ok: false; readonly error: { readonly code: RoomSocketRejectionCode } };

/** What to send on the wire for a rejection: a WebSocket close code and reason. */
export type RoomSocketClosure = {
  readonly code: number;
  readonly reason: string;
};

type SessionIdentity = {
  readonly user: { readonly id: string };
};

export type RoomSocketAuthorizerDependencies = {
  readonly isTrustedOrigin: (request: Request) => boolean;
  readonly requireSession: (headers: Headers) => Promise<HttpResult<SessionIdentity>>;
  readonly authorizeSubscription: (
    input: AuthorizeSubscriptionInput,
  ) => Promise<RoomServiceResult<PlayerId>>;
};

export type RoomSocketAuthorizer = (
  request: Request,
  roomTopic: unknown,
) => Promise<RoomSocketAuthorization>;

/**
 * 1008 is "policy violation" and 1013 is "try again later"; both are close codes
 * a client may act on. Every authorization failure that concerns another
 * account's room collapses onto one identical closure — telling a non-member
 * "no such room" apart from "not your room" would reinstate exactly the
 * room-existence oracle this guard removes.
 */
export function roomSocketClosure(code: RoomSocketRejectionCode): RoomSocketClosure {
  switch (code) {
    case "UNAUTHORIZED":
      return { code: 1008, reason: "unauthorized" };
    case "FORBIDDEN_ORIGIN":
      return { code: 1008, reason: "forbidden origin" };
    case "INVALID_ROOM_TOPIC":
      return { code: 1008, reason: "invalid room topic" };
    case "ROOM_NOT_FOUND":
    case "NOT_ROOM_MEMBER":
    case "SUBSCRIBER_IS_BOT":
      return { code: 1008, reason: "not a room member" };
    case "SOCKET_LIMIT_REACHED":
      return { code: 1013, reason: "too many open sockets" };
    default: {
      const exhaustive: never = code;
      return exhaustive satisfies never;
    }
  }
}

/**
 * Dependency-injected so the decision sequence is testable on its own: the
 * handler that calls it (routes/ws.ts) imports `hono/bun`, which reads the
 * global `Bun` object at module scope and therefore cannot be loaded by the
 * Node-based test runner at all.
 */
export function createRoomSocketAuthorizer(
  dependencies: RoomSocketAuthorizerDependencies,
): RoomSocketAuthorizer {
  return async function authorizeRoomSocket(request, roomTopic) {
    // Origin first: a cross-site handshake must learn nothing at all, not even
    // whether the cookie it carried is still a valid session.
    if (!dependencies.isTrustedOrigin(request)) {
      return reject("FORBIDDEN_ORIGIN");
    }

    const session = await dependencies.requireSession(request.headers);
    if (!session.ok) {
      return reject("UNAUTHORIZED");
    }

    let topic: string;
    try {
      topic = parseRoomTopic(roomTopic);
    } catch (error) {
      if (!(error instanceof ContractValidationError)) {
        throw error;
      }

      return reject("INVALID_ROOM_TOPIC");
    }

    const subscription = await dependencies.authorizeSubscription({
      roomId: topic,
      viewerId: session.value.user.id,
    });
    if (!subscription.ok) {
      return reject(subscriptionRejection(subscription.error.code));
    }

    return {
      ok: true,
      value: { roomTopic: topic, subscriberId: subscription.value },
    };
  };
}

function reject(code: RoomSocketRejectionCode): RoomSocketAuthorization {
  return { ok: false, error: { code } };
}

/** Deny by default: an unexpected service code is not a reason to subscribe. */
function subscriptionRejection(code: RoomServiceErrorCode): RoomSocketRejectionCode {
  switch (code) {
    case "ROOM_NOT_FOUND":
      return "ROOM_NOT_FOUND";
    case "ACTOR_IS_BOT":
      return "SUBSCRIBER_IS_BOT";
    default:
      return "NOT_ROOM_MEMBER";
  }
}
