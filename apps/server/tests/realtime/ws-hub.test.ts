import { randomUUID } from "node:crypto";

import type { WSContext } from "hono/ws";
import { describe, expect, it } from "vitest";

import {
  broadcastToRoom,
  MAX_SOCKETS_PER_SUBSCRIBER,
  registerRoomSocket,
  socketsHeldBy,
} from "../../src/realtime/ws-hub";

/**
 * The hub is a module-level Map with no upper bound of its own, so the only thing
 * that stopped one authenticated account from parking an unlimited number of
 * connections (each a live socket, a Set entry and a session lookup at open) was
 * that nothing had tried. Membership authorization bounds the *topics* a
 * subscriber can reach to rooms it actually belongs to; this bounds the sockets.
 */
function openSocket(): WSContext {
  return { send: () => undefined } as unknown as WSContext;
}

function failingSocket(): WSContext {
  return {
    send: () => {
      throw new Error("socket is gone");
    },
  } as unknown as WSContext;
}

function register(roomTopic: string, subscriberId: string, ws: WSContext) {
  return registerRoomSocket({ roomTopic, subscriberId, ws });
}

describe("ws hub", () => {
  it("Given a subscriber at its socket limit, When it opens one more, Then registration is refused", () => {
    const subscriberId = randomUUID();
    const roomTopic = randomUUID();
    const unregisters: (() => void)[] = [];

    for (let index = 0; index < MAX_SOCKETS_PER_SUBSCRIBER; index += 1) {
      const registered = register(roomTopic, subscriberId, openSocket());
      expect(registered.ok).toBe(true);
      if (registered.ok) unregisters.push(registered.value.unregister);
    }

    const refused = register(roomTopic, subscriberId, openSocket());
    expect(refused).toEqual({ ok: false, error: { code: "SOCKET_LIMIT_REACHED" } });
    expect(socketsHeldBy(subscriberId)).toBe(MAX_SOCKETS_PER_SUBSCRIBER);

    for (const unregister of unregisters) unregister();
    expect(socketsHeldBy(subscriberId)).toBe(0);
  });

  it("Given a subscriber that spreads sockets over many topics, When it hits the limit, Then fabricated topics buy it nothing", () => {
    const subscriberId = randomUUID();
    const unregisters: (() => void)[] = [];

    for (let index = 0; index < MAX_SOCKETS_PER_SUBSCRIBER; index += 1) {
      const registered = register(randomUUID(), subscriberId, openSocket());
      if (registered.ok) unregisters.push(registered.value.unregister);
    }

    // The cap is per subscriber, not per topic, so a fresh topic per socket is
    // exactly as bounded as hammering one.
    expect(register(randomUUID(), subscriberId, openSocket())).toEqual({
      ok: false,
      error: { code: "SOCKET_LIMIT_REACHED" },
    });

    for (const unregister of unregisters) unregister();
  });

  it("Given a subscriber at its limit, When it closes one socket, Then it may open another", () => {
    const subscriberId = randomUUID();
    const roomTopic = randomUUID();
    const unregisters: (() => void)[] = [];

    for (let index = 0; index < MAX_SOCKETS_PER_SUBSCRIBER; index += 1) {
      const registered = register(roomTopic, subscriberId, openSocket());
      if (registered.ok) unregisters.push(registered.value.unregister);
    }

    unregisters[0]?.();
    expect(socketsHeldBy(subscriberId)).toBe(MAX_SOCKETS_PER_SUBSCRIBER - 1);
    const reopened = register(roomTopic, subscriberId, openSocket());
    expect(reopened.ok).toBe(true);

    for (const unregister of unregisters.slice(1)) unregister();
    if (reopened.ok) reopened.value.unregister();
    expect(socketsHeldBy(subscriberId)).toBe(0);
  });

  it("Given two subscribers in one room, When one is at its limit, Then the other is unaffected", () => {
    const roomTopic = randomUUID();
    const saturated = randomUUID();
    const other = randomUUID();
    const unregisters: (() => void)[] = [];

    for (let index = 0; index < MAX_SOCKETS_PER_SUBSCRIBER; index += 1) {
      const registered = register(roomTopic, saturated, openSocket());
      if (registered.ok) unregisters.push(registered.value.unregister);
    }

    const registered = register(roomTopic, other, openSocket());
    expect(registered.ok).toBe(true);
    expect(socketsHeldBy(other)).toBe(1);

    for (const unregister of unregisters) unregister();
    if (registered.ok) registered.value.unregister();
  });

  it("Given a socket that fails on send, When the room is broadcast to, Then its subscriber's quota is returned", () => {
    const subscriberId = randomUUID();
    const roomTopic = randomUUID();
    const registered = register(roomTopic, subscriberId, failingSocket());
    expect(registered.ok).toBe(true);
    expect(socketsHeldBy(subscriberId)).toBe(1);

    // Dropping the dead socket from the topic without returning the quota would
    // slowly lock a real user out of their own rooms after enough reconnects.
    expect(broadcastToRoom(roomTopic, { kind: "anything" })).toBe(0);
    expect(socketsHeldBy(subscriberId)).toBe(0);

    if (registered.ok) registered.value.unregister();
    expect(socketsHeldBy(subscriberId)).toBe(0);
  });

  it("Given a socket already released by a failed send, When unregister runs again, Then the count does not go negative", () => {
    const subscriberId = randomUUID();
    const roomTopic = randomUUID();
    const first = register(roomTopic, subscriberId, failingSocket());
    const second = register(roomTopic, subscriberId, openSocket());
    expect(socketsHeldBy(subscriberId)).toBe(2);

    broadcastToRoom(roomTopic, { kind: "anything" });
    expect(socketsHeldBy(subscriberId)).toBe(1);
    if (first.ok) first.value.unregister();
    expect(socketsHeldBy(subscriberId)).toBe(1);

    if (second.ok) second.value.unregister();
    expect(socketsHeldBy(subscriberId)).toBe(0);
  });
});
