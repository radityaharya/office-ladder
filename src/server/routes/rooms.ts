import { Hono } from "hono";

import {
  ContractValidationError,
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseOpaqueId,
  parseRollRequest,
  parseStartGameRequest,
} from "@/contracts";
import { requireSession } from "@/server/auth/require-session";
import { json, parseJson, requireSameOriginMutation } from "@/server/http";
import { publishRoomUpdate } from "@/server/realtime/publish-room-update";
import { roomService } from "@/server/rooms/service";

export const roomsRouter = new Hono();

function errorResponse(code: string, status: number) {
  return json({ error: { code } }, { status });
}

function serviceErrorResponse(code: string) {
  switch (code) {
    case "ROOM_NOT_FOUND":
    case "ROOM_CODE_NOT_FOUND":
      return errorResponse(code, 404);
    case "ACTOR_NOT_HOST":
    case "ACTOR_NOT_MEMBER":
    case "ACTOR_NOT_AUTHORIZED":
      return errorResponse(code, 403);
    case "ROOM_FULL":
    case "ROOM_NOT_OPEN":
    case "MINIMUM_PLAYERS_NOT_MET":
    case "STALE_REVISION":
      return errorResponse(code, 409);
    default:
      return errorResponse(code, 400);
  }
}

async function publishUpdateIfAvailable(
  roomId: string,
  viewerId: string,
  messageId: string,
): Promise<void> {
  const bootstrap = await roomService.bootstrap({ roomId, viewerId }).catch(() => null);
  if (bootstrap === null || !bootstrap.ok) {
    return;
  }

  const { value } = bootstrap;
  const roomTopic =
    "roomTopic" in value && typeof value.roomTopic === "string" ? value.roomTopic : null;
  if (roomTopic === null) {
    return;
  }

  await publishRoomUpdate({
    roomTopic,
    update: {
      kind: "projection-updated",
      messageId,
      aggregateVersion: value.room.revision,
      projectionRevision: value.room.revision,
      changed: ["room", "game", "players", "prompts", "reactions", "legal-actions", "history"],
    },
  }).catch(() => undefined);
}

roomsRouter.post("/", async (c) => {
  const origin = requireSameOriginMutation(c.req.raw);
  if (!origin.ok) return errorResponse(origin.error.code, origin.error.status);

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  try {
    const input = parseCreateRoomRequest(body.value);
    const result = await roomService.create({
      hostId: session.value.user.id,
      modeId: input.mode,
      capacity: input.capacity,
    });

    if (!result.ok) return serviceErrorResponse(result.error.code);
    return json({ room: { id: result.value.id } }, { status: 201 });
  } catch (error) {
    if (error instanceof ContractValidationError) return errorResponse("INVALID_REQUEST", 400);
    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
});

roomsRouter.post("/join", async (c) => {
  const origin = requireSameOriginMutation(c.req.raw);
  if (!origin.ok) return errorResponse(origin.error.code, origin.error.status);

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  try {
    const input = parseJoinRoomRequest(body.value);
    const result = await roomService.joinByCode({
      roomCode: input.roomCode,
      actorId: session.value.user.id,
    });

    if (!result.ok) return serviceErrorResponse(result.error.code);
    return json({ room: { id: result.value.id } });
  } catch (error) {
    if (error instanceof ContractValidationError) return errorResponse("INVALID_REQUEST", 400);
    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
});

roomsRouter.get("/:roomId", async (c) => {
  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  try {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const result = await roomService.bootstrap({ roomId, viewerId: session.value.user.id });

    if (!result.ok) return serviceErrorResponse(result.error.code);
    return json(result.value);
  } catch (error) {
    if (error instanceof ContractValidationError) return errorResponse("INVALID_REQUEST", 400);
    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
});

roomsRouter.post("/:roomId/start", async (c) => {
  const origin = requireSameOriginMutation(c.req.raw);
  if (!origin.ok) return errorResponse(origin.error.code, origin.error.status);

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  try {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseStartGameRequest(body.value);
    const result = await roomService.start({
      roomId,
      actorId: session.value.user.id,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
    });

    if (!result.ok) return serviceErrorResponse(result.error.code);

    await publishUpdateIfAvailable(roomId, session.value.user.id, input.commandId);
    return json({ room: { id: result.value.id, revision: result.value.revision } });
  } catch (error) {
    if (error instanceof ContractValidationError) return errorResponse("INVALID_REQUEST", 400);
    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
});

roomsRouter.post("/:roomId/roll", async (c) => {
  const origin = requireSameOriginMutation(c.req.raw);
  if (!origin.ok) return errorResponse(origin.error.code, origin.error.status);

  const session = await requireSession(c.req.raw.headers);
  if (!session.ok) return errorResponse(session.error.code, session.error.status);

  const body = await parseJson(c.req.raw);
  if (!body.ok) return errorResponse(body.error.code, body.error.status);

  try {
    const roomId = parseOpaqueId(c.req.param("roomId"), "roomId");
    const input = parseRollRequest(body.value);
    const result = await roomService.roll({
      roomId,
      actorId: session.value.user.id,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
    });

    if (!result.ok) return serviceErrorResponse(result.error.code);

    await publishUpdateIfAvailable(roomId, session.value.user.id, input.commandId);
    return json({ room: { id: result.value.id, revision: result.value.revision } });
  } catch (error) {
    if (error instanceof ContractValidationError) return errorResponse("INVALID_REQUEST", 400);
    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
});
