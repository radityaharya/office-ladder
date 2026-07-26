import { describe, expect, it } from "vitest";

import { createStableId, type PlayerId } from "@office-ladder/engine";
import type { HttpResult } from "../../src/http";
import { httpError, HTTP_ERROR_CODES } from "../../src/http/errors";
import {
  createRoomSocketAuthorizer,
  roomSocketClosure,
  type RoomSocketAuthorizer,
} from "../../src/realtime/authorize-room-socket";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService } from "../../src/rooms/service/types";

/**
 * The subscribe path used to authenticate the session, check the *shape* of the
 * topic, and then register the socket — with no membership check at all. Since
 * the topic is the room id, and the room id is in the URL of every player's
 * browser, any authenticated account that learned one received every
 * projection-updated frame for that room: a live turn-timing and activity side
 * channel, plus confirmation the room exists and is being played.
 *
 * routes/ws.ts itself cannot be imported by this runner — it pulls in `hono/bun`,
 * which reads the global `Bun` at module scope — so the decision sequence lives
 * in its own module and is tested here against a *real* room service over the
 * in-memory repository. Only the three-line Hono registration is untested.
 */
const host = createStableId("PlayerId", "user-host");
const member = createStableId("PlayerId", "user-member");
const stranger = createStableId("PlayerId", "user-stranger");
const roomId = "room-socket-authorization";

function service(repository: InMemoryRoomRepository): RoomService {
  return createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => "WSA123",
      gameId: () => createStableId("GameId", "game-socket-authorization"),
      commandId: () => createStableId("CommandId", "command-socket-authorization"),
    },
    gameSeed: () => "socket-authorization-seed",
    // Off unless a test needs the clock: an armed deadline in an unrelated
    // test would be enforcement nobody asked for.
    turnTimeoutMs: 0,
  });
}

function session(userId: string): Promise<HttpResult<{ user: { id: string } }>> {
  return Promise.resolve({ ok: true, value: { user: { id: userId } } });
}

function noSession(): Promise<HttpResult<{ user: { id: string } }>> {
  return Promise.resolve({ ok: false, error: httpError(HTTP_ERROR_CODES.UNAUTHORIZED) });
}

type Harness = {
  readonly authorize: RoomSocketAuthorizer;
  readonly sessionLookups: readonly string[];
};

/**
 * A room with a human host, a second human member and one bot seat, so both the
 * non-member and the bot-seat cases are answerable from real stored state.
 */
async function harness(options?: {
  readonly userId?: string;
  readonly trustedOrigin?: boolean;
  readonly authenticated?: boolean;
}): Promise<Harness> {
  const repository = new InMemoryRoomRepository();
  const rooms = service(repository);
  await rooms.create({ hostId: host, playerName: "Host", modeId: "mode.quick" });
  await rooms.join({ roomId, actorId: member, playerName: "Member" });
  await rooms.addBot({ roomId, actorId: host, difficulty: "standard" });

  const sessionLookups: string[] = [];
  const userId = options?.userId ?? member;
  const authorize = createRoomSocketAuthorizer({
    isTrustedOrigin: () => options?.trustedOrigin ?? true,
    requireSession: (headers) => {
      sessionLookups.push(headers.get("cookie") ?? "");
      return options?.authenticated === false ? noSession() : session(userId);
    },
    authorizeSubscription: (input) => rooms.authorizeSubscription(input),
  });

  return { authorize, sessionLookups };
}

function handshake(): Request {
  return new Request("http://localhost:3072/ws/rooms/room-socket-authorization", {
    headers: { cookie: "better-auth.session_token=abc", origin: "http://localhost:3072" },
  });
}

async function botSeatId(): Promise<PlayerId> {
  const repository = new InMemoryRoomRepository();
  const rooms = service(repository);
  await rooms.create({ hostId: host, playerName: "Host", modeId: "mode.quick" });
  const added = await rooms.addBot({ roomId, actorId: host, difficulty: "standard" });
  if (!added.ok) throw new Error("bot seat could not be created");
  const seat = added.value.bots[0];
  if (seat === undefined) throw new Error("bot seat missing");
  return seat.playerId;
}

describe("room socket authorization", () => {
  it("Given a room member, When the handshake is authorized, Then it registers as that member", async () => {
    const { authorize } = await harness();

    const result = await authorize(handshake(), roomId);

    expect(result).toEqual({
      ok: true,
      value: { roomTopic: roomId, subscriberId: member },
    });
  });

  it("Given a handshake that asks to be somebody else, When it is authorized, Then the subscriber is still the session's own user", async () => {
    // This is the identity the per-socket fan-out projects with (§11.3: "never
    // derive a viewer's identity from anything the client sent in the socket
    // message — resolve it from the authenticated session at upgrade time").
    // Every channel a client controls is loaded with somebody else's id here.
    const { authorize } = await harness();
    const impersonating = new Request(
      `http://localhost:3072/ws/rooms/${roomId}?viewerId=${host}&playerId=${host}`,
      {
        headers: {
          cookie: "better-auth.session_token=abc",
          origin: "http://localhost:3072",
          "x-player-id": host,
          "sec-websocket-protocol": `viewer.${host}`,
        },
      },
    );

    const result = await authorize(impersonating, roomId);

    expect(result).toEqual({
      ok: true,
      value: { roomTopic: roomId, subscriberId: member },
    });
  });

  it("Given an authenticated stranger who knows the room id, When the handshake is authorized, Then it is refused", async () => {
    const { authorize } = await harness({ userId: stranger });

    const result = await authorize(handshake(), roomId);

    expect(result).toEqual({ ok: false, error: { code: "NOT_ROOM_MEMBER" } });
  });

  it("Given a room that does not exist, When a stranger subscribes, Then the closure is identical to a non-member's", async () => {
    const { authorize } = await harness({ userId: stranger });

    const unknownRoom = await authorize(handshake(), "room-that-does-not-exist");
    const notAMember = await authorize(handshake(), roomId);

    // Distinguishing the two would hand back the room-existence oracle this
    // guard exists to remove, so only the internal code differs.
    expect(unknownRoom).toEqual({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
    expect(notAMember).toEqual({ ok: false, error: { code: "NOT_ROOM_MEMBER" } });
    if (unknownRoom.ok || notAMember.ok) return;
    expect(roomSocketClosure(unknownRoom.error.code)).toEqual(
      roomSocketClosure(notAMember.error.code),
    );
  });

  it("Given a bot seat's id presented as the session user, When it subscribes, Then it is refused", async () => {
    const { authorize } = await harness({ userId: await botSeatId() });

    const result = await authorize(handshake(), roomId);

    expect(result).toEqual({ ok: false, error: { code: "SUBSCRIBER_IS_BOT" } });
  });

  it("Given a cross-site handshake, When it is authorized, Then it is refused without even looking up the session", async () => {
    const { authorize, sessionLookups } = await harness({ trustedOrigin: false });

    const result = await authorize(handshake(), roomId);

    expect(result).toEqual({ ok: false, error: { code: "FORBIDDEN_ORIGIN" } });
    // A hostile page must learn nothing at all — not even whether the cookie it
    // made the browser attach is still a valid session.
    expect(sessionLookups).toEqual([]);
  });

  it("Given no session, When the handshake is authorized, Then it is refused before any room is read", async () => {
    const { authorize } = await harness({ authenticated: false });

    const result = await authorize(handshake(), roomId);

    expect(result).toEqual({ ok: false, error: { code: "UNAUTHORIZED" } });
  });

  it("Given a join code used as the topic, When a member subscribes, Then the topic is rejected", async () => {
    const { authorize } = await harness();

    // plans/11: the code is a join credential and must never be a topic.
    expect(await authorize(handshake(), "WSA123")).toEqual({
      ok: false,
      error: { code: "INVALID_ROOM_TOPIC" },
    });
    expect(await authorize(handshake(), "not a topic")).toEqual({
      ok: false,
      error: { code: "INVALID_ROOM_TOPIC" },
    });
    expect(await authorize(handshake(), null)).toEqual({
      ok: false,
      error: { code: "INVALID_ROOM_TOPIC" },
    });
  });

  it("Given every rejection code, When it is mapped to a closure, Then the socket closes with a policy code and a reason", () => {
    expect(roomSocketClosure("UNAUTHORIZED")).toEqual({ code: 1008, reason: "unauthorized" });
    expect(roomSocketClosure("FORBIDDEN_ORIGIN")).toEqual({
      code: 1008,
      reason: "forbidden origin",
    });
    expect(roomSocketClosure("INVALID_ROOM_TOPIC")).toEqual({
      code: 1008,
      reason: "invalid room topic",
    });
    expect(roomSocketClosure("NOT_ROOM_MEMBER")).toEqual({
      code: 1008,
      reason: "not a room member",
    });
    // A resource limit is not a policy violation: 1013 tells a client to retry.
    expect(roomSocketClosure("SOCKET_LIMIT_REACHED")).toEqual({
      code: 1013,
      reason: "too many open sockets",
    });
  });
});
