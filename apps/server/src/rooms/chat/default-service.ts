import { randomUUID } from "node:crypto";

import { roomRepository } from "@/rooms/default-service";
import { createChatService } from "./chat-service";
import { PostgresChatRepository } from "./postgres-repository";
import { chatPublisher } from "./publish-chat";
import type { ChatService } from "./types";

/**
 * The process-wide chat service.
 *
 * It reads rooms through the *same* repository instance the room service uses,
 * so membership and chat mode are answered from the room a player is actually
 * in rather than from a second, independently-cached view of it. It has its own
 * storage, because chat rows are not part of the room snapshot and must not
 * become a reason to bump a room revision.
 */
export const chatService: ChatService = createChatService({
  rooms: roomRepository,
  messages: new PostgresChatRepository(),
  now: () => new Date().toISOString(),
  ids: { messageId: randomUUID },
  publish: chatPublisher,
});
