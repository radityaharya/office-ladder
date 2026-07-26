/**
 * Chat and emote reactions (spec §8.1, §8.2).
 *
 * **Chat is not game state.** Nothing in this file appears in `GameState`, in any
 * projection derived from it, or in `ProjectionChangeArea`. It travels on
 * its own realtime message kinds and its own tables (`room_messages`,
 * `room_message_reactions`), and a chat line can be dropped, rate limited or
 * moderated away without a match's canonical state changing by one revision.
 * That separation is the whole design: a replay must produce the same game with
 * the chat log deleted.
 *
 * "Reaction" here means an emote on a feed event. It is unrelated to
 * `reaction.play` — same word, different feature, and the two are deliberately
 * named apart everywhere (`EmoteReaction…` versus `PlayReaction…`).
 */
import {
  ContractValidationError,
  parseOpaqueId,
  requireBoolean,
  requireBoundedText,
  requireEnum,
  requireExactKeys,
  requireIsoInstant,
  requireObject,
} from "./validate";

export const CHAT_MODES = ["off", "quick", "full"] as const;

export type ChatMode = (typeof CHAT_MODES)[number];

/**
 * `text` is free-typed and only legal in `full` chat. `quick` is one of
 * {@link QUICK_CHAT_PHRASES} and is legal in both `quick` and `full` — it is also
 * the only kind a bot can produce meaningfully, which is why `quick` mode exists.
 *
 * There is no `direct` kind and no `recipientIds` field anywhere in this file:
 * §8.1 rules DMs out of v1, so the transport has no shape that could carry one.
 */
export const CHAT_MESSAGE_KINDS = ["text", "quick"] as const;

export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

/**
 * The fixed phrase set for `quick` chat.
 *
 * Ids rather than sentences: the body that crosses the wire is
 * `chat.phrase.nice-move`, and the client owns the wording, so the same room can
 * be read in two languages and a bot can "speak" without generating text.
 */
export const QUICK_CHAT_PHRASES = [
  "chat.phrase.hello",
  "chat.phrase.good-luck",
  "chat.phrase.nice-move",
  "chat.phrase.ouch",
  "chat.phrase.thanks",
  "chat.phrase.sorry",
  "chat.phrase.deal",
  "chat.phrase.no-deal",
  "chat.phrase.thinking",
  "chat.phrase.your-turn",
  "chat.phrase.well-played",
  "chat.phrase.good-game",
] as const;

export type QuickChatPhraseId = (typeof QUICK_CHAT_PHRASES)[number];

export const EMOTES = [
  "emote.thumbs-up",
  "emote.thumbs-down",
  "emote.laugh",
  "emote.shock",
  "emote.sad",
  "emote.fire",
  "emote.clap",
  "emote.eyes",
] as const;

export type Emote = (typeof EMOTES)[number];

/**
 * What an emote can be attached to: a feed event, or a chat message.
 *
 * Not a player — an emote aimed at a person rather than at something they did is
 * a harassment primitive with no gameplay use.
 */
export const EMOTE_TARGET_KINDS = ["event", "message"] as const;

export type EmoteTargetKind = (typeof EMOTE_TARGET_KINDS)[number];

/**
 * Upper bound on a free-typed chat line, in code points.
 *
 * 280 is a deliberate "one thought" length. The cap is enforced here rather than
 * at the database column because the storage limit is a truncation and this is a
 * refusal: a chat line that arrives too long is a client bug or an abuse attempt,
 * and silently storing the first 280 characters of either is worse than a 400.
 */
export const CHAT_MESSAGE_MAX_LENGTH = 280;

export type SendMessageRequest = {
  readonly kind: ChatMessageKind;
  /**
   * For `kind: "text"`, the trimmed line. For `kind: "quick"`, a
   * {@link QuickChatPhraseId}. One field rather than two because a message has
   * exactly one body and the kind already says how to read it.
   */
  readonly body: string;
};

export type SendMessageOptions = {
  /**
   * The room's resolved `ModeRules.social.chat`.
   *
   * Required, not defaulted: the gate is the point of this parser, and a default
   * would mean a route that forgot to pass the mode still accepted chat in a room
   * that had it switched off.
   */
  readonly chatMode: ChatMode;
};

/**
 * Validates an outgoing chat message against the room's {@link ChatMode}.
 *
 * The gate is checked before the body, so a room with chat off produces the same
 * refusal for every message rather than leaking which bodies would have been
 * acceptable. Rate limiting is the server's (§8.1) — this only bounds a single
 * message.
 */
export function parseSendMessageRequest(
  value: unknown,
  options: SendMessageOptions,
): SendMessageRequest {
  if (options.chatMode === "off") {
    throw new ContractValidationError("sendMessage", "is not available in this room");
  }

  const input = requireObject(value, "sendMessage");
  requireExactKeys(input, ["kind", "body"], "sendMessage");

  const kind = requireEnum(
    input["kind"],
    CHAT_MESSAGE_KINDS,
    "kind",
    "a supported chat message kind",
  );

  if (kind === "quick") {
    return {
      kind,
      body: requireEnum(
        input["body"],
        QUICK_CHAT_PHRASES,
        "body",
        "a supported quick chat phrase",
      ),
    };
  }

  if (options.chatMode === "quick") {
    throw new ContractValidationError(
      "kind",
      "must be quick: this room allows only the fixed phrase set",
    );
  }

  return { kind, body: requireBoundedText(input["body"], "body", CHAT_MESSAGE_MAX_LENGTH) };
}

export type EmoteReactionRequest = {
  readonly targetKind: EmoteTargetKind;
  readonly targetId: string;
  readonly emote: Emote;
  /** `true` toggles the caller's own existing reaction off. */
  readonly removed: boolean;
};

export type EmoteReactionOptions = {
  /** The room's resolved `ModeRules.social.emoteReactions`. */
  readonly emoteReactionsEnabled: boolean;
};

export function parseEmoteReactionRequest(
  value: unknown,
  options: EmoteReactionOptions,
): EmoteReactionRequest {
  if (!options.emoteReactionsEnabled) {
    throw new ContractValidationError(
      "emoteReaction",
      "is not available in this room",
    );
  }

  const input = requireObject(value, "emoteReaction");
  requireExactKeys(input, ["targetKind", "targetId", "emote", "removed"], "emoteReaction");

  return {
    targetKind: requireEnum(
      input["targetKind"],
      EMOTE_TARGET_KINDS,
      "targetKind",
      "a supported emote target",
    ),
    targetId: parseOpaqueId(input["targetId"], "targetId"),
    emote: requireEnum(input["emote"], EMOTES, "emote", "a supported emote"),
    removed: requireBoolean(input["removed"], "removed"),
  };
}

/**
 * The realtime payload for a posted chat message.
 *
 * Unlike `ProjectionUpdated`, this carries its own content rather than an
 * invalidation: there is no canonical state to re-fetch, so a message that is not
 * in the payload is a message the recipient never sees. `messageId` doubles as the
 * dedupe key across a reconnect.
 */
export type ChatMessagePosted = {
  readonly kind: "chat-message-posted";
  readonly messageId: string;
  readonly roomId: string;
  readonly authorId: string;
  readonly messageKind: ChatMessageKind;
  readonly body: string;
  readonly createdAt: string;
};

export type EmoteReactionPosted = {
  readonly kind: "emote-reaction-posted";
  /** Envelope id, for dedupe. Not the id of the thing being reacted to. */
  readonly messageId: string;
  readonly roomId: string;
  readonly actorId: string;
  readonly targetKind: EmoteTargetKind;
  readonly targetId: string;
  readonly emote: Emote;
  readonly removed: boolean;
  readonly createdAt: string;
};

export function parseChatMessagePosted(value: unknown): ChatMessagePosted {
  const input = requireObject(value, "chatMessagePosted");
  requireExactKeys(
    input,
    ["kind", "messageId", "roomId", "authorId", "messageKind", "body", "createdAt"],
    "chatMessagePosted",
  );
  if (input["kind"] !== "chat-message-posted") {
    throw new ContractValidationError("kind", "must be chat-message-posted");
  }

  const messageKind = requireEnum(
    input["messageKind"],
    CHAT_MESSAGE_KINDS,
    "messageKind",
    "a supported chat message kind",
  );

  return {
    kind: "chat-message-posted",
    messageId: parseOpaqueId(input["messageId"], "messageId"),
    roomId: parseOpaqueId(input["roomId"], "roomId"),
    authorId: parseOpaqueId(input["authorId"], "authorId"),
    messageKind,
    body:
      messageKind === "quick"
        ? requireEnum(
            input["body"],
            QUICK_CHAT_PHRASES,
            "body",
            "a supported quick chat phrase",
          )
        : requireBoundedText(input["body"], "body", CHAT_MESSAGE_MAX_LENGTH),
    createdAt: requireIsoInstant(input["createdAt"], "createdAt"),
  };
}

export function parseEmoteReactionPosted(value: unknown): EmoteReactionPosted {
  const input = requireObject(value, "emoteReactionPosted");
  requireExactKeys(
    input,
    [
      "kind",
      "messageId",
      "roomId",
      "actorId",
      "targetKind",
      "targetId",
      "emote",
      "removed",
      "createdAt",
    ],
    "emoteReactionPosted",
  );
  if (input["kind"] !== "emote-reaction-posted") {
    throw new ContractValidationError("kind", "must be emote-reaction-posted");
  }

  return {
    kind: "emote-reaction-posted",
    messageId: parseOpaqueId(input["messageId"], "messageId"),
    roomId: parseOpaqueId(input["roomId"], "roomId"),
    actorId: parseOpaqueId(input["actorId"], "actorId"),
    targetKind: requireEnum(
      input["targetKind"],
      EMOTE_TARGET_KINDS,
      "targetKind",
      "a supported emote target",
    ),
    targetId: parseOpaqueId(input["targetId"], "targetId"),
    emote: requireEnum(input["emote"], EMOTES, "emote", "a supported emote"),
    removed: requireBoolean(input["removed"], "removed"),
    createdAt: requireIsoInstant(input["createdAt"], "createdAt"),
  };
}
