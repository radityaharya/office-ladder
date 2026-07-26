import { randomUUID } from "node:crypto";

import type { WSContext } from "hono/ws";
import { describe, expect, it } from "vitest";

import {
  broadcastToRoom,
  broadcastToRoomPerSubscriber,
  MAX_SOCKETS_PER_SUBSCRIBER,
  registerRoomSocket,
  roomSubscriberIds,
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

/**
 * The per-subscriber fan-out is what hidden information makes mandatory: one
 * shared frame on a topic cannot carry a hand or a sealed ballot without
 * carrying it to everybody (spec §7.2). These tests are about the *delivery*
 * contract — who the builder is called for, how often, and what happens when
 * either the builder or a socket fails. What the payload contains is
 * publish-projection-update.test.ts's job.
 */
function recordingSocket(sent: string[]): WSContext {
  return { send: (message: string) => sent.push(message) } as unknown as WSContext;
}

describe("ws hub: per-subscriber fan-out", () => {
  it("Given several sockets, When the room is served, Then each subscriber gets only what was built for it", () => {
    const roomTopic = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    const firstSent: string[] = [];
    const secondSent: string[] = [];
    const registrations = [
      register(roomTopic, first, recordingSocket(firstSent)),
      register(roomTopic, second, recordingSocket(secondSent)),
    ];

    const stats = broadcastToRoomPerSubscriber(roomTopic, (subscriberId) => [
      { viewer: subscriberId },
    ]);
    for (const registration of registrations) {
      if (registration.ok) registration.value.unregister();
    }

    expect(stats).toEqual({ recipients: 2, viewers: 2, messages: 2 });
    expect(firstSent).toEqual([JSON.stringify({ viewer: first })]);
    expect(secondSent).toEqual([JSON.stringify({ viewer: second })]);
  });

  it("Given one account with several tabs, When the room is served, Then the payload is built once and delivered to every tab", () => {
    // The load question the spec raises (§11.4): per-socket projection is
    // O(sockets) only if you let it be. The unit of work is the *viewer*.
    const roomTopic = randomUUID();
    const subscriberId = randomUUID();
    const tabs = [[] as string[], [] as string[], [] as string[]];
    const registrations = tabs.map((sent) =>
      register(roomTopic, subscriberId, recordingSocket(sent)),
    );

    let builds = 0;
    const stats = broadcastToRoomPerSubscriber(roomTopic, () => {
      builds += 1;
      return [{ kind: "projection" }];
    });
    for (const registration of registrations) {
      if (registration.ok) registration.value.unregister();
    }

    expect(builds).toBe(1);
    expect(stats).toEqual({ recipients: 3, viewers: 1, messages: 3 });
    for (const sent of tabs) expect(sent).toEqual([JSON.stringify({ kind: "projection" })]);
  });

  it("Given a builder that returns nothing for a viewer, When the room is served, Then that socket is not written to at all", () => {
    // A window-opened push for a player who is not eligible has nothing to say
    // to them, and saying nothing is not the same as sending null.
    const roomTopic = randomUUID();
    const eligible = randomUUID();
    const ineligible = randomUUID();
    const eligibleSent: string[] = [];
    const ineligibleSent: string[] = [];
    const registrations = [
      register(roomTopic, eligible, recordingSocket(eligibleSent)),
      register(roomTopic, ineligible, recordingSocket(ineligibleSent)),
    ];

    const stats = broadcastToRoomPerSubscriber(roomTopic, (subscriberId) =>
      subscriberId === eligible ? [{ kind: "window-opened" }] : [],
    );
    for (const registration of registrations) {
      if (registration.ok) registration.value.unregister();
    }

    expect(stats).toEqual({ recipients: 1, viewers: 2, messages: 1 });
    expect(ineligibleSent).toEqual([]);
  });

  it("Given a builder that throws for one viewer, When the room is served, Then every other viewer is still served", () => {
    // projectGameView throws on a state naming a player it does not hold. Left
    // uncaught, that would abort the iteration and cut off every socket after
    // the bad one.
    const roomTopic = randomUUID();
    const poisoned = randomUUID();
    const healthy = randomUUID();
    const healthySent: string[] = [];
    const registrations = [
      register(roomTopic, poisoned, recordingSocket([])),
      register(roomTopic, healthy, recordingSocket(healthySent)),
    ];

    const stats = broadcastToRoomPerSubscriber(roomTopic, (subscriberId) => {
      if (subscriberId === poisoned) throw new Error("projection failed");
      return [{ kind: "projection" }];
    });
    for (const registration of registrations) {
      if (registration.ok) registration.value.unregister();
    }

    expect(stats.recipients).toBe(1);
    expect(healthySent).toHaveLength(1);
  });

  it("Given a socket that fails on send, When the room is served per subscriber, Then its quota is returned exactly as on a shared broadcast", () => {
    const roomTopic = randomUUID();
    const subscriberId = randomUUID();
    const registered = register(roomTopic, subscriberId, failingSocket());
    expect(socketsHeldBy(subscriberId)).toBe(1);

    const stats = broadcastToRoomPerSubscriber(roomTopic, () => [{ kind: "projection" }]);

    expect(stats.recipients).toBe(0);
    expect(socketsHeldBy(subscriberId)).toBe(0);
    if (registered.ok) registered.value.unregister();
  });

  it("Given a room nobody is watching, When it is served, Then the builder never runs", () => {
    // The publisher checks this before spending a repository read on a room no
    // socket is attached to — a bot-only match must stay free.
    let builds = 0;
    const stats = broadcastToRoomPerSubscriber(randomUUID(), () => {
      builds += 1;
      return [{}];
    });

    expect(builds).toBe(0);
    expect(stats).toEqual({ recipients: 0, viewers: 0, messages: 0 });
  });

  it("Given several tabs across two accounts, When the subscribers are listed, Then each account appears once", () => {
    const roomTopic = randomUUID();
    const first = randomUUID();
    const second = randomUUID();
    const registrations = [
      register(roomTopic, first, openSocket()),
      register(roomTopic, first, openSocket()),
      register(roomTopic, second, openSocket()),
    ];

    expect([...roomSubscriberIds(roomTopic)].sort()).toEqual([first, second].sort());
    for (const registration of registrations) {
      if (registration.ok) registration.value.unregister();
    }
    expect(roomSubscriberIds(roomTopic)).toEqual([]);
  });
});
