/**
 * Chat and emote reactions (spec §8.1, §8.2, §11.2).
 *
 * The order of checks in every method here is load-bearing and is the same in
 * all three:
 *
 *   room exists → actor is a member → the room's mode allows this → rate limit →
 *   parse the body → persist → announce.
 *
 * Membership comes before *everything* that could describe the room, so a
 * non-member learns nothing about a room's chat mode, its history length or its
 * message ids. The body is parsed last because parsing is the only step whose
 * refusal describes our own rules back to the caller, and an outsider has not
 * earned that.
 */
import {
  parseEmoteReactionRequest,
  parseSendMessageRequest,
  type Emote,
} from "@office-ladder/contracts";
import type { PlayerId } from "@office-ladder/engine";
import { log } from "@/observability/log";
import type { RoomActorKind, StoredRoom } from "@/rooms/service/types";
import {
  CHAT_MESSAGE_RATE_LIMIT,
  CHAT_REACTION_RATE_LIMIT,
  createSlidingWindowRateLimiter,
  type RateLimiter,
} from "./rate-limit";
import { resolveChatActor, resolveSocialRules } from "./room-access";
import type {
  ChatErrorCode,
  ChatHistoryInput,
  ChatHistoryPage,
  ChatMessageRecord,
  ChatMessageView,
  ChatReactionRecord,
  ChatReactionTally,
  ChatRepository,
  ChatRoomReader,
  ChatService,
  ChatServiceResult,
  ReactToChatMessageInput,
  ReactToChatMessageOutcome,
  SendChatMessageInput,
} from "./types";

/**
 * How many emotes one player may hold on one message.
 *
 * One, per the task's rule. The database's unique constraint on
 * `(message_id, player_id, emote)` cannot express this — it stops the *same*
 * emote twice, not a player stacking eight different ones — so the cap is
 * enforced here and the constraint remains the backstop for the duplicate case.
 */
export const MAX_EMOTES_PER_PLAYER_PER_MESSAGE = 1;

/** Page size when the caller does not ask for one. */
export const DEFAULT_CHAT_HISTORY_LIMIT = 30;

/**
 * Hard ceiling on a page, applied to a client-supplied number.
 *
 * A `limit` is attacker-controlled input: without a ceiling, `?limit=1000000` is
 * a one-request way to make the server read and serialize a room's entire
 * history. Clamped rather than refused, because an over-large limit is far more
 * often an optimistic client than an attack.
 */
export const MAX_CHAT_HISTORY_LIMIT = 50;

export type ChatServiceDependencies = {
  readonly rooms: ChatRoomReader;
  readonly messages: ChatRepository;
  /** ISO-8601 instant for a new row. */
  readonly now: () => string;
  readonly ids: { readonly messageId: () => string };
  /**
   * Fan-out to the room's sockets. Returns nothing and must never throw: the
   * message is already committed by the time it is called, so a failed broadcast
   * is a stale client, not a failed request.
   */
  readonly publish: ChatPublisher;
  /** Overridable so tests can drive the window without waiting on a clock. */
  readonly rateLimiters?: {
    readonly messages: RateLimiter;
    readonly reactions: RateLimiter;
  };
};

export type ChatPublisher = {
  message(roomId: string, message: ChatMessageRecord): void;
  reaction(
    roomId: string,
    reaction: ChatReactionRecord & { readonly removed: boolean },
  ): void;
};

function fail<Value>(code: ChatErrorCode): ChatServiceResult<Value> {
  return { ok: false, error: { code } };
}

function defaultRateLimiters(): {
  readonly messages: RateLimiter;
  readonly reactions: RateLimiter;
} {
  const now = (): number => Date.now();
  return {
    messages: createSlidingWindowRateLimiter({ ...CHAT_MESSAGE_RATE_LIMIT, now }),
    reactions: createSlidingWindowRateLimiter({ ...CHAT_REACTION_RATE_LIMIT, now }),
  };
}

/**
 * Clamps rather than rejects: `limit` arrives as a raw query string, so `"abc"`,
 * `"-1"`, `"1e9"` and an absent value all have to mean something, and the only
 * safe meaning is "the default".
 */
export function clampHistoryLimit(value: unknown): number {
  // `Number("")` and `Number(null)` are both 0, which would otherwise clamp to a
  // one-message page: an absent value and an empty one must both mean "default".
  if (value === undefined || value === null || value === "") {
    return DEFAULT_CHAT_HISTORY_LIMIT;
  }

  const requested = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(requested)) return DEFAULT_CHAT_HISTORY_LIMIT;
  return Math.min(MAX_CHAT_HISTORY_LIMIT, Math.max(1, Math.trunc(requested)));
}

export function createChatService(deps: ChatServiceDependencies): ChatService {
  const limiters = deps.rateLimiters ?? defaultRateLimiters();

  /**
   * Room + membership, the prefix every method shares. Returns the stored room
   * as well, because every caller then needs the social rules off it and a
   * second read would be a second chance for the two to disagree.
   */
  async function authorize(
    roomId: string,
    actorId: string,
    actorKind: RoomActorKind,
  ): Promise<
    | { readonly ok: true; readonly room: StoredRoom; readonly playerId: PlayerId }
    | { readonly ok: false; readonly error: { readonly code: ChatErrorCode } }
  > {
    const room = await deps.rooms.get(roomId);
    if (room === null) return { ok: false, error: { code: "ROOM_NOT_FOUND" } };

    const actor = resolveChatActor(room, actorId, actorKind);
    if (!actor.ok) return actor;
    return { ok: true, room, playerId: actor.value };
  }

  function viewOf(
    room: StoredRoom,
    message: ChatMessageRecord,
    reactions: readonly ChatReactionRecord[],
    viewerId: PlayerId,
  ): ChatMessageView {
    return {
      ...message,
      authorName:
        message.authorId === null ? null : (room.memberNames[message.authorId] ?? null),
      reactions: tally(reactions, viewerId),
    };
  }

  return {
    async history(input: ChatHistoryInput) {
      const authorized = await authorize(input.roomId, input.viewerId, "human");
      if (!authorized.ok) return fail(authorized.error.code);

      const { room, playerId } = authorized;
      // Reading is refused in an `off` room too. The alternative — a readable
      // log nobody can add to — leaves whatever was said while the mode was
      // `full` visible after it is switched off, which is the opposite of what
      // switching it off is for.
      if (resolveSocialRules(room).chat === "off") return fail("CHAT_DISABLED");

      let before: ChatMessageRecord | null = null;
      if (input.before !== null) {
        const cursor = await deps.messages.getMessage(input.before);
        // A cursor from another room is refused rather than ignored: silently
        // treating it as "no cursor" would answer a probe for "does this message
        // id exist somewhere" with a 200.
        if (cursor === null || cursor.roomId !== room.id) return fail("INVALID_CURSOR");
        before = cursor;
      }

      const limit = clampHistoryLimit(input.limit);
      const newestFirst = await deps.messages.listMessages({
        roomId: room.id,
        before,
        limit,
      });
      const reactions = await deps.messages.listReactions(
        newestFirst.map((message) => message.id),
      );
      const byMessage = new Map<string, ChatReactionRecord[]>();
      for (const reaction of reactions) {
        const held = byMessage.get(reaction.messageId);
        if (held === undefined) {
          byMessage.set(reaction.messageId, [reaction]);
          continue;
        }
        held.push(reaction);
      }

      const oldest = newestFirst[newestFirst.length - 1];
      const page: ChatHistoryPage = {
        messages: [...newestFirst]
          .reverse()
          .map((message) =>
            viewOf(room, message, byMessage.get(message.id) ?? [], playerId),
          ),
        // Only claim there is more when the page came back full. A short page
        // has reached the start of the room's history by definition.
        nextCursor:
          newestFirst.length === limit && oldest !== undefined ? oldest.id : null,
      };
      return { ok: true, value: page };
    },

    async send(input: SendChatMessageInput) {
      const authorized = await authorize(input.roomId, input.actorId, input.actorKind);
      if (!authorized.ok) return fail(authorized.error.code);

      const { room, playerId } = authorized;
      const social = resolveSocialRules(room);
      if (social.chat === "off") return fail("CHAT_DISABLED");

      if (!limiters.messages.consume(`${room.id}:${playerId}`)) {
        // Logged, unlike an ordinary refusal: a member hitting the ceiling is
        // either a broken client or someone trying to flood a room, and both are
        // things you want to be able to see afterwards.
        log("warn", "chat.rate-limited", { room: room.id, actor: playerId });
        return fail("RATE_LIMITED");
      }

      // Throws ContractValidationError for a malformed body — the route maps it
      // to one 400. The mode is passed even though `off` was already refused
      // above, so the parser's own gate stays a real second lock rather than a
      // dead branch.
      const request = parseSendMessageRequest(input.body, { chatMode: social.chat });
      if (request.kind === "text" && input.actorKind === "bot") {
        // §8.1: quick mode is "the only mode bots can meaningfully use". A bot
        // that could post free text in a `full` room would be a text generator
        // wearing a player's seat, which is not what a seat-filler is for.
        return fail("CHAT_TEXT_NOT_ALLOWED");
      }

      const message: ChatMessageRecord = {
        id: deps.ids.messageId(),
        roomId: room.id,
        authorId: playerId,
        kind: request.kind,
        body: request.body,
        createdAt: deps.now(),
      };
      await deps.messages.insertMessage(message);

      // The moderation trail: who, where, when, and how long — never the body.
      // The row holds the text; a log that also held it would put player-written
      // content into every log sink for the life of the deployment.
      log("info", "chat.posted", {
        room: room.id,
        actor: playerId,
        message: message.id,
        kind: message.kind,
        length: message.body.length,
      });
      deps.publish.message(room.id, message);

      return { ok: true, value: viewOf(room, message, [], playerId) };
    },

    async react(input: ReactToChatMessageInput) {
      const authorized = await authorize(input.roomId, input.actorId, input.actorKind);
      if (!authorized.ok) return fail(authorized.error.code);

      const { room, playerId } = authorized;
      const social = resolveSocialRules(room);
      if (!social.emoteReactions) return fail("EMOTE_REACTIONS_DISABLED");

      if (!limiters.reactions.consume(`${room.id}:${playerId}`)) {
        log("warn", "chat.rate-limited", { room: room.id, actor: playerId });
        return fail("RATE_LIMITED");
      }

      const request = parseEmoteReactionRequest(input.body, {
        emoteReactionsEnabled: social.emoteReactions,
      });
      // The path names the message; the body must agree. `targetKind: "event"`
      // has no endpoint in v1 — feed events are not rows anywhere, so an emote
      // on one has nothing to hang off and nothing to de-duplicate against.
      if (request.targetKind !== "message" || request.targetId !== input.messageId) {
        return fail("EMOTE_TARGET_MISMATCH");
      }

      const target = await deps.messages.getMessage(input.messageId);
      // A message in another room is "not found" here, deliberately: answering
      // otherwise would let any member of any room confirm a message id exists
      // in a room they are not in.
      if (target === null || target.roomId !== room.id) return fail("MESSAGE_NOT_FOUND");

      const reaction: ChatReactionRecord = {
        messageId: target.id,
        playerId,
        emote: request.emote,
        createdAt: deps.now(),
      };

      if (request.removed) {
        // Idempotent by design: removing an emote that is not there is the state
        // the caller asked for, so it succeeds. The broadcast is skipped when
        // nothing changed rather than telling every socket about a no-op.
        const removed = await deps.messages.deleteReaction(reaction);
        if (removed) deps.publish.reaction(room.id, { ...reaction, removed: true });
        return {
          ok: true,
          value: { messageId: target.id, emote: reaction.emote, removed: true },
        };
      }

      const inserted = await deps.messages.insertReaction(
        reaction,
        MAX_EMOTES_PER_PLAYER_PER_MESSAGE,
      );
      // Both refusals come back as a value from the repository rather than as a
      // thrown constraint violation, so a double-click answers 409 instead of
      // the 500 a raw unique-violation would produce.
      if (inserted === "duplicate") return fail("EMOTE_ALREADY_APPLIED");
      if (inserted === "limit-reached") return fail("EMOTE_LIMIT_REACHED");

      deps.publish.reaction(room.id, { ...reaction, removed: false });
      return {
        ok: true,
        value: { messageId: target.id, emote: reaction.emote, removed: false },
      } satisfies ChatServiceResult<ReactToChatMessageOutcome>;
    },
  };
}

function tally(
  reactions: readonly ChatReactionRecord[],
  viewerId: PlayerId,
): readonly ChatReactionTally[] {
  const counts = new Map<Emote, { count: number; mine: boolean }>();
  for (const reaction of reactions) {
    const held = counts.get(reaction.emote) ?? { count: 0, mine: false };
    counts.set(reaction.emote, {
      count: held.count + 1,
      mine: held.mine || reaction.playerId === viewerId,
    });
  }

  return [...counts].map(([emote, held]) => ({ emote, ...held }));
}
