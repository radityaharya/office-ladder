/**
 * The HTTP surface of §11.2, exercised through a real Hono router.
 *
 * `createChatRouter` takes its session lookup as a dependency for exactly this
 * reason: the identity checks (session, same-origin, actor-from-session-only)
 * are the part of chat that a service test cannot reach, and they are also the
 * part an attacker meets first.
 */
import type { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createSlidingWindowRateLimiter } from "../../src/rooms/chat/rate-limit";
import type { ChatService } from "../../src/rooms/chat/types";
import { createChatRouter } from "../../src/routes/chat";
import { chatHarness, HOST, MEMBER, session, noSession, STRANGER } from "./harness";

const ORIGIN = "http://localhost:3072";

/**
 * Rate limiters that never refuse, for the tests whose *setup* needs more
 * messages than a real player may send in ten seconds. The limit itself has its
 * own test below and in chat-service.test.ts; seeding a page of history is not
 * where it should be re-asserted by accident.
 */
function unlimited() {
  const never = { windowMs: 1, max: Number.MAX_SAFE_INTEGER, now: () => 0 };
  return {
    messages: createSlidingWindowRateLimiter(never),
    reactions: createSlidingWindowRateLimiter(never),
  };
}

function router(
  chat: ChatService,
  options?: { readonly userId?: string; readonly authenticated?: boolean },
): { readonly app: Hono; readonly sessionLookups: number } & {
  lookups: () => number;
} {
  let lookups = 0;
  const app = createChatRouter({
    requireSession: () => {
      lookups += 1;
      return options?.authenticated === false
        ? noSession()
        : session(options?.userId ?? MEMBER);
    },
    chatService: chat,
  });

  return { app, sessionLookups: 0, lookups: () => lookups };
}

function post(path: string, body: unknown, headers?: Record<string, string>): Request {
  return new Request(`http://localhost:3072${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`http://localhost:3072${path}`, {
    headers: { origin: ORIGIN },
  });
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

describe("chat routes — sending", () => {
  it("Given a member, When they POST a message, Then it is created and returned", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);

    const response = await app.request(
      post(`/${harness.roomId}/messages`, { kind: "text", body: "standup in five" }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      message: { authorId: string; body: string; authorName: string };
    };
    expect(body.message).toMatchObject({
      authorId: MEMBER,
      authorName: "Member",
      body: "standup in five",
    });
  });

  it("Given no session, When a message is posted, Then it is refused before the room is touched", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat, { authenticated: false });

    const response = await app.request(
      post(`/${harness.roomId}/messages`, { kind: "text", body: "hello" }),
    );

    expect(response.status).toBe(401);
    expect(harness.published.messages).toEqual([]);
  });

  it("Given a cross-site page, When it posts with the browser's cookie, Then it is refused without looking up the session", async () => {
    const harness = await chatHarness();
    const wired = router(harness.chat);

    const response = await wired.app.request(
      post(
        `/${harness.roomId}/messages`,
        { kind: "text", body: "posted from evil.example" },
        { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      ),
    );

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("FORBIDDEN");
    // A hostile page must not even learn whether the cookie it made the browser
    // attach is still valid.
    expect(wired.lookups()).toBe(0);
    expect(harness.published.messages).toEqual([]);
  });

  it("Given an authenticated stranger, When they post to a room they are not in, Then it is 403", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat, { userId: STRANGER });

    const response = await app.request(
      post(`/${harness.roomId}/messages`, { kind: "text", body: "let me in" }),
    );

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("ACTOR_NOT_MEMBER");
  });

  it("Given a body that names another author, When it is posted, Then it is refused and nothing is attributed to them", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);

    const response = await app.request(
      post(`/${harness.roomId}/messages`, {
        kind: "text",
        body: "I am the host",
        authorId: HOST,
      }),
    );

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("INVALID_REQUEST");
    expect(harness.published.messages).toEqual([]);
  });

  it("Given a quick-chat room, When free text is posted, Then it is one opaque 400", async () => {
    const harness = await chatHarness({ mode: "mode.quick" });
    const { app } = router(harness.chat);

    const response = await app.request(
      post(`/${harness.roomId}/messages`, { kind: "text", body: "unconstrained" }),
    );

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("INVALID_REQUEST");
  });

  it("Given a form post rather than JSON, When it is sent, Then the media type is refused", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);

    const response = await app.request(
      new Request(`http://localhost:3072/${harness.roomId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
        },
        body: "kind=text&body=hello",
      }),
    );

    expect(response.status).toBe(415);
  });

  it("Given a room id that is not id-shaped, When it is posted to, Then it is refused as a bad request", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);

    const response = await app.request(
      post("/..%2F..%2Fetc%2Fpasswd/messages", { kind: "text", body: "traversal" }),
    );

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("INVALID_REQUEST");
  });
});

describe("chat routes — history", () => {
  it("Given messages in a room, When a member reads them, Then the page comes back oldest first", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);
    for (const body of ["first", "second"]) {
      await app.request(post(`/${harness.roomId}/messages`, { kind: "text", body }));
    }

    const response = await app.request(get(`/${harness.roomId}/messages`));

    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      messages: { body: string }[];
      nextCursor: string | null;
    };
    expect(page.messages.map((message) => message.body)).toEqual(["first", "second"]);
    expect(page.nextCursor).toBeNull();
  });

  it("Given a viewer id in the query string, When history is read, Then the session's identity is used instead", async () => {
    const harness = await chatHarness();
    const asMember = router(harness.chat);
    await asMember.app.request(
      post(`/${harness.roomId}/messages`, { kind: "text", body: "members only" }),
    );

    // The session is a stranger; the query string claims to be a member.
    const asStranger = router(harness.chat, { userId: STRANGER });
    const response = await asStranger.app.request(
      get(`/${harness.roomId}/messages?viewerId=${MEMBER}`),
    );

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("ACTOR_NOT_MEMBER");
  });

  it("Given an absurd limit, When history is read, Then it is clamped rather than served", async () => {
    const harness = await chatHarness({ rateLimiters: unlimited() });
    const { app } = router(harness.chat);
    for (let index = 0; index < 60; index += 1) {
      await app.request(
        post(`/${harness.roomId}/messages`, {
          kind: "text",
          body: `line ${String(index)}`,
        }),
      );
    }

    const response = await app.request(get(`/${harness.roomId}/messages?limit=1000000`));

    expect(response.status).toBe(200);
    const page = (await response.json()) as { messages: unknown[] };
    // MAX_CHAT_HISTORY_LIMIT. Without the clamp this is a one-request way to
    // make the server read and serialize a room's entire history.
    expect(page.messages).toHaveLength(50);
  });

  it("Given a junk limit, When history is read, Then the default page size is used", async () => {
    const harness = await chatHarness({ rateLimiters: unlimited() });
    const { app } = router(harness.chat);
    for (let index = 0; index < 40; index += 1) {
      await app.request(
        post(`/${harness.roomId}/messages`, {
          kind: "text",
          body: `line ${String(index)}`,
        }),
      );
    }

    const response = await app.request(
      get(`/${harness.roomId}/messages?limit=not-a-number`),
    );

    const page = (await response.json()) as { messages: unknown[] };
    expect(page.messages).toHaveLength(30);

    // An empty `?limit=` is the same "not specified" as no parameter at all:
    // Number("") is 0, which would otherwise clamp to a one-message page.
    const empty = await app.request(get(`/${harness.roomId}/messages?limit=`));
    const emptyPage = (await empty.json()) as { messages: unknown[] };
    expect(emptyPage.messages).toHaveLength(30);
  });

  it("Given a cursor that is not id-shaped, When history is read, Then it is refused", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);

    const response = await app.request(
      get(`/${harness.roomId}/messages?before=' OR 1=1 --`),
    );

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("INVALID_REQUEST");
  });
});

describe("chat routes — reactions", () => {
  it("Given a message, When a member reacts, Then it is accepted; a second identical click is a conflict", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);
    const created = await app.request(
      post(`/${harness.roomId}/messages`, { kind: "text", body: "react to me" }),
    );
    const { message } = (await created.json()) as { message: { id: string } };

    const body = {
      targetKind: "message",
      targetId: message.id,
      emote: "emote.thumbs-up",
      removed: false,
    };
    const first = await app.request(
      post(`/${harness.roomId}/messages/${message.id}/reactions`, body),
    );
    const second = await app.request(
      post(`/${harness.roomId}/messages/${message.id}/reactions`, body),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe("EMOTE_ALREADY_APPLIED");
  });

  it("Given a reaction whose body names another message, When it is posted, Then the path wins and it is refused", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);
    const created = await app.request(
      post(`/${harness.roomId}/messages`, { kind: "text", body: "the real target" }),
    );
    const { message } = (await created.json()) as { message: { id: string } };

    const response = await app.request(
      post(`/${harness.roomId}/messages/${message.id}/reactions`, {
        targetKind: "message",
        targetId: "some-other-message",
        emote: "emote.fire",
        removed: false,
      }),
    );

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("EMOTE_TARGET_MISMATCH");
  });

  it("Given an unknown emote, When it is posted, Then it is refused", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);
    const created = await app.request(
      post(`/${harness.roomId}/messages`, { kind: "text", body: "emote check" }),
    );
    const { message } = (await created.json()) as { message: { id: string } };

    const response = await app.request(
      post(`/${harness.roomId}/messages/${message.id}/reactions`, {
        targetKind: "message",
        targetId: message.id,
        emote: "emote.<script>alert(1)</script>",
        removed: false,
      }),
    );

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("INVALID_REQUEST");
  });

  it("Given a stranger, When they react to a message, Then it is 403", async () => {
    const harness = await chatHarness();
    const member = router(harness.chat);
    const created = await member.app.request(
      post(`/${harness.roomId}/messages`, { kind: "text", body: "members only" }),
    );
    const { message } = (await created.json()) as { message: { id: string } };

    const stranger = router(harness.chat, { userId: STRANGER });
    const response = await stranger.app.request(
      post(`/${harness.roomId}/messages/${message.id}/reactions`, {
        targetKind: "message",
        targetId: message.id,
        emote: "emote.eyes",
        removed: false,
      }),
    );

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("ACTOR_NOT_MEMBER");
  });
});

describe("chat routes — rate limiting", () => {
  it("Given a member past the default ceiling, When they keep posting, Then they get 429", async () => {
    const harness = await chatHarness();
    const { app } = router(harness.chat);

    const statuses: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      const response = await app.request(
        post(`/${harness.roomId}/messages`, {
          kind: "text",
          body: `flood ${String(index)}`,
        }),
      );
      statuses.push(response.status);
    }

    // CHAT_MESSAGE_RATE_LIMIT: five per ten seconds, and the real clock cannot
    // advance ten seconds inside one loop.
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429, 429]);
  });
});
