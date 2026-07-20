import {
  ContractValidationError,
  parseOpaqueId,
  parseStartGameRequest,
} from "@/contracts";
import { requireSession } from "@/server/auth/require-session";
import {
  json,
  parseJson,
  requireSameOriginMutation,
} from "@/server/http";
import { publishRoomUpdate } from "@/server/realtime/publish-room-update";
import { roomService } from "@/server/rooms/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly roomId: string }> },
): Promise<Response> {
  const origin = requireSameOriginMutation(request);
  if (!origin.ok) {
    return errorResponse(origin.error.code, origin.error.status);
  }

  const session = await requireSession(request.headers);
  if (!session.ok) {
    return errorResponse(session.error.code, session.error.status);
  }

  const body = await parseJson(request);
  if (!body.ok) {
    return errorResponse(body.error.code, body.error.status);
  }

  try {
    const { roomId: rawRoomId } = await context.params;
    const roomId = parseOpaqueId(rawRoomId, "roomId");
    const input = parseStartGameRequest(body.value);
    const result = await roomService.start({
      roomId,
      actorId: session.value.user.id,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
    });

    if (!result.ok) {
      return serviceErrorResponse(result.error.code);
    }

    await publishUpdateIfAvailable(
      roomId,
      session.value.user.id,
      input.commandId,
    );
    return json({ room: { id: result.value.id, revision: result.value.revision } });
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return errorResponse("INVALID_REQUEST", 400);
    }

    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
}

async function publishUpdateIfAvailable(
  roomId: string,
  viewerId: string,
  messageId: string,
): Promise<void> {
  const bootstrap = await roomService
    .bootstrap({ roomId, viewerId })
    .catch(() => null);
  if (bootstrap === null) {
    return;
  }
  if (!bootstrap.ok) {
    return;
  }

  const { value } = bootstrap;
  const roomTopic =
    "roomTopic" in value && typeof value.roomTopic === "string"
      ? value.roomTopic
      : null;
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

function errorResponse(code: string, status: number): Response {
  return json({ error: { code } }, { status });
}

function serviceErrorResponse(code: string): Response {
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
