import {
  ContractValidationError,
  parseChatMessagePosted,
  type ChatMessagePosted,
} from "@office-ladder/contracts";
import { log } from "@/observability/log";
import { parseRoomTopic } from "@/realtime/room-topic";
import { broadcastToRoom } from "@/realtime/ws-hub";
import type { BotDriverEvent } from "./bot-driver";

/**
 * Pushes a bot's thinking beat — and its occasional remark — to the room.
 *
 * ### Why this travels as a quick-chat message
 *
 * The pacing complaint was not "bots are too fast", it was "I genuinely can't
 * follow the game". A pause the room is never told about is the worse half of
 * that: a player watching a silent gap cannot tell a deciding bot from a server
 * that has stopped answering, and reloading is the rational response to the
 * second.
 *
 * `RealtimeMessage` is a closed union owned by `packages/contracts`, and a
 * "bot-thinking" kind is not in it — adding one is that package's call, not this
 * one's. But `chat-message-posted` with `messageKind: "quick"` already carries
 * exactly what is needed: an author, a phrase id from a fixed list, and a
 * timestamp. `chat.phrase.thinking` is in that list. So the beat is a real,
 * already-parseable message rather than an invented kind every current client
 * would drop on the floor, and the wording stays the client's (spec §8.1).
 *
 * ### Ephemeral on purpose
 *
 * Nothing here is persisted. A thinking beat is worth exactly as long as the
 * pause it explains, and writing six of them per round into `room_messages`
 * would fill a human's chat history with a bot clearing its throat. That also
 * keeps this module out of the chat service's way entirely — when chat
 * persistence lands, a bot's *remarks* may want to be stored; its "thinking"
 * never should.
 *
 * ### Never throws
 *
 * Called fire-and-forget from the driver's event sink, on the path to a command
 * that is about to commit. A refused payload or a dead socket must not delay or
 * abort a bot's turn, so every failure is logged and swallowed.
 */

/** Only the two events that carry a line, and only in `quick` chat rooms. */
function messageFor(event: BotDriverEvent): ChatMessagePosted | null {
  if (event.type !== "bot.thinking" && event.type !== "bot.command.applied") return null;
  if (event.line === null) return null;

  return {
    kind: "chat-message-posted",
    // Distinct per beat and per commit, so a reconnecting client can dedupe:
    // `messageId` is the dedupe key for this message kind.
    messageId:
      event.type === "bot.thinking"
        ? `bot-thinking:${String(event.playerId)}:${event.decision}`
        : `bot-said:${event.commandId}`,
    roomId: event.roomId,
    authorId: String(event.playerId),
    messageKind: event.line.messageKind,
    body: event.line.phraseId,
    createdAt: new Date().toISOString(),
  };
}

export function publishBotThinking(event: BotDriverEvent): void {
  const message = messageFor(event);
  if (message === null) return;

  try {
    const topic = parseRoomTopic(message.roomId);
    // Validated with the same parser a client will use to read it. A payload
    // this server built and no client can parse is worse than no payload: the
    // beat would silently never appear and the pacing would look broken again.
    const validated = parseChatMessagePosted(message);
    broadcastToRoom(topic, validated);
  } catch (error) {
    if (!(error instanceof ContractValidationError)) throw error;
    log("warn", "bots.thinking-publish-rejected", {
      room: message.roomId,
      player: message.authorId,
      reason: error.message,
    });
  }
}
