import type { WSContext } from "hono/ws";
import { describe, expect, it } from "vitest";

import { createStableId } from "@office-ladder/engine";
import type {
  RoomSocketAuthorization,
  RoomSocketRejectionCode,
} from "../../src/realtime/authorize-room-socket";
import { createRoomSocketLifecycle } from "../../src/realtime/room-socket-lifecycle";
import type {
  RegisterRoomSocketInput,
  RegisterRoomSocketResult,
} from "../../src/realtime/ws-hub";

/**
 * Authorizing a subscription is two round trips (a session lookup and a room
 * read), and `onClose` fires the moment the peer aborts the handshake — so the
 * close can, and for an immediate abort routinely does, land while `onOpen` is
 * still awaiting. Nothing reconciled the two before this module existed: the
 * pending open then registered a socket whose unregister function nobody would
 * ever hold, permanently leaking the subscriber's quota (locking that account out
 * of realtime in its own rooms) and leaving a dead socket in the broadcast set.
 */

const subscriber = createStableId("PlayerId", "user-member");
const roomTopic = "room-lifecycle-test";

type Closure = { readonly code: number; readonly reason: string };

type Harness = {
  readonly registered: readonly RegisterRoomSocketInput[];
  readonly released: readonly string[];
  readonly closures: readonly Closure[];
  readonly rejections: readonly RoomSocketRejectionCode[];
  readonly ws: WSContext;
  readonly lifecycle: ReturnType<typeof createRoomSocketLifecycle>;
};

type HarnessOptions = {
  /** Resolved before the authorizer answers, so a test can close mid-flight. */
  readonly beforeAuthorize?: () => Promise<void> | void;
  readonly authorization?: RoomSocketAuthorization;
  readonly registration?: RegisterRoomSocketResult;
};

function createHarness(options: HarnessOptions = {}): Harness {
  const registered: RegisterRoomSocketInput[] = [];
  const released: string[] = [];
  const closures: Closure[] = [];
  const rejections: RoomSocketRejectionCode[] = [];

  const ws = {
    send: () => undefined,
    close: (code?: number, reason?: string) => {
      closures.push({ code: code ?? 0, reason: reason ?? "" });
    },
  } as unknown as WSContext;

  const lifecycle = createRoomSocketLifecycle({
    authorize: async () => {
      await options.beforeAuthorize?.();
      return (
        options.authorization ?? {
          ok: true,
          value: { roomTopic, subscriberId: subscriber },
        }
      );
    },
    register: (input) => {
      registered.push(input);
      return (
        options.registration ?? {
          ok: true,
          value: {
            unregister: () => {
              released.push(input.subscriberId);
            },
          },
        }
      );
    },
    onRejected: (_topic, code) => {
      rejections.push(code);
    },
  });

  return { registered, released, closures, rejections, ws, lifecycle };
}

function request(): Request {
  return new Request("http://localhost:3072/ws/rooms/room-lifecycle-test", {
    headers: { origin: "http://localhost:3072" },
  });
}

describe("room socket lifecycle", () => {
  it("Given an authorized socket, When it opens and later closes, Then it is registered once and released once", async () => {
    const harness = createHarness();

    await harness.lifecycle.open(request(), roomTopic, harness.ws);
    expect(harness.registered).toEqual([{ roomTopic, subscriberId: subscriber, ws: harness.ws }]);
    expect(harness.released).toEqual([]);

    harness.lifecycle.close();
    expect(harness.released).toEqual([subscriber]);
  });

  it("Given a path parameter that disagrees with the authorizer, When the socket opens, Then it is registered under the authorized topic and subscriber", async () => {
    // The subscriber id registered here is the identity the per-socket fan-out
    // later projects with (§7.2, §11.3), so it has to come from the authorizer's
    // answer and from nowhere else. The path parameter is attacker-controlled:
    // a socket registered under it would be subscribed to a room, and projected
    // as a player, that the session never authorized.
    const harness = createHarness({
      authorization: {
        ok: true,
        value: { roomTopic, subscriberId: subscriber },
      },
    });

    await harness.lifecycle.open(
      request(),
      "room-somebody-else-is-playing-in",
      harness.ws,
    );
    harness.lifecycle.close();

    expect(harness.registered).toEqual([
      { roomTopic, subscriberId: subscriber, ws: harness.ws },
    ]);
  });

  it("Given a close that arrives while authorization is in flight, When the open finishes, Then the registration is released rather than leaked", async () => {
    let closeDuringAuthorize: () => void = () => undefined;
    const harness = createHarness({
      beforeAuthorize: () => {
        closeDuringAuthorize();
      },
    });
    closeDuringAuthorize = () => {
      harness.lifecycle.close();
    };

    await harness.lifecycle.open(request(), roomTopic, harness.ws);

    // The socket was registered — the hub's quota was taken — so the only correct
    // outcome is that it is handed straight back. Leaking it here is what locked an
    // account out of its own rooms after MAX_SOCKETS_PER_SUBSCRIBER aborts.
    expect(harness.registered).toHaveLength(1);
    expect(harness.released).toEqual([subscriber]);
  });

  it("Given a socket already closed before the open runs, When it opens, Then nothing is authorized at all", async () => {
    const harness = createHarness();

    harness.lifecycle.close();
    await harness.lifecycle.open(request(), roomTopic, harness.ws);

    // No session lookup, no room read: connect-then-abort must not be free
    // amplification against the database.
    expect(harness.registered).toEqual([]);
    expect(harness.released).toEqual([]);
    expect(harness.rejections).toEqual([]);
  });

  it("Given a repeated close, When it runs again, Then the registration is not released twice", async () => {
    const harness = createHarness();

    await harness.lifecycle.open(request(), roomTopic, harness.ws);
    harness.lifecycle.close();
    harness.lifecycle.close();

    // The hub's release is idempotent too, but a double call here would also
    // double-decrement any future non-Set-based counter.
    expect(harness.released).toEqual([subscriber]);
  });

  it("Given a refused authorization, When the socket opens, Then the real code is reported and the client gets the collapsed closure", async () => {
    const harness = createHarness({
      authorization: { ok: false, error: { code: "NOT_ROOM_MEMBER" } },
    });

    await harness.lifecycle.open(request(), roomTopic, harness.ws);

    expect(harness.rejections).toEqual(["NOT_ROOM_MEMBER"]);
    expect(harness.closures).toEqual([{ code: 1008, reason: "not a room member" }]);
    expect(harness.registered).toEqual([]);
  });

  it("Given a subscriber over its socket cap, When registration is refused, Then the socket is closed as retryable and nothing is held", async () => {
    const harness = createHarness({
      registration: { ok: false, error: { code: "SOCKET_LIMIT_REACHED" } },
    });

    await harness.lifecycle.open(request(), roomTopic, harness.ws);

    expect(harness.closures).toEqual([{ code: 1013, reason: "too many open sockets" }]);
    expect(harness.released).toEqual([]);
    harness.lifecycle.close();
    expect(harness.released).toEqual([]);
  });
});
