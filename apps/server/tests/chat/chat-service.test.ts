import { describe, expect, it } from "vitest";

import { ContractValidationError, CHAT_MESSAGE_MAX_LENGTH } from "@office-ladder/contracts";
import { createSlidingWindowRateLimiter } from "../../src/rooms/chat/rate-limit";
import type { StoredRoom } from "../../src/rooms/service/types";
import { chatHarness, HOST, MEMBER, STRANGER } from "./harness";

/** A started room whose snapshotted ruleset has `social.chat` set to `mode`. */
function withChatMode(mode: "off" | "quick" | "full") {
  return (room: StoredRoom): StoredRoom => {
    if (room.game === null) throw new Error("expected a started match to patch");
    return {
      ...room,
      game: {
        ...room.game,
        rules: {
          ...room.game.rules,
          social: { ...room.game.rules.social, chat: mode },
        },
      },
    };
  };
}

function withEmoteReactions(enabled: boolean) {
  return (room: StoredRoom): StoredRoom => {
    if (room.game === null) throw new Error("expected a started match to patch");
    return {
      ...room,
      game: {
        ...room.game,
        rules: {
          ...room.game.rules,
          social: { ...room.game.rules.social, emoteReactions: enabled },
        },
      },
    };
  };
}

describe("chat service — the happy path", () => {
  it("Given a member of a full-chat room, When they post a line, Then it is stored, announced once and reads back with its author", async () => {
    const harness = await chatHarness();

    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "the deadline moved again" },
    });

    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.value).toMatchObject({
      roomId: harness.roomId,
      authorId: MEMBER,
      authorName: "Member",
      kind: "text",
      body: "the deadline moved again",
    });
    // Exactly one frame: a message the room hears twice is a message the client
    // renders twice.
    expect(harness.published.messages).toEqual([
      { roomId: harness.roomId, id: sent.value.id, body: "the deadline moved again" },
    ]);

    const history = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: HOST,
      before: null,
      limit: 10,
    });
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.value.messages).toHaveLength(1);
    expect(history.value.messages[0]).toMatchObject({
      id: sent.value.id,
      authorId: MEMBER,
      authorName: "Member",
      body: "the deadline moved again",
      reactions: [],
    });
    expect(history.value.nextCursor).toBeNull();
  });

  it("Given a quick-chat room, When a member sends a phrase id, Then it is accepted and travels as the id", async () => {
    const harness = await chatHarness({ mode: "mode.quick" });

    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "quick", body: "chat.phrase.nice-move" },
    });

    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    // The id, not a sentence: the client owns the wording (contracts §8.1).
    expect(sent.value).toMatchObject({ kind: "quick", body: "chat.phrase.nice-move" });
  });

  it("Given a room's messages, When a viewer pages back with the returned cursor, Then every line is seen once, oldest last", async () => {
    const harness = await chatHarness();
    for (const body of ["one", "two", "three", "four", "five"]) {
      await harness.chat.send({
        roomId: harness.roomId,
        actorId: MEMBER,
        actorKind: "human",
        body: { kind: "text", body },
      });
    }

    const first = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: MEMBER,
      before: null,
      limit: 2,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.messages.map((message) => message.body)).toEqual(["four", "five"]);
    expect(first.value.nextCursor).not.toBeNull();

    const second = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: MEMBER,
      before: first.value.nextCursor,
      limit: 2,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.messages.map((message) => message.body)).toEqual(["two", "three"]);

    const third = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: MEMBER,
      before: second.value.nextCursor,
      limit: 2,
    });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.messages.map((message) => message.body)).toEqual(["one"]);
    // A short page has reached the start of history, so there is nothing to
    // claim is older than it.
    expect(third.value.nextCursor).toBeNull();
  });
});

describe("chat service — the unauthorised actor", () => {
  it("Given an authenticated stranger who knows the room id, When they read the history, Then it is refused", async () => {
    const harness = await chatHarness();
    await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "internal" },
    });

    const history = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: STRANGER,
      before: null,
      limit: 10,
    });

    expect(history).toEqual({ ok: false, error: { code: "ACTOR_NOT_MEMBER" } });
  });

  it("Given an authenticated stranger, When they post to a room they are not in, Then nothing is stored or announced", async () => {
    const harness = await chatHarness();

    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: STRANGER,
      actorKind: "human",
      body: { kind: "text", body: "let me in" },
    });

    expect(sent).toEqual({ ok: false, error: { code: "ACTOR_NOT_MEMBER" } });
    expect(harness.published.messages).toEqual([]);
    const history = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: MEMBER,
      before: null,
      limit: 10,
    });
    expect(history.ok && history.value.messages).toEqual([]);
  });

  it("Given a room that does not exist, When anyone posts to it, Then it is refused before any body is looked at", async () => {
    const harness = await chatHarness();

    const sent = await harness.chat.send({
      roomId: "room-that-does-not-exist",
      actorId: MEMBER,
      actorKind: "human",
      // Malformed on purpose: the room check has to come first, or a stranger
      // learns which bodies this server would have accepted.
      body: { nonsense: true },
    });

    expect(sent).toEqual({ ok: false, error: { code: "ROOM_NOT_FOUND" } });
  });

  it("Given a session presenting a bot seat's id, When it posts, Then it is refused as impersonation", async () => {
    const harness = await chatHarness({ withBot: true });
    const botSeatId = harness.botSeatId;
    expect(botSeatId).not.toBeNull();
    if (botSeatId === null) return;

    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: botSeatId,
      actorKind: "human",
      body: { kind: "text", body: "beep" },
    });

    expect(sent).toEqual({ ok: false, error: { code: "ACTOR_IS_BOT" } });
  });

  it("Given the bot driver naming a human member, When it posts for them, Then it is refused", async () => {
    const harness = await chatHarness({ withBot: true });

    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "bot",
      body: { kind: "quick", body: "chat.phrase.hello" },
    });

    expect(sent).toEqual({ ok: false, error: { code: "ACTOR_NOT_BOT" } });
  });

  it("Given a bot seat, When it sends a quick phrase, Then it is accepted; free text is not", async () => {
    const harness = await chatHarness({ withBot: true });
    const botSeatId = harness.botSeatId;
    if (botSeatId === null) throw new Error("expected a bot seat");

    const phrase = await harness.chat.send({
      roomId: harness.roomId,
      actorId: botSeatId,
      actorKind: "bot",
      body: { kind: "quick", body: "chat.phrase.good-luck" },
    });
    expect(phrase.ok).toBe(true);

    // The room is `full`, so contracts would allow the text — this refusal is
    // the server's own rule (§8.1: quick is the only mode bots can use).
    const text = await harness.chat.send({
      roomId: harness.roomId,
      actorId: botSeatId,
      actorKind: "bot",
      body: { kind: "text", body: "I have computed the optimal line" },
    });
    expect(text).toEqual({ ok: false, error: { code: "CHAT_TEXT_NOT_ALLOWED" } });
  });

  it("Given a cursor naming a message in another room, When history is read, Then it is refused rather than ignored", async () => {
    const other = await chatHarness();
    const sent = await other.chat.send({
      roomId: other.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "elsewhere" },
    });
    if (!sent.ok) throw new Error("setup message was refused");

    const harness = await chatHarness();
    const history = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: MEMBER,
      before: sent.value.id,
      limit: 10,
    });

    // Treating a foreign cursor as "no cursor" would answer "does this message
    // id exist" with a 200 for any id in any room.
    expect(history).toEqual({ ok: false, error: { code: "INVALID_CURSOR" } });
  });
});

describe("chat service — the mode gate", () => {
  it("Given a ruleset with chat off, When a member posts, Then it is refused and nothing is stored", async () => {
    const harness = await chatHarness({ start: true, roomPatch: withChatMode("off") });

    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "anyone there" },
    });

    expect(sent).toEqual({ ok: false, error: { code: "CHAT_DISABLED" } });
    expect(harness.published.messages).toEqual([]);
  });

  it("Given a ruleset with chat off, When a member reads the history, Then it is refused too", async () => {
    const harness = await chatHarness({ start: true, roomPatch: withChatMode("off") });

    const history = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: MEMBER,
      before: null,
      limit: 10,
    });

    // Switching chat off has to hide what was said while it was on; a readable
    // log nobody can add to is not "off".
    expect(history).toEqual({ ok: false, error: { code: "CHAT_DISABLED" } });
  });

  it("Given a quick-chat room, When a member sends free text, Then the body is refused as malformed", async () => {
    const harness = await chatHarness({ mode: "mode.quick" });

    await expect(
      harness.chat.send({
        roomId: harness.roomId,
        actorId: MEMBER,
        actorKind: "human",
        body: { kind: "text", body: "let me type whatever I like" },
      }),
    ).rejects.toBeInstanceOf(ContractValidationError);
  });

  it("Given a quick-chat room, When a member sends a phrase id that is not in the set, Then it is refused", async () => {
    const harness = await chatHarness({ mode: "mode.quick" });

    await expect(
      harness.chat.send({
        roomId: harness.roomId,
        actorId: MEMBER,
        actorKind: "human",
        // Shaped like a phrase id, and not one. The fixed set is the whole
        // point of quick mode: anything else is free text with a prefix.
        body: { kind: "quick", body: "chat.phrase.you-are-fired" },
      }),
    ).rejects.toBeInstanceOf(ContractValidationError);
  });

  it("Given a ruleset with emote reactions off, When a member reacts, Then it is refused", async () => {
    const harness = await chatHarness({
      start: true,
      roomPatch: withEmoteReactions(false),
    });
    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "no reactions here" },
    });
    if (!sent.ok) throw new Error("setup message was refused");

    const reacted = await harness.chat.react({
      roomId: harness.roomId,
      actorId: HOST,
      actorKind: "human",
      messageId: sent.value.id,
      body: {
        targetKind: "message",
        targetId: sent.value.id,
        emote: "emote.clap",
        removed: false,
      },
    });

    expect(reacted).toEqual({ ok: false, error: { code: "EMOTE_REACTIONS_DISABLED" } });
  });
});

describe("chat service — hostile input", () => {
  it("Given a body over the length cap, When it is sent, Then it is refused; one character under it is accepted", async () => {
    const harness = await chatHarness();

    await expect(
      harness.chat.send({
        roomId: harness.roomId,
        actorId: MEMBER,
        actorKind: "human",
        body: { kind: "text", body: "a".repeat(CHAT_MESSAGE_MAX_LENGTH + 1) },
      }),
    ).rejects.toBeInstanceOf(ContractValidationError);

    const atTheCap = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "a".repeat(CHAT_MESSAGE_MAX_LENGTH) },
    });
    expect(atTheCap.ok).toBe(true);
  });

  it("Given a body carrying its own author and room, When it is sent, Then the extra fields are refused outright", async () => {
    const harness = await chatHarness();

    await expect(
      harness.chat.send({
        roomId: harness.roomId,
        actorId: MEMBER,
        actorKind: "human",
        body: {
          kind: "text",
          body: "posted by somebody else",
          authorId: HOST,
          roomId: "some-other-room",
          createdAt: "1999-01-01T00:00:00.000Z",
        },
      }),
    ).rejects.toBeInstanceOf(ContractValidationError);
  });

  it("Given a body that is not an object, When it is sent, Then it is refused rather than coerced", async () => {
    const harness = await chatHarness();

    for (const body of [null, "hello", 42, ["hello"], undefined]) {
      await expect(
        harness.chat.send({
          roomId: harness.roomId,
          actorId: MEMBER,
          actorKind: "human",
          body,
        }),
      ).rejects.toBeInstanceOf(ContractValidationError);
    }
    expect(harness.published.messages).toEqual([]);
  });

  it("Given a member sending faster than the limit, When the ceiling is reached, Then further posts are refused until the window rolls", async () => {
    let clock = 0;
    const limiter = createSlidingWindowRateLimiter({
      windowMs: 10_000,
      max: 3,
      now: () => clock,
    });
    const harness = await chatHarness({
      rateLimiters: {
        messages: limiter,
        reactions: createSlidingWindowRateLimiter({
          windowMs: 10_000,
          max: 100,
          now: () => clock,
        }),
      },
    });

    async function post(body: string) {
      return harness.chat.send({
        roomId: harness.roomId,
        actorId: MEMBER,
        actorKind: "human",
        body: { kind: "text", body },
      });
    }

    expect((await post("one")).ok).toBe(true);
    expect((await post("two")).ok).toBe(true);
    expect((await post("three")).ok).toBe(true);
    expect(await post("four")).toEqual({ ok: false, error: { code: "RATE_LIMITED" } });
    // Three stored, three announced: the refusal is not a soft warning.
    expect(harness.published.messages).toHaveLength(3);

    clock += 10_001;
    expect((await post("five")).ok).toBe(true);
  });

  it("Given one member at the ceiling, When another member posts, Then they are unaffected", async () => {
    const clock = 0;
    const harness = await chatHarness({
      rateLimiters: {
        messages: createSlidingWindowRateLimiter({
          windowMs: 10_000,
          max: 1,
          now: () => clock,
        }),
        reactions: createSlidingWindowRateLimiter({
          windowMs: 10_000,
          max: 100,
          now: () => clock,
        }),
      },
    });

    async function post(actorId: string, body: string) {
      return harness.chat.send({
        roomId: harness.roomId,
        actorId,
        actorKind: "human",
        body: { kind: "text", body },
      });
    }

    expect((await post(MEMBER, "mine")).ok).toBe(true);
    expect(await post(MEMBER, "mine again")).toEqual({
      ok: false,
      error: { code: "RATE_LIMITED" },
    });
    // Per player, not per room: one flooder must not mute everybody else.
    expect((await post(HOST, "theirs")).ok).toBe(true);
  });

  it("Given a request whose body names a different message than the path, When it is reacted to, Then it is refused", async () => {
    const harness = await chatHarness();
    const first = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "first" },
    });
    const second = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "second" },
    });
    if (!first.ok || !second.ok) throw new Error("setup messages were refused");

    const reacted = await harness.chat.react({
      roomId: harness.roomId,
      actorId: HOST,
      actorKind: "human",
      messageId: first.value.id,
      body: {
        targetKind: "message",
        targetId: second.value.id,
        emote: "emote.fire",
        removed: false,
      },
    });

    expect(reacted).toEqual({ ok: false, error: { code: "EMOTE_TARGET_MISMATCH" } });
    expect(harness.published.reactions).toEqual([]);
  });

  it("Given an emote aimed at a feed event, When it is posted to the message endpoint, Then it is refused", async () => {
    const harness = await chatHarness();
    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "an event happened" },
    });
    if (!sent.ok) throw new Error("setup message was refused");

    const reacted = await harness.chat.react({
      roomId: harness.roomId,
      actorId: HOST,
      actorKind: "human",
      messageId: sent.value.id,
      // §8.2 allows an emote on a feed event, but no endpoint and no table
      // exists for one: this path is message-scoped and says so.
      body: {
        targetKind: "event",
        targetId: sent.value.id,
        emote: "emote.fire",
        removed: false,
      },
    });

    expect(reacted).toEqual({ ok: false, error: { code: "EMOTE_TARGET_MISMATCH" } });
  });

  it("Given a message in another room, When a member reacts to it, Then it is not found", async () => {
    const other = await chatHarness();
    const elsewhere = await other.chat.send({
      roomId: other.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "elsewhere" },
    });
    if (!elsewhere.ok) throw new Error("setup message was refused");

    const harness = await chatHarness();
    const reacted = await harness.chat.react({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      messageId: elsewhere.value.id,
      body: {
        targetKind: "message",
        targetId: elsewhere.value.id,
        emote: "emote.eyes",
        removed: false,
      },
    });

    expect(reacted).toEqual({ ok: false, error: { code: "MESSAGE_NOT_FOUND" } });
  });
});

describe("chat service — emote reactions", () => {
  it("Given a message, When two members react and one removes theirs, Then the tally follows and each viewer sees their own", async () => {
    const harness = await chatHarness();
    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "shipped it" },
    });
    if (!sent.ok) throw new Error("setup message was refused");
    const messageId = sent.value.id;

    async function react(actorId: string, emote: string, removed = false) {
      return harness.chat.react({
        roomId: harness.roomId,
        actorId,
        actorKind: "human",
        messageId,
        body: { targetKind: "message", targetId: messageId, emote, removed },
      });
    }

    expect((await react(MEMBER, "emote.fire")).ok).toBe(true);
    expect((await react(HOST, "emote.fire")).ok).toBe(true);

    const seenByHost = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: HOST,
      before: null,
      limit: 10,
    });
    expect(seenByHost.ok && seenByHost.value.messages[0]?.reactions).toEqual([
      { emote: "emote.fire", count: 2, mine: true },
    ]);

    expect((await react(HOST, "emote.fire", true)).ok).toBe(true);
    const afterRemoval = await harness.chat.history({
      roomId: harness.roomId,
      viewerId: HOST,
      before: null,
      limit: 10,
    });
    expect(afterRemoval.ok && afterRemoval.value.messages[0]?.reactions).toEqual([
      { emote: "emote.fire", count: 1, mine: false },
    ]);

    expect(harness.published.reactions.map((entry) => entry.removed)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("Given a player who already reacted, When they send the same emote again, Then it is a clean conflict rather than a duplicate row", async () => {
    const harness = await chatHarness();
    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "double-click me" },
    });
    if (!sent.ok) throw new Error("setup message was refused");

    const body = {
      targetKind: "message",
      targetId: sent.value.id,
      emote: "emote.clap",
      removed: false,
    };
    const first = await harness.chat.react({
      roomId: harness.roomId,
      actorId: HOST,
      actorKind: "human",
      messageId: sent.value.id,
      body,
    });
    const second = await harness.chat.react({
      roomId: harness.roomId,
      actorId: HOST,
      actorKind: "human",
      messageId: sent.value.id,
      body,
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: { code: "EMOTE_ALREADY_APPLIED" } });
    expect(harness.published.reactions).toHaveLength(1);
  });

  it("Given a player holding one emote on a message, When they add a second, Then the per-player cap refuses it", async () => {
    const harness = await chatHarness();
    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "pile on" },
    });
    if (!sent.ok) throw new Error("setup message was refused");
    const messageId = sent.value.id;

    async function react(emote: string) {
      return harness.chat.react({
        roomId: harness.roomId,
        actorId: HOST,
        actorKind: "human",
        messageId,
        body: {
          targetKind: "message",
          targetId: messageId,
          emote,
          removed: false,
        },
      });
    }

    expect((await react("emote.laugh")).ok).toBe(true);
    expect(await react("emote.shock")).toEqual({
      ok: false,
      error: { code: "EMOTE_LIMIT_REACHED" },
    });
  });

  it("Given no reaction to remove, When one is removed anyway, Then it succeeds without announcing anything", async () => {
    const harness = await chatHarness();
    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "nothing here" },
    });
    if (!sent.ok) throw new Error("setup message was refused");

    const removed = await harness.chat.react({
      roomId: harness.roomId,
      actorId: HOST,
      actorKind: "human",
      messageId: sent.value.id,
      body: {
        targetKind: "message",
        targetId: sent.value.id,
        emote: "emote.sad",
        removed: true,
      },
    });

    // Removing what is not there is the state the caller asked for.
    expect(removed.ok).toBe(true);
    expect(harness.published.reactions).toEqual([]);
  });

  it("Given a stranger, When they react to a message in a room they are not in, Then it is refused", async () => {
    const harness = await chatHarness();
    const sent = await harness.chat.send({
      roomId: harness.roomId,
      actorId: MEMBER,
      actorKind: "human",
      body: { kind: "text", body: "members only" },
    });
    if (!sent.ok) throw new Error("setup message was refused");

    const reacted = await harness.chat.react({
      roomId: harness.roomId,
      actorId: STRANGER,
      actorKind: "human",
      messageId: sent.value.id,
      body: {
        targetKind: "message",
        targetId: sent.value.id,
        emote: "emote.eyes",
        removed: false,
      },
    });

    expect(reacted).toEqual({ ok: false, error: { code: "ACTOR_NOT_MEMBER" } });
  });
});
