import { randomUUID } from "node:crypto";

import type { WSContext } from "hono/ws";
import { describe, expect, it } from "vitest";

import { parseProjectionUpdated } from "@office-ladder/contracts";
import { publishProjectionUpdate } from "../../src/realtime/publish-projection-update";
import { registerRoomSocket } from "../../src/realtime/ws-hub";

/**
 * publishProjectionUpdate is what routes/rooms.ts calls after every committed
 * roll/start/respond and every bot seat change, and what the bot driver calls
 * after each bot command. It builds the payload itself and then discards the
 * publish result, so an invalid payload would drop the broadcast with no trace.
 * These tests pin the whole chain: the room id the browser subscribes with ->
 * the topic the hub registers -> a payload the client's own parser accepts.
 */
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

/**
 * Registration can be refused (the per-subscriber socket cap), so these tests
 * assert it succeeded rather than silently testing an unregistered socket. A
 * fresh subscriber id per socket keeps the cap out of the way here — it has its
 * own tests in ws-hub.test.ts.
 */
function subscribe(roomTopic: string, ws: WSContext): () => void {
  const registered = registerRoomSocket({ roomTopic, subscriberId: randomUUID(), ws });
  if (!registered.ok) {
    throw new Error(`socket registration refused: ${registered.error.code}`);
  }
  return registered.value.unregister;
}

describe("publishProjectionUpdate", () => {
  it("Given a socket subscribed with the room id, When a committed command publishes, Then the browser's own parser accepts what arrives", async () => {
    // Exactly what apps/web's subscribeRoomUpdates(roomId, ...) registers, and
    // exactly what ids.roomId (randomUUID) produces.
    const roomId = randomUUID();
    const commandId = randomUUID();
    const socket = recordingSocket();
    const unregister = subscribe(roomId, socket.ws);

    await publishProjectionUpdate(roomId, 7, commandId);
    unregister();

    expect(socket.sent).toHaveLength(1);
    // parseProjectionUpdated is the client-side gate too: if the hardcoded
    // `changed` list or the revision fields were wrong, the payload would never
    // have reached the socket at all, and the client would reject it if it did.
    const update = parseProjectionUpdated(JSON.parse(socket.sent[0] ?? "null"));
    expect(update).toEqual({
      kind: "projection-updated",
      messageId: commandId,
      aggregateVersion: 7,
      projectionRevision: 7,
      changed: [
        "room",
        "game",
        "players",
        "prompts",
        "reactions",
        "legal-actions",
        "history",
      ],
    });
  });

  it("Given a bot seat change, When it publishes with the bot member id as the messageId, Then the update still reaches the room", async () => {
    // The add/remove-bot routes have no client-supplied commandId, so they pass
    // the bot's member id instead. Colons are legal in contracts' ID_PATTERN,
    // but the payload is validated before broadcast, so this needs proving.
    const roomId = randomUUID();
    const socket = recordingSocket();
    const unregister = subscribe(roomId, socket.ws);

    await publishProjectionUpdate(roomId, 1, `bot:${roomId}:0`);
    unregister();

    expect(socket.sent).toHaveLength(1);
    expect(parseProjectionUpdated(JSON.parse(socket.sent[0] ?? "null"))).toMatchObject({
      messageId: `bot:${roomId}:0`,
      projectionRevision: 1,
    });
  });

  it("Given consecutive bot turns, When each publishes its own revision, Then the client's monotonic revision filter would keep every one", async () => {
    const roomId = randomUUID();
    const socket = recordingSocket();
    const unregister = subscribe(roomId, socket.ws);

    for (const revision of [4, 5, 6]) {
      await publishProjectionUpdate(roomId, revision, `bot:game:${revision}:roll`);
    }
    unregister();

    const revisions = socket.sent.map(
      (message) => parseProjectionUpdated(JSON.parse(message)).projectionRevision,
    );
    expect(revisions).toEqual([4, 5, 6]);
  });

  it("Given a room nobody is subscribed to, When it publishes, Then nothing throws and no other room is notified", async () => {
    const other = recordingSocket();
    const unregister = subscribe(randomUUID(), other.ws);

    await expect(publishProjectionUpdate(randomUUID(), 2, randomUUID())).resolves.toBeUndefined();
    unregister();

    expect(other.sent).toEqual([]);
  });
});
