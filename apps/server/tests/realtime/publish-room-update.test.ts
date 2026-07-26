import { randomUUID } from "node:crypto";

import type { WSContext } from "hono/ws";
import { describe, expect, it } from "vitest";

import type { ProjectionUpdated } from "@office-ladder/contracts";
import { publishRoomUpdate } from "../../src/realtime/publish-room-update";
import { registerRoomSocket } from "../../src/realtime/ws-hub";

type RecordingSocket = {
  readonly sent: string[];
  readonly ws: WSContext;
};

function recordingSocket(): RecordingSocket {
  const sent: string[] = [];
  return {
    sent,
    ws: {
      send(message: string) {
        sent.push(message);
      },
    } as unknown as WSContext,
  };
}

/** See publish-projection-update.test.ts — registration is refusable. */
function subscribe(roomTopic: string, ws: WSContext): () => void {
  const registered = registerRoomSocket({ roomTopic, subscriberId: randomUUID(), ws });
  if (!registered.ok) {
    throw new Error(`socket registration refused: ${registered.error.code}`);
  }
  return registered.value.unregister;
}

function projectionUpdate(revision: number): ProjectionUpdated {
  return {
    kind: "projection-updated",
    messageId: randomUUID(),
    aggregateVersion: revision,
    projectionRevision: revision,
    changed: ["room", "game", "players", "prompts", "reactions", "legal-actions", "history"],
  };
}

describe("publishRoomUpdate", () => {
  it("Given a socket registered under a randomUUID room id, When a projection update is published to that room id, Then the socket receives it", async () => {
    const roomId = randomUUID();
    const socket = recordingSocket();
    const unregister = subscribe(roomId, socket.ws);

    const result = await publishRoomUpdate({
      roomTopic: roomId,
      update: projectionUpdate(4),
    });
    unregister();

    expect(result).toEqual({ ok: true });
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0] ?? "null")).toMatchObject({
      kind: "projection-updated",
      aggregateVersion: 4,
      projectionRevision: 4,
    });
  });

  it("Given sockets in two different rooms, When one room is published to, Then only that room's socket is notified", async () => {
    const subscribedRoomId = randomUUID();
    const otherRoomId = randomUUID();
    const subscribed = recordingSocket();
    const other = recordingSocket();
    const unregisterSubscribed = subscribe(subscribedRoomId, subscribed.ws);
    const unregisterOther = subscribe(otherRoomId, other.ws);

    await publishRoomUpdate({
      roomTopic: subscribedRoomId,
      update: projectionUpdate(1),
    });
    unregisterSubscribed();
    unregisterOther();

    expect(subscribed.sent).toHaveLength(1);
    expect(other.sent).toEqual([]);
  });

  it("Given a six-character room code used as a topic, When publishing, Then the update is rejected instead of leaking to a code-shaped topic", async () => {
    const socket = recordingSocket();
    const unregister = subscribe("ABC123", socket.ws);

    const result = await publishRoomUpdate({
      roomTopic: "ABC123",
      update: projectionUpdate(1),
    });
    unregister();

    expect(result).toEqual({ ok: false, error: { kind: "invalid_room_topic" } });
    expect(socket.sent).toEqual([]);
  });
});
