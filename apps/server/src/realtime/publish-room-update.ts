import { ContractValidationError } from "@office-ladder/contracts";
import { parseProjectionUpdated } from "@office-ladder/contracts";
import type { ProjectionUpdated } from "@office-ladder/contracts";
import { log } from "@/observability/log";
import { parseRoomTopic } from "./room-topic";
import { broadcastToRoom } from "./ws-hub";

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

export async function publishRoomUpdate(
  input: PublishRoomUpdateInput,
): Promise<PublishRoomUpdateResult> {
  let opaqueRoomTopic: string;
  try {
    opaqueRoomTopic = parseRoomTopic(input.roomTopic);
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

  const recipients = broadcastToRoom(opaqueRoomTopic, update);
  // `debug`, not `info`: zero recipients is legitimate and common (the host
  // publishes the start of a match before anyone's socket is open), so a line
  // per broadcast would be noise on every busy room. It is here because
  // "recipients is always 0" is the signature of dead realtime, and turning
  // LOG_LEVEL=debug for a minute is the cheapest way to confirm or clear that.
  log("debug", "realtime.published", {
    topic: opaqueRoomTopic,
    revision: update.projectionRevision,
    message: update.messageId,
    recipients,
  });
  return { ok: true };
}
