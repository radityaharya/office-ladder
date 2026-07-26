import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHAT_MESSAGE_MAX_LENGTH,
  type ChatMessagePosted,
  type EmoteReactionPosted,
} from "@office-ladder/contracts";

import {
  applyChatReaction,
  CHAT_REFUSAL_CODES,
  CHAT_TEXT_MAX_LENGTH,
  chatHistoryPath,
  chatModeFromRefusal,
  chatReactionsPath,
  chatRefusalBlocksComposer,
  chatRefusalMessage,
  ChatTransportError,
  effectiveChatMode,
  EMPTY_CHAT_FEED,
  fetchChatHistory,
  isEmote,
  narrowestModeRefusal,
  ownEmoteOn,
  parseChatHistoryPage,
  reactToChatMessage,
  receiveChatHistoryPage,
  receiveChatMessage,
  receiveChatMessages,
  receiveChatReaction,
  sendChatMessage,
  type ChatMessage,
} from "./chat-channel";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const AVERY = "player-avery";
const MORGAN = "player-morgan";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "message-1",
    roomId: "room-1",
    authorId: MORGAN,
    kind: "text",
    body: "Fund my project and I will leave your tiles alone.",
    createdAt: "2026-07-26T09:41:07.000Z",
    authorName: "Morgan",
    reactions: [],
    ...overrides,
  };
}

function wireMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "message-1",
    roomId: "room-1",
    authorId: MORGAN,
    kind: "text",
    body: "Fund my project.",
    createdAt: "2026-07-26T09:41:07.000Z",
    authorName: "Morgan",
    reactions: [],
    ...overrides,
  };
}

function postedFrame(overrides: Partial<ChatMessagePosted> = {}): ChatMessagePosted {
  return {
    kind: "chat-message-posted",
    messageId: "message-1",
    roomId: "room-1",
    authorId: MORGAN,
    messageKind: "text",
    body: "Fund my project.",
    createdAt: "2026-07-26T09:41:07.000Z",
    ...overrides,
  };
}

function reactionFrame(overrides: Partial<EmoteReactionPosted> = {}): EmoteReactionPosted {
  return {
    kind: "emote-reaction-posted",
    messageId: "message-1:player-morgan:emote.fire",
    roomId: "room-1",
    actorId: MORGAN,
    targetKind: "message",
    targetId: "message-1",
    emote: "emote.fire",
    removed: false,
    createdAt: "2026-07-26T09:41:20.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* URLs                                                                       */
/* -------------------------------------------------------------------------- */

describe("endpoint paths", () => {
  it("asks for a bounded page and omits an absent cursor", () => {
    // When
    const path = chatHistoryPath("room-1");

    // Then — the limit is always sent: `nextCursor` only means "there is more"
    // relative to a page size this client chose.
    expect(path).toBe("/api/rooms/room-1/messages?limit=30");
  });

  it("passes the cursor through and encodes ids", () => {
    // When
    const path = chatHistoryPath("room/1", { before: "message-9", limit: 10 });

    // Then
    expect(path).toBe("/api/rooms/room%2F1/messages?before=message-9&limit=10");
  });

  it("names the message in the reactions path", () => {
    expect(chatReactionsPath("room-1", "message-1")).toBe(
      "/api/rooms/room-1/messages/message-1/reactions",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Refusals                                                                   */
/* -------------------------------------------------------------------------- */

describe("refusal vocabulary", () => {
  it("has a real sentence for every code it can receive", () => {
    for (const code of CHAT_REFUSAL_CODES) {
      const sentence = chatRefusalMessage(code);

      // A code rendered raw is a refusal a player cannot act on.
      expect(sentence.length).toBeGreaterThan(20);
      expect(sentence).not.toContain(code);
      expect(sentence.endsWith(".")).toBe(true);
    }
  });

  it("reads the room's mode out of the only two codes that state it", () => {
    expect(chatModeFromRefusal("CHAT_DISABLED")).toBe("off");
    expect(chatModeFromRefusal("CHAT_TEXT_NOT_ALLOWED")).toBe("quick");
    expect(chatModeFromRefusal("RATE_LIMITED")).toBeNull();
    expect(chatModeFromRefusal("NETWORK")).toBeNull();
  });

  it("narrows the configured mode but never widens it", () => {
    // Given a table configured for free text, and a server that says otherwise.
    expect(effectiveChatMode("full", "CHAT_TEXT_NOT_ALLOWED")).toBe("quick");
    expect(effectiveChatMode("full", "CHAT_DISABLED")).toBe("off");
    expect(effectiveChatMode("quick", "CHAT_DISABLED")).toBe("off");

    // A refusal that says nothing about the ruleset leaves the mode alone.
    expect(effectiveChatMode("full", "RATE_LIMITED")).toBe("full");
    expect(effectiveChatMode("full", null)).toBe("full");

    // And `off` is never talked up into a usable surface.
    expect(effectiveChatMode("off", "CHAT_TEXT_NOT_ALLOWED")).toBe("off");
    expect(effectiveChatMode("off", null)).toBe("off");
  });

  it("only ever tightens the mode a refusal proved", () => {
    // Given nothing learned yet.
    expect(narrowestModeRefusal(null, "RATE_LIMITED")).toBeNull();
    expect(narrowestModeRefusal(null, "CHAT_TEXT_NOT_ALLOWED")).toBe("CHAT_TEXT_NOT_ALLOWED");

    // A refusal that says nothing about the ruleset cannot displace one that did:
    // otherwise a rate limit would re-open a composer in a room with chat off.
    expect(narrowestModeRefusal("CHAT_DISABLED", "RATE_LIMITED")).toBe("CHAT_DISABLED");
    expect(narrowestModeRefusal("CHAT_TEXT_NOT_ALLOWED", "NETWORK")).toBe(
      "CHAT_TEXT_NOT_ALLOWED",
    );

    // And `off` outranks `quick`, in either arrival order.
    expect(narrowestModeRefusal("CHAT_TEXT_NOT_ALLOWED", "CHAT_DISABLED")).toBe("CHAT_DISABLED");
    expect(narrowestModeRefusal("CHAT_DISABLED", "CHAT_TEXT_NOT_ALLOWED")).toBe("CHAT_DISABLED");
  });

  it("blocks the composer only for refusals that mean 'you cannot post'", () => {
    expect(chatRefusalBlocksComposer("RATE_LIMITED")).toBe(true);
    expect(chatRefusalBlocksComposer("CHAT_DISABLED")).toBe(true);
    expect(chatRefusalBlocksComposer("UNAUTHORIZED")).toBe(true);
    expect(chatRefusalBlocksComposer("NETWORK")).toBe(true);

    // Quick chat still has the phrase set, and a refused emote is not a mute.
    expect(chatRefusalBlocksComposer("CHAT_TEXT_NOT_ALLOWED")).toBe(false);
    expect(chatRefusalBlocksComposer("EMOTE_LIMIT_REACHED")).toBe(false);
    expect(chatRefusalBlocksComposer("INVALID_CURSOR")).toBe(false);
  });

  it("mirrors the server's length cap rather than restating one", () => {
    expect(CHAT_TEXT_MAX_LENGTH).toBe(CHAT_MESSAGE_MAX_LENGTH);
  });

  it("only accepts emote ids the contract knows", () => {
    expect(isEmote("emote.fire")).toBe(true);
    expect(isEmote("emote.invented")).toBe(false);
    expect(isEmote(null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Parsing                                                                    */
/* -------------------------------------------------------------------------- */

describe("history parsing", () => {
  it("reads a page and normalizes an empty cursor to null", () => {
    // When
    const page = parseChatHistoryPage({
      messages: [wireMessage(), wireMessage({ id: "message-2", kind: "quick", body: "chat.phrase.deal" })],
      nextCursor: "",
    });

    // Then
    expect(page.messages).toHaveLength(2);
    expect(page.messages[1].kind).toBe("quick");
    expect(page.nextCursor).toBeNull();
  });

  it("keeps a tally the viewer owns, and drops an emote it does not know", () => {
    // When
    const page = parseChatHistoryPage({
      messages: [
        wireMessage({
          reactions: [
            { emote: "emote.fire", count: 2, mine: true },
            { emote: "emote.invented-later", count: 5, mine: false },
            { emote: "emote.laugh", count: 0, mine: false },
          ],
        }),
      ],
      nextCursor: null,
    });

    // Then — an unreadable tally is a count we cannot draw, not a conversation
    // we refuse to show.
    expect(page.messages[0].reactions).toEqual([{ emote: "emote.fire", count: 2, mine: true }]);
  });

  it("refuses a row it would otherwise render wrong", () => {
    const badKind = { messages: [wireMessage({ kind: "shout" })], nextCursor: null };
    const noId = { messages: [wireMessage({ id: "" })], nextCursor: null };
    const tooLong = {
      messages: [wireMessage({ body: "x".repeat(CHAT_MESSAGE_MAX_LENGTH + 1) })],
      nextCursor: null,
    };

    for (const payload of [badKind, noId, tooLong, { messages: "nope" }, null]) {
      expect(() => parseChatHistoryPage(payload)).toThrow(ChatTransportError);
    }
    expect(() => parseChatHistoryPage(noId)).toThrow(/MALFORMED_RESPONSE/);
  });
});

/* -------------------------------------------------------------------------- */
/* Feed state                                                                 */
/* -------------------------------------------------------------------------- */

describe("feed", () => {
  it("records that a page landed, so empty is distinguishable from unread", () => {
    // Given
    expect(EMPTY_CHAT_FEED.loaded).toBe(false);

    // When
    const feed = receiveChatHistoryPage(EMPTY_CHAT_FEED, { messages: [], nextCursor: null });

    // Then
    expect(feed.loaded).toBe(true);
    expect(feed.messages).toEqual([]);
    expect(feed.olderCursor).toBeNull();
  });

  it("adopts the cursor of the oldest page held", () => {
    // Given a first page that reported more history behind it.
    const first = receiveChatHistoryPage(EMPTY_CHAT_FEED, {
      messages: [message({ id: "message-5" })],
      nextCursor: "message-5",
    });

    // When the older page comes back and reaches the start.
    const second = receiveChatHistoryPage(first, {
      messages: [message({ id: "message-1", createdAt: "2026-07-26T09:00:00.000Z" })],
      nextCursor: null,
    });

    // Then
    expect(second.olderCursor).toBeNull();
    expect(second.messages.map((entry) => entry.id)).toEqual(["message-1", "message-5"]);
  });

  it("orders oldest first, breaking a same-instant tie on id", () => {
    // Given three messages handed over in the wrong order, two of them committed
    // in the same millisecond.
    const feed = receiveChatMessages(EMPTY_CHAT_FEED, [
      message({ id: "message-b", createdAt: "2026-07-26T09:41:07.000Z" }),
      message({ id: "message-c", createdAt: "2026-07-26T09:42:00.000Z" }),
      message({ id: "message-a", createdAt: "2026-07-26T09:41:07.000Z" }),
    ]);

    // Then — one stable order on every client, not per-client arrival order.
    expect(feed.messages.map((entry) => entry.id)).toEqual([
      "message-a",
      "message-b",
      "message-c",
    ]);
  });

  it("treats a repeated realtime frame as free", () => {
    // Given
    const once = receiveChatMessage(EMPTY_CHAT_FEED, postedFrame());

    // When the same frame arrives again after a reconnect.
    const twice = receiveChatMessage(once, postedFrame());

    // Then — the SAME object, so a reconnect storm costs no re-render.
    expect(twice).toBe(once);
    expect(twice.messages).toHaveLength(1);
  });

  it("does not let a frame blank the name or the tallies a page already had", () => {
    // Given a message read from history, with a name and a reaction.
    const loaded = receiveChatHistoryPage(EMPTY_CHAT_FEED, {
      messages: [message({ reactions: [{ emote: "emote.fire", count: 1, mine: false }] })],
      nextCursor: null,
    });

    // When the socket delivers the same line, which carries ids only.
    const merged = receiveChatMessage(loaded, postedFrame());

    // Then
    expect(merged.messages[0].authorName).toBe("Morgan");
    expect(merged.messages[0].reactions).toHaveLength(1);
  });

  it("still shows a line that arrived over the socket before its page", () => {
    // Given only the socket frame.
    const pushed = receiveChatMessage(EMPTY_CHAT_FEED, postedFrame());
    expect(pushed.messages[0].authorName).toBeNull();

    // When the page lands afterwards.
    const loaded = receiveChatHistoryPage(pushed, {
      messages: [message()],
      nextCursor: null,
    });

    // Then the richer value wins, and the line is not duplicated.
    expect(loaded.messages).toHaveLength(1);
    expect(loaded.messages[0].authorName).toBe("Morgan");
  });
});

describe("emote reactions", () => {
  const loaded = receiveChatHistoryPage(EMPTY_CHAT_FEED, {
    messages: [message()],
    nextCursor: null,
  });

  it("adds a tally and marks it as the viewer's only when the actor is the viewer", () => {
    // When
    const theirs = receiveChatReaction(loaded, reactionFrame(), AVERY);
    const mine = receiveChatReaction(loaded, reactionFrame({ actorId: AVERY }), AVERY);

    // Then
    expect(theirs.messages[0].reactions).toEqual([
      { emote: "emote.fire", count: 1, mine: false },
    ]);
    expect(ownEmoteOn(theirs.messages[0])).toBeNull();
    expect(ownEmoteOn(mine.messages[0])).toBe("emote.fire");
  });

  it("skips a duplicated frame but applies a genuine re-react", () => {
    // Given one applied reaction.
    const added = receiveChatReaction(loaded, reactionFrame(), AVERY);

    // When the identical envelope is delivered twice — the id is
    // `messageId:playerId:emote`, so a dedupe-by-id ledger could not tell these
    // apart from the re-react below.
    const duplicate = receiveChatReaction(added, reactionFrame(), AVERY);
    expect(duplicate).toBe(added);
    expect(duplicate.messages[0].reactions[0].count).toBe(1);

    // When it is cleared and then set again.
    const cleared = receiveChatReaction(added, reactionFrame({ removed: true }), AVERY);
    expect(cleared.messages[0].reactions).toEqual([]);

    const reAdded = receiveChatReaction(cleared, reactionFrame(), AVERY);
    expect(reAdded.messages[0].reactions[0].count).toBe(1);
  });

  it("counts two players on one emote and drops the tally at zero", () => {
    // Given
    const first = receiveChatReaction(loaded, reactionFrame(), AVERY);
    const second = receiveChatReaction(first, reactionFrame({ actorId: AVERY }), AVERY);
    expect(second.messages[0].reactions[0]).toEqual({
      emote: "emote.fire",
      count: 2,
      mine: true,
    });

    // When both clear it.
    const third = receiveChatReaction(second, reactionFrame({ removed: true }), AVERY);
    expect(third.messages[0].reactions[0]).toEqual({
      emote: "emote.fire",
      count: 1,
      mine: true,
    });

    const fourth = receiveChatReaction(
      third,
      reactionFrame({ actorId: AVERY, removed: true }),
      AVERY,
    );
    expect(fourth.messages[0].reactions).toEqual([]);
  });

  it("ignores a frame for a message it has not loaded, and applies it once it has", () => {
    // Given a frame about a message outside the loaded page.
    const stray = reactionFrame({ targetId: "message-99" });
    const ignored = receiveChatReaction(loaded, stray, AVERY);
    expect(ignored).toBe(loaded);

    // When that page is paged in and the frame is replayed — nothing was recorded
    // for it, so it is not mistaken for already applied.
    const paged = receiveChatMessages(ignored, [
      message({ id: "message-99", createdAt: "2026-07-26T09:50:00.000Z" }),
    ]);
    const applied = receiveChatReaction(paged, stray, AVERY);
    expect(applied.messages[1].reactions[0].count).toBe(1);
  });

  it("ignores an emote aimed at a feed event, which has no row here", () => {
    // Given — `targetKind: "event"` has no endpoint in v1 (spec §8.2).
    const feed = receiveChatReaction(loaded, reactionFrame({ targetKind: "event" }), AVERY);

    // Then
    expect(feed).toBe(loaded);
  });

  it("makes the viewer's own optimistic click and the server's echo the same fact", () => {
    // Given the panel applied the click locally.
    const optimistic = applyChatReaction(loaded, {
      messageId: "message-1",
      actorId: AVERY,
      emote: "emote.fire",
      removed: false,
      selfPlayerId: AVERY,
    });
    expect(optimistic.messages[0].reactions[0].count).toBe(1);

    // When the broadcast of that same reaction comes back to the sender.
    const echoed = receiveChatReaction(optimistic, reactionFrame({ actorId: AVERY }), AVERY);

    // Then it is a no-op rather than a double count.
    expect(echoed).toBe(optimistic);
  });

  it("rolls a refused click back by applying the inverse", () => {
    // Given an optimistic add the server then refused.
    const optimistic = applyChatReaction(loaded, {
      messageId: "message-1",
      actorId: AVERY,
      emote: "emote.fire",
      removed: false,
      selfPlayerId: AVERY,
    });

    // When
    const rolledBack = applyChatReaction(optimistic, {
      messageId: "message-1",
      actorId: AVERY,
      emote: "emote.fire",
      removed: true,
      selfPlayerId: AVERY,
    });

    // Then
    expect(rolledBack.messages[0].reactions).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */
/* -------------------------------------------------------------------------- */

describe("requests", () => {
  it("posts a message and returns the stored row", async () => {
    // Given
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: wireMessage() }, 201));
    vi.stubGlobal("fetch", fetchMock);

    // When
    const stored = await sendChatMessage("room-1", { kind: "quick", body: "chat.phrase.deal" });

    // Then
    expect(fetchMock).toHaveBeenCalledWith("/api/rooms/room-1/messages", {
      body: JSON.stringify({ kind: "quick", body: "chat.phrase.deal" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(stored.id).toBe("message-1");
  });

  it("repeats the path's message id in the reaction body, because the server checks", async () => {
    // Given
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ reaction: { messageId: "message-1", emote: "emote.fire", removed: false } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // When
    const outcome = await reactToChatMessage("room-1", {
      messageId: "message-1",
      emote: "emote.fire",
      removed: false,
    });

    // Then — a disagreement between path and body is `EMOTE_TARGET_MISMATCH`.
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({
        emote: "emote.fire",
        removed: false,
        targetId: "message-1",
        targetKind: "message",
      }),
    );
    expect(outcome).toEqual({ messageId: "message-1", emote: "emote.fire", removed: false });
  });

  it("carries the server's own code out of a refusal", async () => {
    // Given
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { code: "RATE_LIMITED" } }, 429)),
    );

    // When / Then
    await expect(sendChatMessage("room-1", { kind: "text", body: "hi" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
  });

  it("still refuses when the refusal itself has no readable body", async () => {
    // Given
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })));

    // When / Then
    await expect(fetchChatHistory("room-1")).rejects.toMatchObject({
      code: "UNKNOWN",
      status: 502,
    });
  });

  it("turns an unreachable server into a refusal with a sentence", async () => {
    // Given
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    // When / Then — a bare TypeError at the call site is what makes chat look
    // like it silently stopped working.
    await expect(fetchChatHistory("room-1")).rejects.toMatchObject({
      code: "NETWORK",
      status: 0,
    });
  });

  it("lets an abort stay an abort", async () => {
    // Given
    const aborted = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(aborted));

    // When / Then — an unmount is not a refusal and must not be reported as one.
    await expect(fetchChatHistory("room-1")).rejects.toBe(aborted);
  });
});
