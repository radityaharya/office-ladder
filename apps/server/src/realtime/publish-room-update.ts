import { ContractValidationError } from "@office-ladder/contracts";
import { parseProjectionUpdated } from "@office-ladder/contracts";
import type { ProjectionUpdated } from "@office-ladder/contracts";
import { log } from "@/observability/log";
import { parseRoomTopic } from "./room-topic";
import {
  broadcastToRoom,
  broadcastToRoomPerSubscriber,
  type BroadcastStats,
  type PerSubscriberMessageBuilder,
} from "./ws-hub";

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

export type PublishPerSocketInput = {
  readonly roomTopic: string;
  /**
   * Called once per distinct authenticated subscriber. Whatever it returns is
   * what that viewer — and only that viewer — receives.
   */
  readonly build: PerSubscriberMessageBuilder;
  /** Names the fan-out in the log line, e.g. the messageId that caused it. */
  readonly messageId: string;
};

export type PublishPerSocketResult =
  | { readonly ok: true; readonly value: BroadcastStats }
  | {
      readonly ok: false;
      readonly error: { readonly kind: "invalid_room_topic" };
    };

/**
 * The per-socket sibling of `publishRoomUpdate`.
 *
 * Same topic rule (the opaque room id, never the join code), different delivery
 * contract: nothing here is a single validated payload, because there is no
 * single payload — each viewer gets what that viewer is entitled to. Payload
 * validation therefore belongs to whoever builds it; this function owns the
 * topic and the measurement.
 *
 * The measurement is the point of `elapsedMs`. A per-viewer projection is O(N)
 * work on a fan-out that used to be O(1), and a reaction window opening makes
 * every seated client react at once (spec §11.4) — so the cost has to be
 * observable rather than argued about. Debug level for the same reason
 * `realtime.published` is: one line per committed command per room is noise
 * until the moment you need it.
 *
 * **Measured, on this repo, at the maximum table size.** Building and
 * serialising `projectPlayerView` for all six seats of a six-player match costs
 * 0.33–0.47 ms per fan-out on a freshly started game and 0.56–0.96 ms with every
 * v2 collection populated (six projects with six contributions and six sabotage
 * entries each, twelve placements, six agreements, twelve objectives, six sealed
 * ballots). The single shared payload it replaces cost 0.09–0.23 ms. So the CPU
 * multiplier is real and is roughly 3–5x, and it does not matter at six players:
 * under a millisecond per committed command, against a repository read on the
 * same path that costs milliseconds on its own. The number that grows fastest is
 * bytes, not time — 9.4 KB per viewer early, 19.6 KB per viewer on a loaded
 * table, so ~118 KB of frames per command across six seats. If that ever becomes
 * the problem, the fix is a diff rather than a whole projection per push, not a
 * return to one shared payload.
 */
export async function publishRoomUpdatePerSocket(
  input: PublishPerSocketInput,
): Promise<PublishPerSocketResult> {
  let opaqueRoomTopic: string;
  try {
    opaqueRoomTopic = parseRoomTopic(input.roomTopic);
  } catch (error) {
    if (!(error instanceof ContractValidationError)) {
      throw error;
    }

    return { ok: false, error: { kind: "invalid_room_topic" } };
  }

  const startedAt = performance.now();
  const stats = broadcastToRoomPerSubscriber(opaqueRoomTopic, input.build);
  log("debug", "realtime.published-per-socket", {
    topic: opaqueRoomTopic,
    message: input.messageId,
    recipients: stats.recipients,
    viewers: stats.viewers,
    messages: stats.messages,
    elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
  });
  return { ok: true, value: stats };
}
