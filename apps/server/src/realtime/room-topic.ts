import { ContractValidationError, parseOpaqueId } from "@office-ladder/contracts";

/**
 * A Realtime topic is the opaque room id, never the human join code: plans/11
 * requires the code to stay a credential and never become a topic, so a
 * six-character code shape is rejected outright.
 *
 * Lives in one module because both ends of the transport need the identical
 * rule — the subscribe path (routes/ws.ts, via authorize-room-socket) and the
 * publish path (publish-room-update.ts). Two copies of this regexp is one copy
 * too many: a topic accepted on one side and rejected on the other is a silently
 * dead broadcast.
 */
const OPAQUE_ROOM_TOPIC_PATTERN = /^(?![A-Z0-9]{6}$)[A-Za-z0-9_-]{1,128}$/;

export function parseRoomTopic(value: unknown): string {
  const roomTopic = parseOpaqueId(value, "roomTopic");
  if (!OPAQUE_ROOM_TOPIC_PATTERN.test(roomTopic)) {
    throw new ContractValidationError(
      "roomTopic",
      "must be an opaque Realtime topic, not a room code",
    );
  }

  return roomTopic;
}
