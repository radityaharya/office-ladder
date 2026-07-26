import { log, logException } from "@/observability/log";
import { publishRoomUpdate } from "./publish-room-update";

/**
 * The room id *is* the Realtime topic: `apps/web`'s subscribeRoomUpdates()
 * connects to /ws/rooms/:roomTopic with the room id, and a randomUUID room id
 * satisfies both parseOpaqueId and publish-room-update's
 * opaqueRoomTopicPattern. The revision returned by the mutation that just
 * committed is the same number a bootstrap would report, so no extra read is
 * needed here.
 *
 * Lives in its own module so both the HTTP routes and the bot driver can push
 * updates without the routes and the room/bot singletons importing each other.
 *
 * Never throws and never rejects: the command it announces is already committed,
 * so a failed broadcast must not fail the request or abandon the remaining bot
 * turns — clients still poll. It is reported rather than discarded, because a
 * rejected payload drops the broadcast entirely, which is precisely the
 * silently-dead realtime path this helper exists to fix.
 */
export async function publishProjectionUpdate(
  roomId: string,
  revision: number,
  messageId: string,
): Promise<void> {
  try {
    const result = await publishRoomUpdate({
      roomTopic: roomId,
      update: {
        kind: "projection-updated",
        messageId,
        aggregateVersion: revision,
        projectionRevision: revision,
        changed: [
          "room",
          "game",
          "players",
          "prompts",
          "reactions",
          "legal-actions",
          "history",
        ],
      },
    });
    if (!result.ok) {
      // The payload this function built itself was refused, so *no* client was
      // told the command landed. Nothing retries this — the room is silently
      // stale until somebody's next poll.
      log("error", "realtime.publish-rejected", {
        room: roomId,
        revision,
        message: messageId,
        reason: result.error.kind,
      });
      return;
    }
  } catch (error) {
    logException("error", "realtime.publish-failed", error, {
      room: roomId,
      revision,
      message: messageId,
    });
  }
}
