import {
  ContractValidationError,
  parseOpaqueId,
} from "@office-ladder/contracts";
import { parseProjectionUpdated } from "@office-ladder/contracts";
import type { ProjectionUpdated } from "@office-ladder/contracts";
import { broadcastToRoom } from "./ws-hub";

const opaqueRoomTopicPattern = /^(?![A-Z0-9]{6}$)[A-Za-z0-9_-]{1,128}$/;

export type PublishRoomUpdateInput = {
  readonly roomTopic: string;
  readonly update: ProjectionUpdated;
};

export type PublishRoomUpdateResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "invalid_room_topic" }
        | { readonly kind: "invalid_projection_update" };
    };

function parseOpaqueRoomTopic(roomTopic: string): string {
  const opaqueRoomTopic = parseOpaqueId(roomTopic, "roomTopic");
  if (!opaqueRoomTopicPattern.test(opaqueRoomTopic)) {
    throw new ContractValidationError(
      "roomTopic",
      "must be an opaque Realtime topic, not a room code",
    );
  }

  return opaqueRoomTopic;
}

export async function publishRoomUpdate(
  input: PublishRoomUpdateInput,
): Promise<PublishRoomUpdateResult> {
  let opaqueRoomTopic: string;
  try {
    opaqueRoomTopic = parseOpaqueRoomTopic(input.roomTopic);
  } catch (error) {
    if (!(error instanceof ContractValidationError)) {
      throw error;
    }

    return { ok: false, error: { kind: "invalid_room_topic" } };
  }

  let update: ProjectionUpdated;
  try {
    update = parseProjectionUpdated(input.update);
  } catch (error) {
    if (!(error instanceof ContractValidationError)) {
      throw error;
    }

    return { ok: false, error: { kind: "invalid_projection_update" } };
  }

  broadcastToRoom(opaqueRoomTopic, update);
  return { ok: true };
}
