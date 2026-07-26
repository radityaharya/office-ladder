/**
 * Chat fan-out over the room's WebSocket topic (spec §11.3).
 *
 * Chat rides the same sockets as `projection-updated` but carries **its own
 * content** rather than an invalidation. That difference is the whole reason
 * this is a separate module from `publish-projection-update.ts`: a projection
 * update says "re-fetch", and the client can always recover by polling, whereas
 * a chat frame that is not delivered is a line that recipient never sees until
 * they scroll the history back. It is still not allowed to fail a request —
 * the message is committed before this runs — so every failure is reported and
 * swallowed.
 *
 * There is no per-viewer redaction here and there must never need to be: a room
 * has one chat, every member sees the same lines, and §8.1 rules out DMs
 * precisely so that no chat frame ever has an audience narrower than the room.
 * If a private channel is ever built, this function is not the place to bolt it
 * on.
 */
import {
  ContractValidationError,
  parseChatMessagePosted,
  parseEmoteReactionPosted,
} from "@office-ladder/contracts";
import { log } from "@/observability/log";
import { parseRoomTopic } from "@/realtime/room-topic";
import { broadcastToRoom } from "@/realtime/ws-hub";
import type { ChatPublisher } from "./chat-service";

function publish(roomId: string, kind: string, build: () => unknown): void {
  try {
    const topic = parseRoomTopic(roomId);
    const payload = build();
    const recipients = broadcastToRoom(topic, payload);
    log("debug", "chat.published", { room: topic, kind, recipients });
  } catch (error) {
    if (!(error instanceof ContractValidationError)) {
      // Not a payload problem: a broken socket registry, a serialization fault.
      // Reported and dropped, because the caller has already committed.
      log("error", "chat.publish-failed", { room: roomId, kind });
      return;
    }

    // The payload this server built itself was refused by its own contract, so
    // nobody was told. Silent in the client, loud here.
    log("error", "chat.publish-rejected", {
      room: roomId,
      kind,
      field: error.path,
      reason: error.reason,
    });
  }
}

export const chatPublisher: ChatPublisher = {
  message(roomId, message) {
    publish(roomId, "chat-message-posted", () =>
      parseChatMessagePosted({
        kind: "chat-message-posted",
        messageId: message.id,
        roomId: message.roomId,
        // A `system` message has no author and cannot cross this contract, which
        // is correct for now: nothing writes one. Whoever adds them owns
        // widening `ChatMessagePosted.authorId` in contracts first.
        authorId: message.authorId,
        messageKind: message.kind,
        body: message.body,
        createdAt: message.createdAt,
      }),
    );
  },
  reaction(roomId, reaction) {
    publish(roomId, "emote-reaction-posted", () =>
      parseEmoteReactionPosted({
        kind: "emote-reaction-posted",
        // The envelope's own id, for dedupe across a reconnect — deliberately
        // not the reacted-to message id, which travels as `targetId`. The three
        // parts together are ~90 characters for a UUID message id and a Better
        // Auth user id, inside `parseOpaqueId`'s 128; an id long enough to
        // overflow that is refused and logged rather than crashing a publish.
        messageId: `${reaction.messageId}:${reaction.playerId}:${reaction.emote}`,
        roomId,
        actorId: reaction.playerId,
        targetKind: "message",
        targetId: reaction.messageId,
        emote: reaction.emote,
        removed: reaction.removed,
        createdAt: reaction.createdAt,
      }),
    );
  },
};
