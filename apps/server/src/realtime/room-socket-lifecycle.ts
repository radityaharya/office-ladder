import type { WSContext } from "hono/ws";

import type {
  RoomSocketAuthorizer,
  RoomSocketRejectionCode,
} from "./authorize-room-socket";
import { roomSocketClosure } from "./authorize-room-socket";
import type { RegisterRoomSocketInput, RegisterRoomSocketResult } from "./ws-hub";

/**
 * The open/close pair for one room socket, with the authorization round trip
 * treated as what it is: an `await` during which the socket can already be gone.
 *
 * Authorizing a subscription costs a session lookup plus a room read, so `onOpen`
 * cannot register the socket synchronously. Nothing used to reconcile that with
 * `onClose`, which fires as soon as the peer aborts the handshake — so a client
 * that opened and immediately closed left `onClose` running with no unregister
 * function yet, and the pending `onOpen` then registered a socket that could never
 * be released. The consequences compound:
 *
 * - the subscriber's quota is never returned, so after
 *   MAX_SOCKETS_PER_SUBSCRIBER aborts that account is refused every further
 *   socket (close code 1013) for the life of the process — locked out of realtime
 *   in its *own* rooms, which is the exact denial the cap exists to prevent;
 * - the dead socket stays in the topic's broadcast set, so every later update to
 *   that room writes to it (each failed send is now reported at warn, making a
 *   healthy room look like it is losing clients).
 *
 * Lives in its own module for the reason authorize-room-socket.ts does: routes/ws.ts
 * imports `hono/bun`, which reads the global `Bun` at module scope and cannot be
 * loaded by the Node-based test runner at all.
 */
export type RoomSocketLifecycleDependencies = {
  readonly authorize: RoomSocketAuthorizer;
  readonly register: (input: RegisterRoomSocketInput) => RegisterRoomSocketResult;
  /**
   * The *real* rejection code, for the log. The client only ever sees the
   * collapsed closure, so this is the one place the reason is recorded.
   */
  readonly onRejected: (
    roomTopic: string | undefined,
    code: RoomSocketRejectionCode,
  ) => void;
};

export type RoomSocketLifecycle = {
  /**
   * `roomTopic` is the raw path parameter, which Hono types as possibly absent;
   * the authorizer validates it (and refuses an absent one) rather than this
   * module pre-judging its shape.
   */
  readonly open: (
    request: Request,
    roomTopic: string | undefined,
    ws: WSContext,
  ) => Promise<void>;
  readonly close: () => void;
};

/**
 * One instance per socket — it holds that socket's registration state, exactly
 * like the closure in the route handler it replaces.
 */
export function createRoomSocketLifecycle(
  dependencies: RoomSocketLifecycleDependencies,
): RoomSocketLifecycle {
  let closed = false;
  let unregister: (() => void) | null = null;

  function refuse(ws: WSContext, code: RoomSocketRejectionCode): void {
    const closure = roomSocketClosure(code);
    ws.close(closure.code, closure.reason);
  }

  return {
    async open(request, roomTopic, ws) {
      // Already gone: authorizing would spend a session lookup and a room read on
      // a socket nobody can receive on, which is free amplification for anyone
      // looping connect-then-abort.
      if (closed) return;

      const authorized = await dependencies.authorize(request, roomTopic);
      if (!authorized.ok) {
        dependencies.onRejected(roomTopic, authorized.error.code);
        refuse(ws, authorized.error.code);
        return;
      }

      const registered = dependencies.register({
        roomTopic: authorized.value.roomTopic,
        subscriberId: authorized.value.subscriberId,
        ws,
      });
      if (!registered.ok) {
        refuse(ws, registered.error.code);
        return;
      }

      if (closed) {
        // The close fired while authorization was in flight, so this socket's
        // own onClose has already run and will not run again. Release here or the
        // registration leaks forever.
        registered.value.unregister();
        return;
      }

      unregister = registered.value.unregister;
    },
    close() {
      closed = true;
      const release = unregister;
      unregister = null;
      release?.();
    },
  };
}
