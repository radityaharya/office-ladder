import { Hono } from "hono";

import {
  ContractValidationError,
  parseAddBotRequest,
  parseAvatarUrl,
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseOpaqueId,
  parseRespondToPromptRequest,
  parseRollRequest,
  parseSelectCharacterRequest,
  parseStartGameRequest,
} from "@office-ladder/contracts";
import { requireSession } from "@/auth/require-session";
import { json, parseJson, requireSameOriginMutation } from "@/http";
import { log, logException } from "@/observability/log";
import { publishProjectionUpdate } from "@/realtime/publish-projection-update";
import { botDriver } from "@/rooms/bots/default-driver";
import { shouldDriveBots } from "@/rooms/bots/should-drive";
import { roomService } from "@/rooms/service";
import { commandRejectionLevel } from "@/rooms/service/rejection";
import type { RoomServiceErrorCode } from "@/rooms/service/types";
import { turnTimeoutDriver } from "@/rooms/turn-timer/default-driver";
import { shouldEnforceTurnTimer } from "@/rooms/turn-timer/should-enforce";

export const roomsRouter = new Hono();

function errorResponse(code: string, status: number) {
  return json({ error: { code } }, { status });
}

function serviceErrorResponse(code: string) {
  switch (code) {
    case "ROOM_NOT_FOUND":
    case "ROOM_CODE_NOT_FOUND":
      return errorResponse(code, 404);
    // ACTOR_IS_BOT / ACTOR_NOT_BOT: a session actor naming a bot seat, or the bot
    // driver naming a human member. Neither is reachable from a well-behaved
    // client, and both are a refusal to act as somebody else — 403, not 400.
    case "ACTOR_NOT_HOST":
    case "ACTOR_NOT_MEMBER":
    case "ACTOR_NOT_AUTHORIZED":
    case "ACTOR_IS_BOT":
    case "ACTOR_NOT_BOT":
      return errorResponse(code, 403);
    // ROOM_CODE_UNAVAILABLE: every draw collided with a live room's code.
    // Retryable, and the client's next attempt draws fresh codes.
    // CHARACTER_TAKEN: somebody claimed it first. A conflict with another
    // member's state, not a malformed request — the client re-picks.
    case "ROOM_FULL":
    case "ROOM_NOT_OPEN":
    case "MINIMUM_PLAYERS_NOT_MET":
    case "STALE_REVISION":
    case "LAST_HUMAN_REQUIRED":
    case "ROOM_CODE_UNAVAILABLE":
    case "CHARACTER_TAKEN":
      return errorResponse(code, 409);
    case "MEMBER_NOT_BOT":
      return errorResponse(code, 404);
    // The state could not be represented for storage, so the write was refused
    // rather than persisted lossily. Nothing the caller sent caused it and
    // retrying the same request cannot help — that is a 500, not a 400.
    case "SERIALIZATION_FAILED":
      return errorResponse(code, 500);
    default:
      return errorResponse(code, 400);
  }
}

/**
 * Who was trying to do what. Threaded through every log line a request can
 * emit, so one `grep` on a room id reconstructs the whole attempt without a
 * debugger.
 *
 * `room` is the *raw* path parameter, captured before validation on purpose: "a
 * client keeps sending a malformed room id" is worth being able to see. Raw
 * request input is safe here because the formatter escapes any value that is not
 * plainly id-shaped, so a header or a path segment cannot forge a second line.
 */
type CommandContext = {
  /** Same vocabulary as the log event name: `room.roll`, `room.bot-add`, … */
  readonly command: string;
  readonly room: string | null;
  readonly actor: string | null;
};

function commandContext(
  command: string,
  actor: string | null,
  room?: string | null,
): CommandContext {
  return { command, room: room ?? null, actor };
}

/**
 * A rejection the service returned as a value. The level comes from the code
 * (rooms/service/rejection.ts): a stale revision from a double-click is `info`,
 * an `INVARIANT_VIOLATION` is our own bug and is `warn`.
 */
function rejected(context: CommandContext, code: RoomServiceErrorCode): Response {
  log(commandRejectionLevel(code), "command.rejected", { ...context, code });
  return serviceErrorResponse(code);
}

/**
 * A committed mutation — the only success line in this file. Roughly one per
 * player action, which for a turn-based board game is nowhere near spam, and it
 * is the difference between being able to reconstruct a match afterwards and
 * not. The polled GET bootstrap deliberately has no equivalent.
 */
function applied(context: CommandContext, revision: number, gameRevision?: number): void {
  log("info", "command.applied", { ...context, revision, gameRevision });
}

/**
 * The one place a thrown error inside a handler can still be seen.
 *
 * Every handler used to end in `catch (error) { … return 500 }` that discarded
 * `error` entirely, so a Postgres outage, a malformed BETTER_AUTH_EXTRA_ORIGINS
 * and projections.ts's "Active room is missing its canonical game" all produced
 * one identical opaque 500 with no trace anywhere in the process. The responses
 * are deliberately unchanged — a client must not learn internals — but they are
 * no longer the only record.
 */
async function handled(
  context: CommandContext,
  run: () => Promise<Response>,
): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ContractValidationError) {
      log("info", "command.invalid-request", {
        ...context,
        field: error.path,
        reason: error.reason,
      });
      return errorResponse("INVALID_REQUEST", 400);
    }

    logException("error", "command.failed", error, context);
    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
}

/**
 * Everything that has to happen after a game command commits: tell the clients,
 * then give both server-side actors a chance to move the match on.
 *
 * The two drivers are kicked together on purpose. Each is idempotent and
 * per-room serialized, so a kick that has nothing to do is one repository read;
 * a kick that is *missed* is a match that sits still until somebody's next poll.
 * The bot driver takes over when the new active player is a bot; the timeout
 * driver arms the clock when it is a human, and enforces it when it runs out.
 */
async function announce(roomId: string, revision: number, messageId: string): Promise<void> {
  await publishProjectionUpdate(roomId, revision, messageId);
  botDriver.schedule(roomId);
  turnTimeoutDriver.schedule(roomId);
}

/**
 * A cross-origin mutation attempt is rare and security-relevant, so unlike the
 * very common expired-session 401 it is reported rather than merely refused.
 */
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

roomsRouter.post("/", async (c) => {
  const blocked = originRejection(c.req.raw, "room.create");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext("room.create", session.value.user.id);
  return handled(context, async () => {
    const input = parseCreateRoomRequest(body.value);
    const result = await roomService.create({
      hostId: session.value.user.id,
      playerName: input.playerName,
      modeId: input.mode,
      capacity: input.capacity,
      characterId: input.characterId,
      // Captured from the session's own user row, never from the request body: a
      // client must not be able to name somebody else's picture, or any picture.
      avatarUrl: parseAvatarUrl(session.value.user.image),
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied({ ...context, room: result.value.id }, result.value.revision);
    return json({ room: { id: result.value.id } }, { status: 201 });
  });
});

roomsRouter.post("/join", async (c) => {
  const blocked = originRejection(c.req.raw, "room.join");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  // No room id yet, and deliberately no room *code* either: the code is a join
  // credential and must never be written to a log.
  const context = commandContext("room.join", session.value.user.id);
  return handled(context, async () => {
    const input = parseJoinRoomRequest(body.value);
    const result = await roomService.joinByCode({
      roomCode: input.roomCode,
      actorId: session.value.user.id,
      playerName: input.playerName,
      characterId: input.characterId,
      avatarUrl: parseAvatarUrl(session.value.user.image),
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied({ ...context, room: result.value.id }, result.value.revision);
    return json({ room: { id: result.value.id } });
  });
});

roomsRouter.get("/:roomId", async (c) => {
  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  // Read-only, and polled every ~5s per connected client: this handler logs
  // nothing on success, by design. Only a rejection or a throw earns a line.
  const context = commandContext(
    "room.bootstrap",
    session.value.user.id,
    c.req.param("roomId"),
  );
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const result = await roomService.bootstrap({ roomId, viewerId: session.value.user.id });

    if (!result.ok) return rejected(context, result.error.code);

    // Self-healing: both drivers keep their scheduling state in memory only, so a
    // restart while a bot was the active player would otherwise wedge the match
    // forever, and a restart mid-turn would leave a deadline nothing enforces. Any
    // client loading or polling the room revives whichever one applies, but only
    // while the game is genuinely still running (see shouldDriveBots — a finished
    // match keeps naming a player as active). Neither can storm: the per-room
    // in-flight map collapses concurrent kicks into a single pass.
    if (shouldDriveBots(result.value)) botDriver.schedule(roomId);
    if (shouldEnforceTurnTimer(result.value)) turnTimeoutDriver.schedule(roomId);
    return json(result.value);
  });
});

roomsRouter.post("/:roomId/start", async (c) => {
  const blocked = originRejection(c.req.raw, "room.start");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext("room.start", session.value.user.id, c.req.param("roomId"));
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseStartGameRequest(body.value);
    const result = await roomService.start({
      roomId,
      actorId: session.value.user.id,
      // The actor came from a Better Auth session, so it is a human by
      // construction — the service refuses to let one act as a bot seat.
      actorKind: "human",
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied(context, result.value.revision, result.value.game.revision);
    await announce(roomId, result.value.revision, input.commandId);
    return json({ room: { id: result.value.id, revision: result.value.revision } });
  });
});

roomsRouter.post("/:roomId/roll", async (c) => {
  const blocked = originRejection(c.req.raw, "room.roll");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext("room.roll", session.value.user.id, c.req.param("roomId"));
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseRollRequest(body.value);
    const result = await roomService.roll({
      roomId,
      actorId: session.value.user.id,
      actorKind: "human",
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied(context, result.value.revision, result.value.game.revision);
    await announce(roomId, result.value.revision, input.commandId);
    return json({ room: { id: result.value.id, revision: result.value.revision } });
  });
});

roomsRouter.post("/:roomId/respond", async (c) => {
  const blocked = originRejection(c.req.raw, "room.respond");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext("room.respond", session.value.user.id, c.req.param("roomId"));
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseRespondToPromptRequest(body.value);
    const result = await roomService.respondToPrompt({
      roomId,
      actorId: session.value.user.id,
      actorKind: "human",
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
      decisionPointId: input.decisionPointId,
      optionId: input.optionId,
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied(context, result.value.revision, result.value.game.revision);
    await announce(roomId, result.value.revision, input.commandId);
    return json({ room: { id: result.value.id, revision: result.value.revision } });
  });
});

/**
 * Re-picking a character in the lobby.
 *
 * PUT because it is idempotent — the body states the whole of the actor's choice,
 * so a retried request cannot end up meaning something different. The actor is
 * always the session's own member: there is no `memberId` in the path or the body,
 * which is what makes it impossible to set somebody else's character.
 *
 * Answers 409 CHARACTER_TAKEN when another member already holds it. That is
 * deliberately stricter than create/join, where a taken character is quietly
 * dropped rather than costing a player their seat: here the picker is on screen,
 * so an explicit refusal is something the player can act on immediately.
 */
roomsRouter.put("/:roomId/character", async (c) => {
  const blocked = originRejection(c.req.raw, "room.character");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext(
    "room.character",
    session.value.user.id,
    c.req.param("roomId"),
  );
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseSelectCharacterRequest(body.value);
    const result = await roomService.selectCharacter({
      roomId,
      actorId: session.value.user.id,
      characterId: input.characterId,
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied(context, result.value.revision);
    // The affected member is the message id, exactly like a bot seat change: a
    // character claim has no client-supplied commandId of its own.
    await publishProjectionUpdate(roomId, result.value.revision, session.value.user.id);
    return json({
      room: { id: result.value.id, revision: result.value.revision },
      character: { memberId: session.value.user.id, characterId: input.characterId },
    });
  });
});

// Bots are ordinary members, so adding one bumps the room revision exactly
// like a human join and the lobby projection carries isBot/botDifficulty. The
// broadcast messageId is the affected member id — bot seat changes have no
// client-supplied commandId of their own.
roomsRouter.post("/:roomId/bots", async (c) => {
  const blocked = originRejection(c.req.raw, "room.bot-add");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  const context = commandContext("room.bot-add", session.value.user.id, c.req.param("roomId"));
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseAddBotRequest(body.value);
    const result = await roomService.addBot({
      roomId,
      actorId: session.value.user.id,
      difficulty: input.difficulty,
    });

    if (!result.ok) return rejected(context, result.error.code);

    const added = result.value.bots[result.value.bots.length - 1];
    if (added === undefined) {
      // addBot committed a new revision but the room came back without the seat
      // it just added. The room *has* been mutated, so the bare 500 this used to
      // return left the client and the stored room disagreeing, with nothing
      // anywhere to say why.
      log("error", "room.bot-seat-missing", {
        ...context,
        revision: result.value.revision,
        seats: result.value.bots.length,
      });
      return errorResponse("INTERNAL_SERVER_ERROR", 500);
    }

    applied({ ...context, actor: added.playerId }, result.value.revision);
    await publishProjectionUpdate(roomId, result.value.revision, added.playerId);
    return json(
      {
        room: { id: result.value.id, revision: result.value.revision },
        bot: {
          memberId: added.playerId,
          displayName: result.value.memberNames[added.playerId] ?? added.playerId,
          difficulty: added.difficulty,
        },
      },
      { status: 201 },
    );
  });
});

roomsRouter.delete("/:roomId/bots/:memberId", async (c) => {
  const blocked = originRejection(c.req.raw, "room.bot-remove");
  if (blocked !== null) return blocked;

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const context = commandContext(
    "room.bot-remove",
    session.value.user.id,
    c.req.param("roomId"),
  );
  return handled(context, async () => {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const memberId = parseOpaqueId(c.req.param("memberId"), "memberId");
    const result = await roomService.removeBot({
      roomId,
      actorId: session.value.user.id,
      memberId,
    });

    if (!result.ok) return rejected(context, result.error.code);

    applied({ ...context, actor: memberId }, result.value.revision);
    await publishProjectionUpdate(roomId, result.value.revision, memberId);
    return json({
      room: { id: result.value.id, revision: result.value.revision },
      bot: { memberId },
    });
  });
});
