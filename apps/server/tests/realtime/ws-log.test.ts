import type { WSContext } from "hono/ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RoomSocketRejectionCode } from "../../src/realtime/authorize-room-socket";
import { broadcastToRoom, registerRoomSocket } from "../../src/realtime/ws-hub";
import { roomSocketRejectionLevel } from "../../src/realtime/ws-log";

/**
 * Realtime has been silently dead in production twice. What makes that
 * detectable is a socket lifecycle that leaves a trace at both ends and names why
 * a socket left, plus a refusal reason that survives being collapsed into one
 * deliberately uninformative close code on the wire.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

function socketThatWorks(): WSContext {
  return { send: () => undefined } as unknown as WSContext;
}

function socketThatFails(): WSContext {
  return {
    send: () => {
      throw new Error("socket is gone");
    },
  } as unknown as WSContext;
}

type ConsoleSpy = {
  readonly mock: { readonly calls: readonly unknown[][] };
};

function lines(spy: ConsoleSpy): readonly string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

describe("roomSocketRejectionLevel", () => {
  it("Given an ordinary refusal, When classifying it, Then it is info", () => {
    // An expired cookie or a stale room id in a bookmarked URL is normal traffic.
    expect(roomSocketRejectionLevel("UNAUTHORIZED")).toBe("info");
    expect(roomSocketRejectionLevel("INVALID_ROOM_TOPIC")).toBe("info");
    expect(roomSocketRejectionLevel("ROOM_NOT_FOUND")).toBe("info");
  });

  it("Given a refusal that means somebody reached for another account's room, When classifying it, Then it is warn", () => {
    const suspicious: readonly RoomSocketRejectionCode[] = [
      "FORBIDDEN_ORIGIN",
      "NOT_ROOM_MEMBER",
      "SUBSCRIBER_IS_BOT",
      "SOCKET_LIMIT_REACHED",
    ];

    for (const code of suspicious) {
      expect(roomSocketRejectionLevel(code)).toBe("warn");
    }
  });
});

describe("socket lifecycle reporting", () => {
  it("Given a socket that registers and closes cleanly, When it is released, Then both ends are reported with the topic and how long it lived", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const registered = registerRoomSocket({
      roomTopic: "room-lifecycle-clean",
      subscriberId: "user-1",
      ws: socketThatWorks(),
    });

    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    registered.value.unregister();

    const [open, close] = lines(out);
    expect(open).toContain("ws.registered");
    expect(open).toContain("topic=room-lifecycle-clean");
    expect(open).toContain("subscriber=user-1");
    expect(close).toContain("ws.closed");
    expect(close).toContain("reason=closed");
    expect(close).toContain("durationMs=");
    expect(close).toContain("topicSockets=0");
  });

  it("Given a socket whose send throws, When a broadcast reaches it, Then it is dropped *and* reported, not swallowed", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const registered = registerRoomSocket({
      roomTopic: "room-lifecycle-broken",
      subscriberId: "user-2",
      ws: socketThatFails(),
    });
    expect(registered.ok).toBe(true);

    const sent = broadcastToRoom("room-lifecycle-broken", { kind: "projection-updated" });

    // Behaviour is unchanged: the dead socket is still dropped silently as far as
    // the caller is concerned …
    expect(sent).toBe(0);
    expect(broadcastToRoom("room-lifecycle-broken", { kind: "projection-updated" })).toBe(0);
    // … but a room bleeding its realtime feed one client at a time is now
    // visible, at warn, with the reason that distinguishes it from a clean close.
    const closes = lines(err).filter((line) => line.includes("ws.closed"));
    expect(closes).toHaveLength(1);
    expect(closes[0]).toContain("reason=send-failed");
    expect(closes[0]).toContain("topic=room-lifecycle-broken");
    expect(closes[0]).toContain("error=");
  });

  it("Given a subscriber at its socket ceiling, When it opens one more, Then the refusal is reported with the quota that caused it", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    // The limit is the hub's own constant; opening until it refuses avoids
    // restating the number here.
    let refused: ReturnType<typeof registerRoomSocket> | null = null;
    for (let attempt = 0; attempt < 32 && refused === null; attempt += 1) {
      const result = registerRoomSocket({
        roomTopic: `room-limit-${attempt}`,
        subscriberId: "user-greedy",
        ws: socketThatWorks(),
      });
      if (!result.ok) refused = result;
    }

    expect(refused).not.toBeNull();
    expect(refused?.ok).toBe(false);
    const rejections = lines(err).filter((line) => line.includes("ws.rejected"));
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toContain("reason=SOCKET_LIMIT_REACHED");
    expect(rejections[0]).toContain("subscriber=user-greedy");
    expect(rejections[0]).toContain("limit=");
  });
});
