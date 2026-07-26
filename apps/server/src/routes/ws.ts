import type { Hono, MiddlewareHandler } from "hono";
import { upgradeWebSocket } from "hono/bun";

import { requireSession } from "@/auth/require-session";
import { isTrustedOrigin, json, requireTrustedUpgradeOrigin } from "@/http";
import { log } from "@/observability/log";
import { createRoomSocketAuthorizer } from "@/realtime/authorize-room-socket";
import { createRoomSocketLifecycle } from "@/realtime/room-socket-lifecycle";
import { registerRoomSocket } from "@/realtime/ws-hub";
import { logRoomSocketRejection } from "@/realtime/ws-log";
import { roomService } from "@/rooms/service";

const authorizeRoomSocket = createRoomSocketAuthorizer({
  isTrustedOrigin: (request) => isTrustedOrigin(request.headers.get("origin")),
  requireSession,
  authorizeSubscription: (input) => roomService.authorizeSubscription(input),
});

/**
 * Rejects a cross-origin handshake with a plain HTTP 403 *before* the upgrade,
 * so a hostile page never gets a socket at all rather than getting one that is
 * immediately closed. The authorizer re-checks the same thing, which is what the
 * unit tests exercise; this is the cheap outer gate.
 */
const requireTrustedOrigin: MiddlewareHandler = async (c, next) => {
  const origin = requireTrustedUpgradeOrigin(c.req.raw);
  if (!origin.ok) {
    log("warn", "ws.rejected", {
      topic: c.req.param("roomTopic"),
      reason: origin.error.code,
      origin: c.req.raw.headers.get("origin"),
      stage: "upgrade",
    });
    return json({ error: { code: origin.error.code } }, { status: origin.error.status });
  }

  await next();
};

export function registerWebSocketRoutes(app: Hono): void {
  app.get(
    "/ws/rooms/:roomTopic",
    requireTrustedOrigin,
    upgradeWebSocket((c) => {
      // One lifecycle per socket. It owns the ordering between the authorization
      // round trip and a close that arrives during it — see
      // realtime/room-socket-lifecycle.ts, which is where that logic is testable.
      const lifecycle = createRoomSocketLifecycle({
        authorize: authorizeRoomSocket,
        register: registerRoomSocket,
        onRejected: logRoomSocketRejection,
      });

      return {
        async onOpen(_event, ws) {
          await lifecycle.open(c.req.raw, c.req.param("roomTopic"), ws);
        },
        onClose() {
          lifecycle.close();
        },
      };
    }),
  );
}
