/**
 * Room chat and emote reactions (spec §8.1, §8.2, §11.2).
 *
 * **Chat is not game state.** Nothing in this directory reads or writes
 * `GameState`, no chat line bumps a room revision, and a replay of a match with
 * the whole chat log deleted produces the identical game. The only thing chat
 * takes *from* the room is the answers to two questions — "is this actor a
 * member" and "what is this room's `ChatMode`" — and both are reads.
 *
 * The word "reaction" here always means an emote on a message. It is unrelated
 * to the engine's `reaction.play` command, which shares the word and nothing
 * else.
 */
import type { ChatMessageKind, Emote } from "@office-ladder/contracts";
import type { PlayerId } from "@office-ladder/engine";
import type { RoomActorKind, StoredRoom } from "@/rooms/service/types";

/**
 * A stored chat line, exactly as `room_messages` holds it.
 *
 * `authorId`, `roomId` and `createdAt` are the moderation record: spec §8.1 asks
 * for enough to answer "who sent this, in which room, when" later without
 * committing to a moderation *system* now. They are stored because that question
 * cannot be answered retroactively — everything else about moderation can be
 * built later, but an unattributed message is unattributable forever.
 *
 * `authorId` is nullable because the schema reserves `system` messages, which
 * have no author. Nothing in this build writes one; the shape is honoured rather
 * than assumed away so a later system message does not have to change this type.
 */
export type ChatMessageRecord = {
  readonly id: string;
  readonly roomId: string;
  readonly authorId: PlayerId | null;
  readonly kind: ChatMessageKind;
  /** Free text for `text`, a `QuickChatPhraseId` for `quick`. */
  readonly body: string;
  /** ISO-8601 instant. */
  readonly createdAt: string;
};

export type ChatReactionRecord = {
  readonly messageId: string;
  readonly playerId: PlayerId;
  readonly emote: Emote;
  readonly createdAt: string;
};

/** One emote's tally on a message, as a viewer sees it. */
export type ChatReactionTally = {
  readonly emote: Emote;
  readonly count: number;
  /** Whether *this* viewer is one of the `count`. */
  readonly mine: boolean;
};

/**
 * A message as the history endpoint returns it.
 *
 * `authorName` is resolved from the room's own `memberNames` rather than stored
 * on the row: a display name can change, and a chat log that renders the name
 * held at send time would disagree with every other surface in the room.
 */
export type ChatMessageView = ChatMessageRecord & {
  readonly authorName: string | null;
  readonly reactions: readonly ChatReactionTally[];
};

export type ChatHistoryPage = {
  /** Oldest first, so a client can append without re-sorting. */
  readonly messages: readonly ChatMessageView[];
  /**
   * Pass back as `before` to fetch the page *older* than this one. `null` means
   * the page reached the start of the room's history.
   */
  readonly nextCursor: string | null;
};

export type InsertReactionResult = "inserted" | "duplicate" | "limit-reached";

/**
 * Persistence for chat. Deliberately narrow, and deliberately not the room
 * repository: chat rows have their own lifetime, their own tables and no
 * revision, so putting them behind `RoomRepository.save` would make every chat
 * line a room mutation with a revision predicate — which is exactly the coupling
 * §8.1 rules out.
 */
export interface ChatRepository {
  insertMessage(message: ChatMessageRecord): Promise<void>;
  getMessage(messageId: string): Promise<ChatMessageRecord | null>;
  /**
   * The newest `limit` messages in `roomId` strictly older than `before`
   * (newest first). `before` is resolved by the caller and passed as a record so
   * the implementation never has to trust a cursor it did not read.
   */
  listMessages(input: {
    readonly roomId: string;
    readonly before: ChatMessageRecord | null;
    readonly limit: number;
  }): Promise<readonly ChatMessageRecord[]>;
  listReactions(messageIds: readonly string[]): Promise<readonly ChatReactionRecord[]>;
  /**
   * Adds one emote. `maxPerPlayerPerMessage` is passed in rather than baked in so
   * both implementations enforce the identical cap — a cap that only the
   * in-memory one applied would be a cap that only tests can see.
   */
  insertReaction(
    reaction: ChatReactionRecord,
    maxPerPlayerPerMessage: number,
  ): Promise<InsertReactionResult>;
  /** Returns whether a row was actually removed, so un-reacting stays idempotent. */
  deleteReaction(input: {
    readonly messageId: string;
    readonly playerId: PlayerId;
    readonly emote: Emote;
  }): Promise<boolean>;
}

/**
 * Why a chat request can be refused.
 *
 * Every one of these is a *server* decision. None of them is inferable from the
 * request alone, which is the point: the client is not the authority on its own
 * membership, on the room's chat mode, or on how often it may post.
 */
export type ChatErrorCode =
  | "ROOM_NOT_FOUND"
  | "MESSAGE_NOT_FOUND"
  | "ACTOR_NOT_MEMBER"
  | "ACTOR_IS_BOT"
  | "ACTOR_NOT_BOT"
  /** `social.chat` is `off` in this room. */
  | "CHAT_DISABLED"
  /** `social.chat` is `quick`, or the actor is a bot: free text is refused. */
  | "CHAT_TEXT_NOT_ALLOWED"
  | "EMOTE_REACTIONS_DISABLED"
  /** This player already has this emote on this message. */
  | "EMOTE_ALREADY_APPLIED"
  /** This player already holds the maximum number of emotes on this message. */
  | "EMOTE_LIMIT_REACHED"
  /** The body's target does not name the message in the path. */
  | "EMOTE_TARGET_MISMATCH"
  /** The `before` cursor names no message, or one in another room. */
  | "INVALID_CURSOR"
  | "RATE_LIMITED";

export type ChatServiceResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: { readonly code: ChatErrorCode } };

export type ChatActorInput = {
  readonly roomId: string;
  readonly actorId: string;
  /**
   * Which authority produced `actorId` — a Better Auth session (`human`) or this
   * server's own bot driver (`bot`). Same meaning and same non-negotiable
   * crossing rule as {@link RoomActorKind}: a session may never act as a bot
   * seat, and the driver may never act for a human member. HTTP always passes
   * `human`; `bot` exists so a bot can send a quick phrase without a route.
   */
  readonly actorKind: RoomActorKind;
};

export type SendChatMessageInput = ChatActorInput & {
  /** The raw, unvalidated request body. Parsed *after* the actor is authorized. */
  readonly body: unknown;
};

export type ReactToChatMessageInput = ChatActorInput & {
  /** From the path. Authoritative — the body's `targetId` must agree with it. */
  readonly messageId: string;
  readonly body: unknown;
};

export type ChatHistoryInput = {
  readonly roomId: string;
  readonly viewerId: string;
  /** A message id; the page returned is strictly older than it. */
  readonly before: string | null;
  readonly limit: number;
};

export type ReactToChatMessageOutcome = {
  readonly messageId: string;
  readonly emote: Emote;
  readonly removed: boolean;
};

export interface ChatService {
  history(input: ChatHistoryInput): Promise<ChatServiceResult<ChatHistoryPage>>;
  send(input: SendChatMessageInput): Promise<ChatServiceResult<ChatMessageView>>;
  react(
    input: ReactToChatMessageInput,
  ): Promise<ChatServiceResult<ReactToChatMessageOutcome>>;
}

/** The room read chat needs. A one-method view of `RoomRepository`. */
export interface ChatRoomReader {
  get(roomId: string): Promise<StoredRoom | null>;
}
