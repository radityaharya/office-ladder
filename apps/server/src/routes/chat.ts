/**
 * Chat endpoints (spec §11.2).
 *
 * ```
 * GET  /api/rooms/:roomId/messages?before=<cursor>&limit=<n>
 * POST /api/rooms/:roomId/messages
 * POST /api/rooms/:roomId/messages/:messageId/reactions
 * ```
 *
 * Mounted on the same `/api/rooms` base as `roomsRouter`. Hono merges a
 * sub-app's routes into the parent's table at `app.route(...)`, so two routers
 * sharing a base coexist — neither shadows the other, and `/:roomId` in
 * `roomsRouter` cannot match a two-segment path here.
 *
 * **Not a command.** None of this goes through the command endpoint, the drain
 * scheduler, the revision predicate or the engine: chat has no `commandId`, no
 * `expectedRevision` and no effect on `GameState`, so routing it through
 * machinery built to serialize game writes would give it all of that
 * machinery's failure modes and none of its benefits.
 *
 * The division of labour with the service is the one §11.1 sets out for
 * commands and is worth keeping identical here: **this file establishes
 * identity** — a valid session, a same-origin mutation, and an actor id taken
 * from the session and from nowhere else — and **the service decides
 * entitlement**: membership, chat mode, rate limit, and everything about the
 * body. A client-supplied author id would be the whole vulnerability, so there
 * is no field anywhere in these handlers that could carry one.
 */
import { Hono } from "hono";

import { ContractValidationError, parseOpaqueId } from "@office-ladder/contracts";
import { requireSession } from "@/auth/require-session";
import type { HttpResult } from "@/http";
import { json, parseJson, requireSameOriginMutation } from "@/http";
import { log, logException } from "@/observability/log";
import { chatService } from "@/rooms/chat/default-service";
import { clampHistoryLimit } from "@/rooms/chat/chat-service";
import type { ChatErrorCode, ChatService } from "@/rooms/chat/types";

type SessionIdentity = { readonly user: { readonly id: string } };

export type ChatRouterDependencies = {
  readonly requireSession: (headers: Headers) => Promise<HttpResult<SessionIdentity>>;
  readonly chatService: ChatService;
};

function errorResponse(code: string, status: number): Response {
  return json({ error: { code } }, { status });
}

/**
 * One rejection shape for every chat refusal, mapped from the service's own
 * codes — the same property §11.1 requires of commands, for the same reason: a
 * client must be able to render a refusal without a per-endpoint table.
 *
 * `ROOM_NOT_FOUND` answers 404 while `ACTOR_NOT_MEMBER` answers 403, which does
 * let a caller distinguish "no such room" from "not your room". That oracle is
 * pre-existing and identical on `GET /api/rooms/:roomId`; collapsing it here
 * alone would buy nothing and make two endpoints disagree about the same room.
 */
function chatErrorResponse(code: ChatErrorCode): Response {
  switch (code) {
    case "ROOM_NOT_FOUND":
    case "MESSAGE_NOT_FOUND":
      return errorResponse(code, 404);
    case "ACTOR_NOT_MEMBER":
    case "ACTOR_IS_BOT":
    case "ACTOR_NOT_BOT":
    case "CHAT_DISABLED":
    case "CHAT_TEXT_NOT_ALLOWED":
    case "EMOTE_REACTIONS_DISABLED":
      return errorResponse(code, 403);
    case "EMOTE_ALREADY_APPLIED":
    case "EMOTE_LIMIT_REACHED":
      return errorResponse(code, 409);
    // 429 with no Retry-After: the window is a few seconds and telling a
    // flooding client exactly when to come back is help it does not need.
    case "RATE_LIMITED":
      return errorResponse(code, 429);
    case "INVALID_CURSOR":
    case "EMOTE_TARGET_MISMATCH":
      return errorResponse(code, 400);
  }
}

type ChatContext = {
  readonly command: string;
  readonly room: string | null;
  readonly actor: string | null;
};

/**
 * Mirrors `routes/rooms.ts`'s `handled`: a `ContractValidationError` is the
 * caller's malformed body and becomes one opaque 400, and anything else is our
 * fault, is reported with a stack, and becomes a 500 that says nothing.
 */
async function handled(
  context: ChatContext,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ContractValidationError) {
      log("info", "chat.invalid-request", {
        ...context,
        field: error.path,
        reason: error.reason,
      });
      return errorResponse("INVALID_REQUEST", 400);
    }

    logException("error", "chat.failed", error, context);
    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
}

function originRejection(request: Request, command: string): Response | null {
  const origin = requireSameOriginMutation(request);
  if (origin.ok) return null;

  log("warn", "http.origin-rejected", {
    command,
    origin: request.headers.get("origin"),
    fetchSite: request.headers.get("sec-fetch-site"),
  });
  return errorResponse(origin.error.code, origin.error.status);
}

export function createChatRouter(deps: ChatRouterDependencies): Hono {
  const router = new Hono();

  router.get("/:roomId/messages", async (c) => {
    const session = await deps.requireSession(c.req.raw.headers);
    if (!session.ok) return errorResponse(session.error.code, session.error.status);

    const context: ChatContext = {
      command: "chat.history",
      room: c.req.param("roomId"),
      actor: session.value.user.id,
    };
    return handled(context, async () => {
      const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
      const before = c.req.query("before");
      const result = await deps.chatService.history({
        roomId,
        // Never from the query string, never from the body: the viewer is
        // whoever the session says it is, and a `?viewerId=` would be a
        // one-parameter impersonation of every other member.
        viewerId: session.value.user.id,
        before: before === undefined ? null : parseOpaqueId(before, "before"),
        limit: clampHistoryLimit(c.req.query("limit")),
      });

      if (!result.ok) return chatErrorResponse(result.error.code);
      return json(result.value);
    });
  });

  router.post("/:roomId/messages", async (c) => {
    const blocked = originRejection(c.req.raw, "chat.send");
    if (blocked !== null) return blocked;

    const session = await deps.requireSession(c.req.raw.headers);
    if (!session.ok) return errorResponse(session.error.code, session.error.status);

    const body = await parseJson(c.req.raw);
    if (!body.ok) return errorResponse(body.error.code, body.error.status);

    const context: ChatContext = {
      command: "chat.send",
      room: c.req.param("roomId"),
      actor: session.value.user.id,
    };
    return handled(context, async () => {
      const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
      const result = await deps.chatService.send({
        roomId,
        actorId: session.value.user.id,
        // A Better Auth session produced this id, so it is a human by
        // construction. The service refuses to let one act as a bot seat.
        actorKind: "human",
        body: body.value,
      });

      if (!result.ok) return chatErrorResponse(result.error.code);
      return json({ message: result.value }, { status: 201 });
    });
  });

  router.post("/:roomId/messages/:messageId/reactions", async (c) => {
    const blocked = originRejection(c.req.raw, "chat.react");
    if (blocked !== null) return blocked;

    const session = await deps.requireSession(c.req.raw.headers);
    if (!session.ok) return errorResponse(session.error.code, session.error.status);

    const body = await parseJson(c.req.raw);
    if (!body.ok) return errorResponse(body.error.code, body.error.status);

    const context: ChatContext = {
      command: "chat.react",
      room: c.req.param("roomId"),
      actor: session.value.user.id,
    };
    return handled(context, async () => {
      const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
      const messageId = parseOpaqueId(c.req.param("messageId"), "messageId");
      const result = await deps.chatService.react({
        roomId,
        actorId: session.value.user.id,
        actorKind: "human",
        messageId,
        body: body.value,
      });

      if (!result.ok) return chatErrorResponse(result.error.code);
      return json({ reaction: result.value });
    });
  });

  return router;
}

/**
 * The wired router. `app.ts` mounts it with:
 *
 * ```ts
 * app.route("/api/rooms", chatRouter);
 * ```
 */
export const chatRouter: Hono = createChatRouter({ requireSession, chatService });
