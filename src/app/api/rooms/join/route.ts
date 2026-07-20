import {
  ContractValidationError,
  parseJoinRoomRequest,
} from "@/contracts";
import { requireSession } from "@/server/auth/require-session";
import {
  json,
  parseJson,
  requireSameOriginMutation,
} from "@/server/http";
import { roomService } from "@/server/rooms/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
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
    const input = parseJoinRoomRequest(body.value);
    const result = await roomService.joinByCode({
      roomCode: input.roomCode,
      actorId: session.value.user.id,
    });

    if (!result.ok) {
      return serviceErrorResponse(result.error.code);
    }

    return json({ room: { id: result.value.id } });
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return errorResponse("INVALID_REQUEST", 400);
    }

    return errorResponse("INTERNAL_SERVER_ERROR", 500);
  }
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
