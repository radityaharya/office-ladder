import type { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";

import { ContractValidationError, parseOpaqueId } from "@/contracts/rooms";
import { requireSession } from "@/server/auth/require-session";
import { registerRoomSocket } from "@/server/realtime/ws-hub";

const opaqueRoomTopicPattern = /^(?![A-Z0-9]{6}$)[A-Za-z0-9_-]{1,128}$/;

export function registerWebSocketRoutes(app: Hono): void {
  app.get(
    "/ws/rooms/:roomTopic",
    upgradeWebSocket((c) => {
      let unregister: (() => void) | null = null;

      return {
        async onOpen(_event, ws) {
          const session = await requireSession(c.req.raw.headers);
          if (!session.ok) {
            ws.close(1008, "unauthorized");
            return;
          }

          let roomTopic: string;
          try {
            roomTopic = parseOpaqueId(c.req.param("roomTopic"), "roomTopic");
            if (!opaqueRoomTopicPattern.test(roomTopic)) {
              throw new ContractValidationError(
                "roomTopic",
                "must be an opaque Realtime topic, not a room code",
              );
            }
          } catch {
            ws.close(1008, "invalid room topic");
            return;
          }

          unregister = registerRoomSocket(roomTopic, ws);
        },
        onClose() {
          unregister?.();
        },
      };
    }),
  );
}
