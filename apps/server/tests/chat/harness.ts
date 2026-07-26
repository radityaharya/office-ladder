/**
 * A room, a chat service and a fake session, wired the way production wires
 * them: a *real* room service over the in-memory room repository, so membership,
 * bot seats and the room's mode all come from a genuinely stored room rather
 * than from a hand-written object that could not exist.
 */
import type { RoomMode } from "@office-ladder/contracts";
import { createStableId, type PlayerId } from "@office-ladder/engine";
import type { HttpResult } from "../../src/http";
import { httpError, HTTP_ERROR_CODES } from "../../src/http/errors";
import { createChatService, type ChatPublisher } from "../../src/rooms/chat/chat-service";
import { InMemoryChatRepository } from "../../src/rooms/chat/in-memory-repository";
import type { RateLimiter } from "../../src/rooms/chat/rate-limit";
import type { ChatRoomReader, ChatService } from "../../src/rooms/chat/types";
import { InMemoryRoomRepository } from "../../src/rooms/in-memory-repository";
import { createRoomService } from "../../src/rooms/service/create-room-service";
import type { RoomService, StoredRoom } from "../../src/rooms/service/types";

export const HOST = createStableId("PlayerId", "user-chat-host");
export const MEMBER = createStableId("PlayerId", "user-chat-member");
export const STRANGER = createStableId("PlayerId", "user-chat-stranger");

export type PublishedMessage = {
  readonly roomId: string;
  readonly id: string;
  readonly body: string;
};

export type PublishedReaction = {
  readonly roomId: string;
  readonly messageId: string;
  readonly playerId: PlayerId;
  readonly emote: string;
  readonly removed: boolean;
};

export type ChatHarness = {
  readonly roomId: string;
  readonly rooms: RoomService;
  readonly chat: ChatService;
  readonly published: {
    readonly messages: readonly PublishedMessage[];
    readonly reactions: readonly PublishedReaction[];
  };
  readonly botSeatId: PlayerId | null;
  readonly room: () => Promise<StoredRoom>;
};

export type ChatHarnessOptions = {
  /**
   * `mode.quick` ships `social.chat: "quick"` and `mode.marathon` ships
   * `"full"`. The gate is read from the resolved ruleset and never from this
   * id, so these are the two real shipped configurations rather than a
   * test-only switch.
   */
  readonly mode?: RoomMode;
  readonly withBot?: boolean;
  /** Starts the match, so the room carries a snapshotted `GameState.rules`. */
  readonly start?: boolean;
  /**
   * Rewrites the stored room on the way into the chat service only.
   *
   * The one thing a shipped preset cannot produce is `social.chat: "off"` — no
   * preset ships it, and §8.4's custom rulesets are authored into
   * `GameState.rules` rather than into a mode id. Patching the *snapshotted*
   * ruleset of a started match is exactly the shape a custom ruleset has, so
   * this exercises the real branch rather than inventing a fake room.
   */
  readonly roomPatch?: (room: StoredRoom) => StoredRoom;
  readonly rateLimiters?: {
    readonly messages: RateLimiter;
    readonly reactions: RateLimiter;
  };
};

let harnessCount = 0;

export async function chatHarness(options?: ChatHarnessOptions): Promise<ChatHarness> {
  harnessCount += 1;
  const suffix = String(harnessCount);
  const roomId = `room-chat-${suffix}`;
  const repository = new InMemoryRoomRepository();
  const rooms = createRoomService({
    repository,
    now: () => "2026-07-26T12:00:00.000Z",
    ids: {
      roomId: () => roomId,
      roomCode: () => `CHT${suffix.padStart(3, "0")}`,
      gameId: () => createStableId("GameId", `game-chat-${suffix}`),
      commandId: () => createStableId("CommandId", `command-chat-${suffix}`),
    },
    gameSeed: () => `chat-seed-${suffix}`,
    turnTimeoutMs: 0,
  });

  await rooms.create({
    hostId: HOST,
    playerName: "Host",
    modeId: options?.mode ?? "mode.marathon",
  });
  await rooms.join({ roomId, actorId: MEMBER, playerName: "Member" });

  let botSeatId: PlayerId | null = null;
  if (options?.withBot === true) {
    const added = await rooms.addBot({ roomId, actorId: HOST, difficulty: "standard" });
    if (!added.ok) throw new Error(`bot seat refused: ${added.error.code}`);
    const seat = added.value.bots[0];
    if (seat === undefined) throw new Error("bot seat missing");
    botSeatId = seat.playerId;
  }

  if (options?.start === true) {
    // A match needs three seats; the harness's two humans are one short, so a
    // bot fills the third rather than the tests carrying a third fake account.
    if (botSeatId === null) {
      const filler = await rooms.addBot({ roomId, actorId: HOST, difficulty: "standard" });
      if (!filler.ok) throw new Error(`bot seat refused: ${filler.error.code}`);
      const seat = filler.value.bots[0];
      if (seat === undefined) throw new Error("bot seat missing");
      botSeatId = seat.playerId;
    }

    const started = await rooms.start({ roomId, actorId: HOST, actorKind: "human" });
    if (!started.ok) throw new Error(`match refused to start: ${started.error.code}`);
  }

  const messages: PublishedMessage[] = [];
  const reactions: PublishedReaction[] = [];
  const publish: ChatPublisher = {
    message(publishedRoomId, message) {
      messages.push({ roomId: publishedRoomId, id: message.id, body: message.body });
    },
    reaction(publishedRoomId, reaction) {
      reactions.push({
        roomId: publishedRoomId,
        messageId: reaction.messageId,
        playerId: reaction.playerId,
        emote: reaction.emote,
        removed: reaction.removed,
      });
    },
  };

  /**
   * One counter behind both the id and the timestamp, so every message is
   * strictly newer than the one before it. Pagination is a keyset over
   * `(createdAt, id)`; a frozen clock would silently test only the tiebreak.
   */
  const epoch = Date.parse("2026-07-26T12:00:00.000Z");
  let issued = 0;

  const patch = options?.roomPatch;
  const reader: ChatRoomReader = {
    async get(id) {
      const stored = await repository.get(id);
      if (stored === null || patch === undefined) return stored;
      return patch(stored);
    },
  };

  const chat = createChatService({
    rooms: reader,
    messages: new InMemoryChatRepository(),
    now: () => new Date(epoch + issued * 1000).toISOString(),
    ids: {
      messageId: () => {
        issued += 1;
        return `message-${suffix}-${String(issued).padStart(3, "0")}`;
      },
    },
    publish,
    ...(options?.rateLimiters === undefined
      ? {}
      : { rateLimiters: options.rateLimiters }),
  });

  return {
    roomId,
    rooms,
    chat,
    published: { messages, reactions },
    botSeatId,
    room: async () => {
      const stored = await repository.get(roomId);
      if (stored === null) throw new Error("harness room disappeared");
      return stored;
    },
  };
}

export function session(userId: string): Promise<HttpResult<{ user: { id: string } }>> {
  return Promise.resolve({ ok: true, value: { user: { id: userId } } });
}

export function noSession(): Promise<HttpResult<{ user: { id: string } }>> {
  return Promise.resolve({
    ok: false,
    error: httpError(HTTP_ERROR_CODES.UNAUTHORIZED),
  });
}
