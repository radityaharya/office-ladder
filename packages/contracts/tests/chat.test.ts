import { describe, expect, it } from "vitest";

import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_MODES,
  EMOTES,
  parseChatMessagePosted,
  parseEmoteReactionPosted,
  parseEmoteReactionRequest,
  parseSendMessageRequest,
  QUICK_CHAT_PHRASES,
} from "../src/chat";
import { PROJECTION_CHANGE_AREAS, parseRealtimeMessage } from "../src/realtime";
import { ContractValidationError } from "../src/validate";

const full = { chatMode: "full" } as const;
const quick = { chatMode: "quick" } as const;
const off = { chatMode: "off" } as const;

describe("chat messages", () => {
  it("Given a free-typed line in full chat, When parsing it, Then it comes back trimmed", () => {
    expect(
      parseSendMessageRequest({ kind: "text", body: "  taking the corner office  " }, full),
    ).toEqual({ kind: "text", body: "taking the corner office" });
  });

  it("Given a quick phrase, When parsing it in either chat mode that allows chat, Then it is accepted", () => {
    const body = QUICK_CHAT_PHRASES[0];
    expect(parseSendMessageRequest({ kind: "quick", body }, quick)).toEqual({
      kind: "quick",
      body,
    });
    // `full` is a superset: a client with the phrase bar open still works.
    expect(parseSendMessageRequest({ kind: "quick", body }, full)).toEqual({
      kind: "quick",
      body,
    });
  });

  it("Given a room with chat off, When parsing any message, Then it is refused before the body is even read", () => {
    // The gate answers the same way for every body, so a probe cannot learn which
    // lines would have been acceptable in a room that has chat switched off.
    expect(() => parseSendMessageRequest({ kind: "text", body: "hello" }, off)).toThrow(
      ContractValidationError,
    );
    expect(() =>
      parseSendMessageRequest({ kind: "quick", body: QUICK_CHAT_PHRASES[0] }, off),
    ).toThrow(ContractValidationError);
    expect(() => parseSendMessageRequest("not even an object", off)).toThrow(
      ContractValidationError,
    );
  });

  it("Given free-typed text in a quick-only room, When parsing it, Then it is refused", () => {
    // `quick` mode exists so a room can be social without being a typing surface —
    // and so bots can participate. Free text there would defeat both.
    expect(() =>
      parseSendMessageRequest({ kind: "text", body: "let me type instead" }, quick),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["a phrase that is not in the set", "chat.phrase.leak-your-hand"],
    ["free text posing as a phrase", "nice move"],
    ["an empty phrase", ""],
    ["a non-string phrase", 3],
  ])(
    "Given a quick message with %s, When parsing it, Then it is refused",
    (_label, body) => {
      expect(() => parseSendMessageRequest({ kind: "quick", body }, quick)).toThrow(
        ContractValidationError,
      );
    },
  );

  it("Given a line at the length cap, When parsing it, Then it is accepted, and one character longer is refused", () => {
    const atCap = "x".repeat(CHAT_MESSAGE_MAX_LENGTH);
    expect(parseSendMessageRequest({ kind: "text", body: atCap }, full).body).toBe(atCap);
    expect(() =>
      parseSendMessageRequest({ kind: "text", body: `${atCap}x` }, full),
    ).toThrow(ContractValidationError);
  });

  it("Given a line of emoji at the cap, When parsing it, Then the cap counts characters rather than UTF-16 units", () => {
    // Each of these is two UTF-16 units. Measuring `.length` would silently halve
    // the allowance for anyone not typing Latin script.
    const emoji = "🙂".repeat(CHAT_MESSAGE_MAX_LENGTH);
    expect(parseSendMessageRequest({ kind: "text", body: emoji }, full).body).toBe(emoji);
    expect(() =>
      parseSendMessageRequest({ kind: "text", body: `${emoji}🙂` }, full),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["only whitespace", "    "],
    ["an empty string", ""],
    ["a newline", "first line\nsecond line"],
    ["a carriage return", "first\r\nsecond"],
    ["a NUL byte", "hello\u0000world"],
    ["a non-string", 42],
    ["null", null],
  ])(
    "Given a chat line that is %s, When parsing it, Then it is refused",
    (_label, body) => {
      // A newline in a stored, re-served line forges a second entry in anything
      // that formats one record per line, the log included.
      expect(() => parseSendMessageRequest({ kind: "text", body }, full)).toThrow(
        ContractValidationError,
      );
    },
  );

  it.each([
    ["an unknown kind", { kind: "direct", body: "psst" }],
    ["a recipient list", { kind: "text", body: "psst", recipientIds: ["player-2"] }],
    ["an author it names itself", { kind: "text", body: "hi", authorId: "player-9" }],
    ["a missing kind", { body: "hi" }],
    ["a missing body", { kind: "text" }],
  ])(
    "Given a chat body with %s, When parsing it, Then it is refused",
    (_label, body) => {
      // There is no DM shape in the transport at all (§8.1), so a client cannot
      // ask for one even in a room whose config claims to allow it.
      expect(() => parseSendMessageRequest(body, full)).toThrow(ContractValidationError);
    },
  );

  it("Given the chat mode vocabulary, When reading it, Then it is exactly the three the spec names", () => {
    expect([...CHAT_MODES]).toEqual(["off", "quick", "full"]);
  });
});

describe("emote reactions", () => {
  const enabled = { emoteReactionsEnabled: true } as const;

  it("Given a reaction on a feed event, When parsing it, Then it comes back typed", () => {
    expect(
      parseEmoteReactionRequest(
        { targetKind: "event", targetId: "event-1", emote: EMOTES[0], removed: false },
        enabled,
      ),
    ).toEqual({
      targetKind: "event",
      targetId: "event-1",
      emote: EMOTES[0],
      removed: false,
    });
  });

  it("Given a room with reactions switched off, When parsing one, Then it is refused", () => {
    expect(() =>
      parseEmoteReactionRequest(
        { targetKind: "event", targetId: "event-1", emote: EMOTES[0], removed: false },
        { emoteReactionsEnabled: false },
      ),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["an unknown emote", { emote: "emote.middle-finger" }],
    ["an arbitrary string as the emote", { emote: "🙂" }],
    ["a player as the target", { targetKind: "player" }],
    ["an unusable target id", { targetId: "event 1" }],
    ["a non-boolean toggle", { removed: "yes" }],
  ])(
    "Given a reaction with %s, When parsing it, Then it is refused",
    (_label, override) => {
      // The target vocabulary excludes players deliberately: an emote aimed at a
      // person rather than at something they did has no gameplay use.
      expect(() =>
        parseEmoteReactionRequest(
          {
            targetKind: "event",
            targetId: "event-1",
            emote: EMOTES[0],
            removed: false,
            ...override,
          },
          enabled,
        ),
      ).toThrow(ContractValidationError);
    },
  );

  it("Given a reaction body with an extra field, When parsing it, Then it is refused", () => {
    expect(() =>
      parseEmoteReactionRequest(
        {
          targetKind: "event",
          targetId: "event-1",
          emote: EMOTES[0],
          removed: false,
          actorId: "player-9",
        },
        enabled,
      ),
    ).toThrow(ContractValidationError);
  });
});

describe("chat realtime payloads", () => {
  const posted = {
    kind: "chat-message-posted",
    messageId: "message-1",
    roomId: "room-1",
    authorId: "player-1",
    messageKind: "text",
    body: "shipping it",
    createdAt: "2026-07-26T10:00:00.000Z",
  } as const;

  const reacted = {
    kind: "emote-reaction-posted",
    messageId: "reaction-1",
    roomId: "room-1",
    actorId: "player-2",
    targetKind: "event",
    targetId: "event-1",
    emote: EMOTES[1],
    removed: false,
    createdAt: "2026-07-26T10:00:01.000Z",
  } as const;

  it("Given a posted message, When parsing the payload, Then it comes back whole", () => {
    expect(parseChatMessagePosted(posted)).toEqual(posted);
    expect(parseEmoteReactionPosted(reacted)).toEqual(reacted);
  });

  it("Given a posted quick message, When parsing the payload, Then the body is still checked against the phrase set", () => {
    expect(
      parseChatMessagePosted({
        ...posted,
        messageKind: "quick",
        body: QUICK_CHAT_PHRASES[1],
      }).body,
    ).toBe(QUICK_CHAT_PHRASES[1]);
    expect(() =>
      parseChatMessagePosted({ ...posted, messageKind: "quick", body: "anything" }),
    ).toThrow(ContractValidationError);
  });

  it.each([
    ["the wrong kind", { kind: "projection-updated" }],
    ["a missing field", { createdAt: undefined }],
    ["an extra field", { seat: 2 }],
    ["a non-instant timestamp", { createdAt: "yesterday" }],
    ["an unusable author id", { authorId: "player 1" }],
    ["an over-long body", { body: "x".repeat(CHAT_MESSAGE_MAX_LENGTH + 1) }],
  ])(
    "Given a posted-message payload with %s, When parsing it, Then it is refused",
    (_label, override) => {
      const payload: Record<string, unknown> = { ...posted, ...override };
      if ("createdAt" in override && override.createdAt === undefined) {
        delete payload["createdAt"];
      }
      expect(() => parseChatMessagePosted(payload)).toThrow(ContractValidationError);
    },
  );

  it("Given each realtime message kind, When parsing through the union, Then it dispatches to the right shape", () => {
    expect(parseRealtimeMessage(posted)).toEqual(posted);
    expect(parseRealtimeMessage(reacted)).toEqual(reacted);
    expect(
      parseRealtimeMessage({
        kind: "projection-updated",
        messageId: "message-2",
        aggregateVersion: 3,
        projectionRevision: 3,
        changed: ["gameplay"],
      }),
    ).toEqual({
      kind: "projection-updated",
      messageId: "message-2",
      aggregateVersion: 3,
      projectionRevision: 3,
      changed: ["gameplay"],
    });
  });

  it.each([
    ["an unknown kind", { kind: "presence-changed" }],
    ["no kind at all", {}],
    ["a non-object", "chat-message-posted"],
  ])(
    "Given a realtime message with %s, When parsing it, Then it is refused",
    (_label, payload) => {
      expect(() => parseRealtimeMessage(payload)).toThrow(ContractValidationError);
    },
  );

  it("Given the projection change areas, When looking for chat among them, Then it is absent", () => {
    // Chat is not game state (§8.1): it is not derived from `GameState`, and
    // re-fetching the bootstrap would not produce it. It carries its own content on
    // its own message kinds instead of invalidating a projection area.
    expect(PROJECTION_CHANGE_AREAS as readonly string[]).not.toContain("chat");
    expect(PROJECTION_CHANGE_AREAS as readonly string[]).not.toContain("messages");
    expect(PROJECTION_CHANGE_AREAS as readonly string[]).not.toContain("emotes");
  });
});
