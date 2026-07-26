/**
 * Room chat, client side (spec §8.1, §11.2, §11.3).
 *
 * The server half of chat has been complete for a wave — three routes, two
 * tables, a rate limiter, a `ChatMode` gate and a WebSocket fan-out — and the
 * browser called none of it. This module is that missing half, and it is
 * deliberately the ONLY place in the client that knows chat's wire shapes:
 * `chat-panel.tsx` renders what this returns and never builds a URL or reads a
 * status code.
 *
 * **Chat is not game state.** Nothing here touches the projection, the command
 * endpoint, `expectedRevision` or a `commandId`. A dropped chat line is a line
 * somebody never sees, not a divergent game — which is exactly why the realtime
 * frames carry their own content instead of an invalidation, and why this module
 * keeps its own local feed state rather than re-deriving one from a bootstrap.
 *
 * Three properties are worth stating because each answers a real failure mode:
 *
 * 1. **Refusals are values, not exceptions with prose.** Every non-2xx answer
 *    becomes a {@link ChatTransportError} carrying the server's own code, and
 *    {@link chatRefusalMessage} is the single place that turns a code into a
 *    sentence a player reads. A destination that silently shows nothing after a
 *    refusal is the bug this replaces.
 * 2. **`ChatMode` is discoverable from a refusal.** `RoomProjection` does not
 *    (yet) carry the room's resolved `ModeRules`, so the client cannot always
 *    know up front whether a table is `full`, `quick` or `off`. The server tells
 *    it: `CHAT_DISABLED` means `off` and `CHAT_TEXT_NOT_ALLOWED` means `quick`.
 *    {@link effectiveChatMode} folds that answer into the configured mode, so
 *    all three of §4.1's states are real today rather than after a contract
 *    change.
 * 3. **Applying a reaction frame is idempotent AND re-toggleable.** Emote
 *    envelopes are keyed `messageId:playerId:emote`, so a dedupe-by-id ledger
 *    would drop a legitimate un-react-then-re-react. The ledger here records the
 *    last `removed` value per (message, actor, emote) instead: a duplicate frame
 *    agrees with it and is skipped, a genuine toggle disagrees and applies.
 *
 * Everything except {@link subscribeRoomChat} and the three `fetch` wrappers is a
 * pure function of its arguments, which is what makes the feed testable in a
 * bare Node process with no DOM.
 */
import {
  CHAT_MESSAGE_MAX_LENGTH,
  ContractValidationError,
  EMOTES,
  parseOpaqueId,
  parseRealtimeMessage,
  type ChatMessageKind,
  type ChatMessagePosted,
  type ChatMode,
  type Emote,
  type EmoteReactionPosted,
} from "@office-ladder/contracts";

/* -------------------------------------------------------------------------- */
/* Refusals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every code a chat request can come back with.
 *
 * The first thirteen are `ChatErrorCode` in
 * `apps/server/src/rooms/chat/types.ts`; the next four are the shared HTTP
 * refusals any authenticated route can produce; the last three are this client's
 * own, for the cases that never reach the server or come back unreadable.
 *
 * Listed rather than widened to `string` so {@link chatRefusalMessage} is
 * exhaustive: a code the server adds and this client cannot phrase becomes a
 * type error here instead of an empty error line in the panel.
 */
export const CHAT_REFUSAL_CODES = [
  "ROOM_NOT_FOUND",
  "MESSAGE_NOT_FOUND",
  "ACTOR_NOT_MEMBER",
  "ACTOR_IS_BOT",
  "ACTOR_NOT_BOT",
  "CHAT_DISABLED",
  "CHAT_TEXT_NOT_ALLOWED",
  "EMOTE_REACTIONS_DISABLED",
  "EMOTE_ALREADY_APPLIED",
  "EMOTE_LIMIT_REACHED",
  "EMOTE_TARGET_MISMATCH",
  "INVALID_CURSOR",
  "RATE_LIMITED",
  "INVALID_REQUEST",
  "INVALID_JSON",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INTERNAL_SERVER_ERROR",
  /** The request never left the browser, or the connection dropped mid-flight. */
  "NETWORK",
  /** A 2xx whose body this client could not read as chat. */
  "MALFORMED_RESPONSE",
  /** A refusal with no code, or one this build does not know. */
  "UNKNOWN",
] as const;

export type ChatRefusalCode = (typeof CHAT_REFUSAL_CODES)[number];

export function isChatRefusalCode(value: unknown): value is ChatRefusalCode {
  return typeof value === "string" && (CHAT_REFUSAL_CODES as readonly string[]).includes(value);
}

/**
 * A chat request that was refused, with the server's own code preserved.
 *
 * `status` is kept alongside the code because the two answer different
 * questions: the code says what to tell the player, the status says whether the
 * request is worth retrying. Neither is ever rendered raw.
 */
export class ChatTransportError extends Error {
  readonly name = "ChatTransportError";

  constructor(
    readonly code: ChatRefusalCode,
    readonly status: number,
  ) {
    super(`Chat request refused: ${code} (${status})`);
  }
}

/**
 * The one place a refusal code becomes a sentence.
 *
 * Written in the game's own dry register and always stating the *rule* rather
 * than the mechanism, because the player cannot act on "403". A rate limit says
 * how to recover; a mode gate says the table decided this, not the server.
 */
export function chatRefusalMessage(code: ChatRefusalCode): string {
  switch (code) {
    case "CHAT_DISABLED":
      return "This table has chat switched off, so nothing you send would reach anyone.";
    case "CHAT_TEXT_NOT_ALLOWED":
      return "This table is on quick chat: pick a phrase instead of typing.";
    case "RATE_LIMITED":
      return "You are sending messages too quickly. Wait a few seconds and try again.";
    case "EMOTE_REACTIONS_DISABLED":
      return "Emote reactions are switched off at this table.";
    case "EMOTE_ALREADY_APPLIED":
      return "You have already reacted to that message with this emote.";
    case "EMOTE_LIMIT_REACHED":
      return "One emote per message. Clear the one you have before adding another.";
    case "EMOTE_TARGET_MISMATCH":
      return "That reaction named a different message. Nothing was recorded.";
    case "MESSAGE_NOT_FOUND":
      return "That message is no longer in this room's history.";
    case "INVALID_CURSOR":
      return "The older-messages cursor no longer resolves. Reopen chat to reload the log.";
    case "ACTOR_NOT_MEMBER":
      return "You are not a member of this room, so its chat is not readable.";
    case "ACTOR_IS_BOT":
    case "ACTOR_NOT_BOT":
      return "That seat is not yours to speak from.";
    case "ROOM_NOT_FOUND":
      return "This room no longer exists.";
    case "UNAUTHORIZED":
      return "Your session expired. Sign in again to keep talking.";
    case "FORBIDDEN":
      return "That request was refused before it reached the room.";
    case "NETWORK":
      return "The server could not be reached. Chat will reconnect on its own.";
    case "INVALID_JSON":
    case "INVALID_REQUEST":
      return "That message was rejected as malformed. Nothing was sent.";
    case "MALFORMED_RESPONSE":
      return "The server answered with a chat log this client cannot read.";
    case "INTERNAL_SERVER_ERROR":
    case "UNKNOWN":
      return "Chat is not answering right now. Nothing you send is being stored.";
  }
}

/**
 * Whether a refusal means the player cannot compose at all right now.
 *
 * The distinction is not cosmetic. A blocking refusal disables the composer and
 * says why; a non-blocking one is stated and leaves every control live. Getting
 * this backwards produces either a dead field with no explanation (the bug this
 * wave is fixing) or a greyed-out panel because one emote was refused.
 *
 * `CHAT_TEXT_NOT_ALLOWED` is deliberately NOT blocking: it means the table is on
 * quick chat, where the phrase set still works. It narrows the mode — see
 * {@link effectiveChatMode} — rather than closing the surface.
 */
export function chatRefusalBlocksComposer(code: ChatRefusalCode): boolean {
  switch (code) {
    case "CHAT_DISABLED":
    case "RATE_LIMITED":
    case "ACTOR_NOT_MEMBER":
    case "ACTOR_IS_BOT":
    case "ACTOR_NOT_BOT":
    case "ROOM_NOT_FOUND":
    case "UNAUTHORIZED":
    case "FORBIDDEN":
    case "NETWORK":
    case "INTERNAL_SERVER_ERROR":
    case "UNKNOWN":
      return true;
    case "CHAT_TEXT_NOT_ALLOWED":
    case "EMOTE_REACTIONS_DISABLED":
    case "EMOTE_ALREADY_APPLIED":
    case "EMOTE_LIMIT_REACHED":
    case "EMOTE_TARGET_MISMATCH":
    case "MESSAGE_NOT_FOUND":
    case "INVALID_CURSOR":
    case "INVALID_REQUEST":
    case "INVALID_JSON":
    case "MALFORMED_RESPONSE":
      return false;
  }
}

/**
 * The server's message rate-limit window (`CHAT_MESSAGE_RATE_LIMIT.windowMs`),
 * mirrored so a client that hit the ceiling recovers on its own.
 *
 * Mirrored rather than imported because it is a server-side constant in
 * `apps/server`, which the browser bundle must not reach into. Drifting low means
 * the player retries into another 429 — annoying but self-correcting; drifting
 * high means a composer disabled longer than necessary. A blocked composer that
 * only a page reload clears is the outcome neither is allowed to become.
 */
export const RATE_LIMIT_COOLDOWN_MS = 10_000;

/**
 * The cap on a free-typed line, re-exported so no client surface restates it.
 *
 * A local copy that drifted below the server's would truncate a line silently;
 * one above it would produce a 400 the player could not see coming.
 */
export const CHAT_TEXT_MAX_LENGTH: number = CHAT_MESSAGE_MAX_LENGTH;

/**
 * The mode a refusal PROVES the room is in, or `null` when it says nothing about
 * the mode.
 *
 * `CHAT_DISABLED` and `CHAT_TEXT_NOT_ALLOWED` are the only two codes that are
 * statements about the room's ruleset rather than about one request, and the
 * server produces them from `resolveSocialRules`. Reading them is what lets the
 * panel show a real `off` or `quick` surface without `RoomProjection` carrying
 * `ModeRules` yet.
 */
export function chatModeFromRefusal(code: ChatRefusalCode): ChatMode | null {
  if (code === "CHAT_DISABLED") return "off";
  if (code === "CHAT_TEXT_NOT_ALLOWED") return "quick";
  return null;
}

/**
 * Folds a new refusal into the one the client is using to narrow the mode.
 *
 * Kept pure and here rather than inline in the hook because it is the rule that
 * decides whether a composer re-opens: a refusal that says nothing about the
 * ruleset must not displace one that did, and `off` outranks `quick` whichever
 * order the two arrive in.
 */
export function narrowestModeRefusal(
  current: ChatRefusalCode | null,
  incoming: ChatRefusalCode,
): ChatRefusalCode | null {
  if (chatModeFromRefusal(incoming) === null) return current;
  if (current === "CHAT_DISABLED") return current;
  return incoming;
}

/**
 * The mode to render: the configured one, narrowed by anything the server has
 * since refused.
 *
 * Only ever narrows. A room configured `quick` never becomes `full` because a
 * request happened to succeed — the client is not the authority on the ruleset,
 * it is only allowed to believe a refusal.
 */
export function effectiveChatMode(
  configured: ChatMode,
  refusal: ChatRefusalCode | null,
): ChatMode {
  if (refusal === null) return configured;
  const proven = chatModeFromRefusal(refusal);
  if (proven === null || configured === "off") return configured;
  if (proven === "off") return "off";
  return "quick";
}

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

/** One emote's tally on a message, as this viewer sees it. */
export type ChatReactionTally = {
  readonly emote: Emote;
  readonly count: number;
  /** Whether the viewer is one of the `count`. */
  readonly mine: boolean;
};

/**
 * A chat line as the client holds it.
 *
 * `authorName` is whatever the server resolved from the room's member names at
 * read time and is `null` on a realtime frame, which carries only ids. The panel
 * therefore resolves names from the roster it is given first and treats this as
 * the fallback — a name is presentation, and the roster is the surface that
 * already agrees with the board and the seat glyphs.
 */
export type ChatMessage = {
  readonly id: string;
  readonly roomId: string;
  /** `null` for an authorless system line. Nothing writes one yet. */
  readonly authorId: string | null;
  readonly kind: ChatMessageKind;
  /** Free text for `text`; a `QuickChatPhraseId` for `quick`. */
  readonly body: string;
  readonly createdAt: string;
  readonly authorName: string | null;
  readonly reactions: readonly ChatReactionTally[];
};

export type ChatHistoryPage = {
  /** Oldest first, as the server sends it. */
  readonly messages: readonly ChatMessage[];
  /** Pass back as `before` for the page older than this one; `null` at the start. */
  readonly nextCursor: string | null;
};

export type ChatReactionOutcome = {
  readonly messageId: string;
  readonly emote: Emote;
  readonly removed: boolean;
};

export type SendChatMessageRequest = {
  readonly kind: ChatMessageKind;
  readonly body: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(status: number): ChatTransportError {
  return new ChatTransportError("MALFORMED_RESPONSE", status);
}

function requireString(value: unknown, status: number): string {
  if (typeof value !== "string" || value.length === 0) throw malformed(status);
  return value;
}

/**
 * Exported because the panel takes an emote id from a click handler typed as a
 * plain string and must not post one the contract does not know: the server would
 * refuse it, and a refusal the client could have prevented is a refusal the player
 * should never see.
 */
export function isEmote(value: unknown): value is Emote {
  return typeof value === "string" && (EMOTES as readonly string[]).includes(value);
}

/**
 * Reactions are parsed leniently — an unreadable tally is dropped, not fatal.
 *
 * The asymmetry with the message body is deliberate: a message this client
 * cannot read is a message it would render wrong, whereas an emote it does not
 * know is a count it can simply not draw. Failing the whole page over a future
 * emote id would take the conversation down with it.
 */
function parseTallies(value: unknown, status: number): readonly ChatReactionTally[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw malformed(status);

  const tallies: ChatReactionTally[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isEmote(entry["emote"])) continue;
    const count = entry["count"];
    if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
    tallies.push({
      emote: entry["emote"],
      count: Math.trunc(count),
      mine: entry["mine"] === true,
    });
  }

  return tallies;
}

function parseMessage(value: unknown, status: number): ChatMessage {
  if (!isRecord(value)) throw malformed(status);

  const kind = value["kind"];
  if (kind !== "text" && kind !== "quick") throw malformed(status);

  const body = value["body"];
  // The cap is mirrored from contracts rather than re-derived: a body longer than
  // the server's own limit means this is not the payload it claims to be.
  if (typeof body !== "string" || body.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw malformed(status);
  }

  const authorId = value["authorId"];
  if (authorId !== null && typeof authorId !== "string") throw malformed(status);

  const authorName = value["authorName"];
  if (authorName !== undefined && authorName !== null && typeof authorName !== "string") {
    throw malformed(status);
  }

  return {
    id: requireString(value["id"], status),
    roomId: requireString(value["roomId"], status),
    authorId: authorId === null || authorId.length === 0 ? null : authorId,
    kind,
    body,
    createdAt: requireString(value["createdAt"], status),
    authorName: authorName === undefined || authorName === null ? null : authorName,
    reactions: parseTallies(value["reactions"], status),
  };
}

export function parseChatHistoryPage(payload: unknown, status = 200): ChatHistoryPage {
  if (!isRecord(payload) || !Array.isArray(payload["messages"])) throw malformed(status);

  const nextCursor = payload["nextCursor"];
  if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== "string") {
    throw malformed(status);
  }

  return {
    messages: payload["messages"].map((message) => parseMessage(message, status)),
    nextCursor: typeof nextCursor === "string" && nextCursor.length > 0 ? nextCursor : null,
  };
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Client page size.
 *
 * Matches the server's `DEFAULT_CHAT_HISTORY_LIMIT` and stays well under its
 * `MAX_CHAT_HISTORY_LIMIT` of 50. Sent explicitly rather than left to the
 * default so the "did the page come back full" question the server answers with
 * `nextCursor` is asked against a number this client chose.
 */
export const CHAT_HISTORY_PAGE_SIZE = 30;

export function chatHistoryPath(
  roomId: string,
  options: { readonly before?: string | null; readonly limit?: number } = {},
): string {
  const query = new URLSearchParams();
  if (options.before !== undefined && options.before !== null && options.before !== "") {
    query.set("before", options.before);
  }
  query.set("limit", String(options.limit ?? CHAT_HISTORY_PAGE_SIZE));

  return `/api/rooms/${encodeURIComponent(roomId)}/messages?${query.toString()}`;
}

export function chatMessagesPath(roomId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/messages`;
}

export function chatReactionsPath(roomId: string, messageId: string): string {
  return `/api/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/reactions`;
}

/**
 * Turns any non-2xx into a {@link ChatTransportError} carrying the server's code.
 *
 * A refusal with an unreadable body still has to become a refusal — the status
 * alone is enough to know the request failed, and `UNKNOWN` has a sentence.
 */
async function refusalFrom(response: Response): Promise<ChatTransportError> {
  let code: ChatRefusalCode = "UNKNOWN";
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord(payload["error"])) {
      const value = payload["error"]["code"];
      if (isChatRefusalCode(value)) code = value;
    }
  } catch {
    // A body-less or non-JSON refusal is still a refusal.
  }

  return new ChatTransportError(code, response.status);
}

/**
 * `fetch`, with a network failure normalized into the same error type as a
 * refusal. Callers then have exactly one thing to catch, which is what keeps the
 * hook's error handling from growing a second shape per call site.
 */
async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof TypeError) throw new ChatTransportError("NETWORK", 0);
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw error;
  }
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

export async function fetchChatHistory(
  roomId: string,
  options: {
    readonly before?: string | null;
    readonly limit?: number;
    readonly signal?: AbortSignal;
  } = {},
): Promise<ChatHistoryPage> {
  const response = await request(chatHistoryPath(roomId, options), {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: options.signal,
  });
  if (!response.ok) throw await refusalFrom(response);

  return parseChatHistoryPage(await response.json(), response.status);
}

export async function sendChatMessage(
  roomId: string,
  message: SendChatMessageRequest,
): Promise<ChatMessage> {
  const response = await request(chatMessagesPath(roomId), {
    body: JSON.stringify(message),
    headers: JSON_HEADERS,
    method: "POST",
  });
  if (!response.ok) throw await refusalFrom(response);

  const payload: unknown = await response.json();
  if (!isRecord(payload)) throw malformed(response.status);

  return parseMessage(payload["message"], response.status);
}

/**
 * Adds or clears one emote on one message.
 *
 * `targetKind` is always `"message"` and `targetId` always repeats the path's
 * message id, because the server refuses any disagreement between the two
 * (`EMOTE_TARGET_MISMATCH`) and `targetKind: "event"` has no endpoint in v1.
 * Neither is a caller's choice, so neither is a parameter.
 */
export async function reactToChatMessage(
  roomId: string,
  input: {
    readonly messageId: string;
    readonly emote: Emote;
    readonly removed: boolean;
  },
): Promise<ChatReactionOutcome> {
  const response = await request(chatReactionsPath(roomId, input.messageId), {
    body: JSON.stringify({
      emote: input.emote,
      removed: input.removed,
      targetId: input.messageId,
      targetKind: "message",
    }),
    headers: JSON_HEADERS,
    method: "POST",
  });
  if (!response.ok) throw await refusalFrom(response);

  const payload: unknown = await response.json();
  if (!isRecord(payload) || !isRecord(payload["reaction"])) throw malformed(response.status);
  const reaction = payload["reaction"];
  if (!isEmote(reaction["emote"])) throw malformed(response.status);

  return {
    messageId: requireString(reaction["messageId"], response.status),
    emote: reaction["emote"],
    removed: reaction["removed"] === true,
  };
}

/* -------------------------------------------------------------------------- */
/* Realtime                                                                   */
/* -------------------------------------------------------------------------- */

const OPAQUE_ROOM_TOPIC_PATTERN = /^(?![A-Z0-9]{6}$)[A-Za-z0-9_-]{1,128}$/;

const RECONNECT_DELAY_MS = 1500;

export type ChatChannelHandlers = {
  readonly onMessage?: (message: ChatMessagePosted) => void;
  readonly onReaction?: (reaction: EmoteReactionPosted) => void;
};

export type ChatChannelCleanup = () => Promise<void>;

function socketUrl(roomTopic: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/rooms/${roomTopic}`;
}

/**
 * Subscribes to a room's chat frames.
 *
 * Same idiom as `subscribeRoomUpdates` in `room-channel.ts` on purpose — same
 * topic validation, same 1.5s reconnect, same "a `ContractValidationError` is a
 * frame we drop, anything else is a bug we rethrow", same async cleanup — so a
 * reader of one understands the other. It is deliberately a SECOND subscription
 * rather than an extension of that one: `room-channel.ts` belongs to the
 * projection loop and is another owner's file this wave, and the two callbacks
 * have unrelated payload semantics (an invalidation versus content).
 *
 * The server pushes every kind on one topic, so this does open a second socket
 * per player. That is a known cost, not a design: collapsing the two into one
 * multiplexed `subscribeRoom` is a small follow-up and is reported as such.
 *
 * `projection-updated` frames are ignored here — they are the projection loop's
 * business, and reacting to them would make chat re-fetch on every dice roll.
 */
export function subscribeRoomChat(
  roomTopic: string,
  handlers: ChatChannelHandlers,
): ChatChannelCleanup {
  const opaqueRoomTopic = parseOpaqueId(roomTopic, "roomTopic");
  if (!OPAQUE_ROOM_TOPIC_PATTERN.test(opaqueRoomTopic)) {
    throw new ContractValidationError(
      "roomTopic",
      "must be an opaque Realtime topic, not a room code",
    );
  }

  let closedByCaller = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    socket = new WebSocket(socketUrl(opaqueRoomTopic));

    socket.addEventListener("message", (event) => {
      try {
        const payload: unknown = JSON.parse(String(event.data));
        const frame = parseRealtimeMessage(payload);
        if (frame.kind === "chat-message-posted") {
          handlers.onMessage?.(frame);
          return;
        }
        if (frame.kind === "emote-reaction-posted") {
          handlers.onReaction?.(frame);
        }
      } catch (error) {
        // A frame this build cannot read is dropped; the history endpoint is
        // always able to recover the conversation on the next open.
        if (!(error instanceof ContractValidationError) && !(error instanceof SyntaxError)) {
          throw error;
        }
      }
    });

    socket.addEventListener("close", () => {
      if (closedByCaller) return;
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });
  }

  connect();

  return async () => {
    closedByCaller = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
    }
    socket?.close();
  };
}

/* -------------------------------------------------------------------------- */
/* Feed state                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The conversation as the client holds it, plus the two ledgers that make
 * applying an out-of-order or repeated frame safe.
 *
 * A plain immutable value with no React in sight: every transition below is a
 * pure function, so the whole merge/dedupe/toggle behaviour is unit-testable
 * without a render, and the hook that owns it in `chat-panel.tsx` is reduced to
 * wiring.
 */
export type ChatFeed = {
  /** Oldest first — a conversation reads down the page. */
  readonly messages: readonly ChatMessage[];
  /** Cursor for the page older than the oldest one held, or `null` at the start. */
  readonly olderCursor: string | null;
  /** Whether a history page has ever landed. Distinguishes "empty" from "not read". */
  readonly loaded: boolean;
  /**
   * Last applied `removed` value per `messageId|actorId|emote`.
   *
   * See the module note: emote envelope ids repeat across a re-react, so this
   * records the STATE a frame asserted rather than the fact that some frame with
   * that id arrived.
   */
  readonly appliedReactions: ReadonlyMap<string, boolean>;
};

export const EMPTY_CHAT_FEED: ChatFeed = {
  messages: [],
  olderCursor: null,
  loaded: false,
  appliedReactions: new Map(),
};

/**
 * Oldest first, ties broken by id.
 *
 * `createdAt` is an ISO-8601 instant, so lexical order is chronological order,
 * and two messages committed in the same millisecond still land in one stable
 * order on every client rather than in per-client arrival order.
 */
function byCreatedAt(left: ChatMessage, right: ChatMessage): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Merges one message in, preferring facts already held — or reports that there
 * was nothing to gain.
 *
 * A realtime frame carries no `authorName` and no tallies, and it can arrive
 * before or after the history page holding the same row. Keeping the richer value
 * means the arrival order can never blank a name or wipe the reactions a message
 * already had.
 *
 * Returning `null` for "no change" rather than a merged copy is what keeps a
 * repeated frame free: two empty `reactions` arrays are equal and not identical,
 * so a copy-then-compare would churn a new object — and therefore a new feed, and
 * therefore a re-render — on every duplicate delivery.
 */
function mergeMessage(existing: ChatMessage, incoming: ChatMessage): ChatMessage | null {
  const gainsName = existing.authorName === null && incoming.authorName !== null;
  const gainsReactions = existing.reactions.length === 0 && incoming.reactions.length > 0;
  if (!gainsName && !gainsReactions) return null;

  return {
    ...existing,
    authorName: gainsName ? incoming.authorName : existing.authorName,
    reactions: gainsReactions ? incoming.reactions : existing.reactions,
  };
}

function withMessages(feed: ChatFeed, messages: readonly ChatMessage[]): ChatFeed {
  return { ...feed, messages };
}

/**
 * Folds a batch of messages into the feed, de-duplicated by id.
 *
 * Returns the SAME feed object when nothing changed, so a repeated realtime
 * frame or a re-fetch of an unchanged page costs no re-render.
 */
export function receiveChatMessages(
  feed: ChatFeed,
  incoming: readonly ChatMessage[],
): ChatFeed {
  if (incoming.length === 0) return feed;

  const byId = new Map(feed.messages.map((message) => [message.id, message]));
  let changed = false;
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (existing === undefined) {
      byId.set(message.id, message);
      changed = true;
      continue;
    }

    const merged = mergeMessage(existing, message);
    if (merged !== null) {
      byId.set(message.id, merged);
      changed = true;
    }
  }
  if (!changed) return feed;

  return withMessages(feed, [...byId.values()].sort(byCreatedAt));
}

/**
 * Folds a history page in and adopts its cursor.
 *
 * Every page this client asks for is either the newest one or a strictly older
 * one, and both answer the same question — "what is the cursor for the page
 * older than everything I now hold" — so the incoming `nextCursor` always wins.
 */
export function receiveChatHistoryPage(feed: ChatFeed, page: ChatHistoryPage): ChatFeed {
  const merged = receiveChatMessages(feed, page.messages);
  return { ...merged, olderCursor: page.nextCursor, loaded: true };
}

/** Converts a realtime frame into a feed row. Ids only — the name comes later. */
export function chatMessageFromFrame(frame: ChatMessagePosted): ChatMessage {
  return {
    id: frame.messageId,
    roomId: frame.roomId,
    authorId: frame.authorId,
    kind: frame.messageKind,
    body: frame.body,
    createdAt: frame.createdAt,
    authorName: null,
    reactions: [],
  };
}

export function receiveChatMessage(feed: ChatFeed, frame: ChatMessagePosted): ChatFeed {
  return receiveChatMessages(feed, [chatMessageFromFrame(frame)]);
}

function reactionKey(messageId: string, actorId: string, emote: Emote): string {
  // Unit separator: none of the three parts can contain it, so the key cannot be
  // forged by an id that happens to contain the delimiter.
  return `${messageId}\u001f${actorId}\u001f${emote}`;
}

function applyTally(
  tallies: readonly ChatReactionTally[],
  input: { readonly emote: Emote; readonly removed: boolean; readonly isSelf: boolean },
): readonly ChatReactionTally[] {
  const held = tallies.find((tally) => tally.emote === input.emote);
  if (held === undefined) {
    // Removing something this viewer never saw is a no-op rather than a negative
    // count: the frame is authoritative about the change, not about the total.
    if (input.removed) return tallies;
    return [...tallies, { emote: input.emote, count: 1, mine: input.isSelf }];
  }

  const count = input.removed ? held.count - 1 : held.count + 1;
  if (count <= 0) return tallies.filter((tally) => tally.emote !== input.emote);

  return tallies.map((tally) =>
    tally.emote === input.emote
      ? { emote: tally.emote, count, mine: input.isSelf ? !input.removed : tally.mine }
      : tally,
  );
}

/**
 * Applies one emote change, idempotently and re-toggleably.
 *
 * Skipped when the ledger already records this exact (message, actor, emote) in
 * this exact state — which is what makes a duplicated frame free, and what lets
 * the panel apply its own click optimistically and then ignore the server's echo
 * of it without double-counting.
 *
 * A frame for a message this client has not loaded is dropped WITHOUT recording,
 * so it applies correctly if that page is paged in later.
 */
export function applyChatReaction(
  feed: ChatFeed,
  input: {
    readonly messageId: string;
    readonly actorId: string;
    readonly emote: Emote;
    readonly removed: boolean;
    readonly selfPlayerId: string | null;
  },
): ChatFeed {
  const key = reactionKey(input.messageId, input.actorId, input.emote);
  if (feed.appliedReactions.get(key) === input.removed) return feed;

  const index = feed.messages.findIndex((message) => message.id === input.messageId);
  if (index === -1) return feed;

  const target = feed.messages[index];
  const reactions = applyTally(target.reactions, {
    emote: input.emote,
    removed: input.removed,
    isSelf: input.actorId === input.selfPlayerId,
  });
  const appliedReactions = new Map(feed.appliedReactions);
  appliedReactions.set(key, input.removed);

  const messages = [...feed.messages];
  messages[index] = { ...target, reactions };

  return { ...feed, messages, appliedReactions };
}

/** The realtime-frame form of {@link applyChatReaction}. */
export function receiveChatReaction(
  feed: ChatFeed,
  frame: EmoteReactionPosted,
  selfPlayerId: string | null,
): ChatFeed {
  // `targetKind: "event"` has no endpoint and no row to hang off in v1; a frame
  // claiming one is not about a message in this list.
  if (frame.targetKind !== "message") return feed;

  return applyChatReaction(feed, {
    messageId: frame.targetId,
    actorId: frame.actorId,
    emote: frame.emote,
    removed: frame.removed,
    selfPlayerId,
  });
}

/** Whether the viewer already holds an emote on this message. */
export function ownEmoteOn(message: ChatMessage): Emote | null {
  return message.reactions.find((tally) => tally.mine)?.emote ?? null;
}
