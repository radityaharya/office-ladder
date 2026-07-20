import {
  ContractValidationError,
  parseOpaqueId,
} from "@/contracts/rooms";
import { parseProjectionUpdated } from "@/contracts/realtime";
import type { ProjectionUpdated } from "@/contracts/realtime";

const opaqueRoomTopicPattern = /^(?![A-Z0-9]{6}$)[A-Za-z0-9_-]{1,128}$/;

/**
 * Realtime carries invalidations only. HTTP bootstrap remains the authority for
 * the projection state corresponding to a received update.
 */
export type RoomProjectionUpdateCallback = (
  update: ProjectionUpdated,
) => void;

export type RoomUpdatesCleanup = () => Promise<void>;

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

function socketUrl(roomTopic: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/rooms/${roomTopic}`;
}

const RECONNECT_DELAY_MS = 1500;

export function subscribeRoomUpdates(
  roomTopic: string,
  callback: RoomProjectionUpdateCallback,
): RoomUpdatesCleanup {
  const opaqueRoomTopic = parseOpaqueRoomTopic(roomTopic);

  let latestRevision = -1;
  let closedByCaller = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    socket = new WebSocket(socketUrl(opaqueRoomTopic));

    socket.addEventListener("message", (event) => {
      try {
        const payload: unknown = JSON.parse(String(event.data));
        const update = parseProjectionUpdated(payload);
        if (update.projectionRevision <= latestRevision) {
          return;
        }

        latestRevision = update.projectionRevision;
        callback(update);
      } catch (error) {
        if (!(error instanceof ContractValidationError)) {
          throw error;
        }
      }
    });

    socket.addEventListener("close", () => {
      if (closedByCaller) return;
      reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });
  }

  connect();

  return async () => {
    closedByCaller = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
    }
    socket?.close();
  };
}
