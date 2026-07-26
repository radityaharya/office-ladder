import { randomUUID } from "node:crypto";

import type { WSContext } from "hono/ws";
import { describe, expect, it } from "vitest";

import { parseRealtimeMessage } from "@office-ladder/contracts";
import { createStableId } from "@office-ladder/engine";
import { chatPublisher } from "../../src/rooms/chat/publish-chat";
import { registerRoomSocket } from "../../src/realtime/ws-hub";

function recordingSocket(): { readonly sent: string[]; readonly ws: WSContext } {
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

function subscribe(roomTopic: string, ws: WSContext): () => void {
  const registered = registerRoomSocket({ roomTopic, subscriberId: randomUUID(), ws });
  if (!registered.ok) {
    throw new Error(`socket registration refused: ${registered.error.code}`);
  }
  return registered.value.unregister;
}

describe("chat fan-out", () => {
  it("Given a socket in a room, When a message is published, Then it arrives as a valid realtime frame carrying its own content", () => {
    const roomId = randomUUID();
    const socket = recordingSocket();
    const unregister = subscribe(roomId, socket.ws);

    chatPublisher.message(roomId, {
      id: randomUUID(),
      roomId,
      authorId: createStableId("PlayerId", "user-chat-publisher"),
      kind: "text",
      body: "shipped",
      createdAt: "2026-07-26T12:00:00.000Z",
    });
    unregister();

    expect(socket.sent).toHaveLength(1);
    // Parsed with the client's own parser: a frame this server can emit but the
    // client cannot read is a silently dead feature.
    const frame = parseRealtimeMessage(JSON.parse(socket.sent[0] ?? "null"));
    expect(frame).toMatchObject({
      kind: "chat-message-posted",
      roomId,
      body: "shipped",
      messageKind: "text",
    });
  });

  it("Given a socket in a room, When a reaction is published, Then the envelope id and the reacted-to message are distinct fields", () => {
    const roomId = randomUUID();
    const messageId = randomUUID();
    const socket = recordingSocket();
    const unregister = subscribe(roomId, socket.ws);

    chatPublisher.reaction(roomId, {
      messageId,
      playerId: createStableId("PlayerId", "user-chat-reactor"),
      emote: "emote.fire",
      createdAt: "2026-07-26T12:00:01.000Z",
      removed: false,
    });
    unregister();

    const frame = parseRealtimeMessage(JSON.parse(socket.sent[0] ?? "null"));
    expect(frame).toMatchObject({
      kind: "emote-reaction-posted",
      targetKind: "message",
      targetId: messageId,
      emote: "emote.fire",
      removed: false,
    });
    if (frame.kind !== "emote-reaction-posted") return;
    expect(frame.messageId).not.toBe(messageId);
  });

  it("Given sockets in two rooms, When one room's chat is published, Then only that room hears it", () => {
    const roomId = randomUUID();
    const otherRoomId = randomUUID();
    const inRoom = recordingSocket();
    const elsewhere = recordingSocket();
    const unregisterInRoom = subscribe(roomId, inRoom.ws);
    const unregisterElsewhere = subscribe(otherRoomId, elsewhere.ws);

    chatPublisher.message(roomId, {
      id: randomUUID(),
      roomId,
      authorId: createStableId("PlayerId", "user-chat-publisher"),
      kind: "quick",
      body: "chat.phrase.hello",
      createdAt: "2026-07-26T12:00:00.000Z",
    });
    unregisterInRoom();
    unregisterElsewhere();

    expect(inRoom.sent).toHaveLength(1);
    expect(elsewhere.sent).toEqual([]);
  });

  it("Given a join code used as a room topic, When chat is published to it, Then nothing is broadcast", () => {
    const socket = recordingSocket();
    const unregister = subscribe("CHT001", socket.ws);

    chatPublisher.message("CHT001", {
      id: randomUUID(),
      roomId: "CHT001",
      authorId: createStableId("PlayerId", "user-chat-publisher"),
      kind: "text",
      body: "leaked to a code-shaped topic",
      createdAt: "2026-07-26T12:00:00.000Z",
    });
    unregister();

    // plans/11: a room code is a join credential and must never be a topic.
    expect(socket.sent).toEqual([]);
  });
});
