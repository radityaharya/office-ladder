/**
 * The one line `app.ts` has to add is `app.route("/api/rooms", chatRouter)`,
 * and the only thing that could go wrong with it is a collision with
 * `roomsRouter`, which is already mounted on that same base.
 *
 * Hono's `route()` copies a sub-app's routes into the parent's table with the
 * prefix applied, so two routers on one base coexist rather than the first one
 * shadowing the second.
 *
 * The neighbour here is a stand-in declaring `roomsRouter`'s exact path
 * patterns rather than the router itself. What is being asserted is a property
 * of the *patterns* — `/:roomId` must not swallow `/:roomId/messages` — and
 * importing the real module would drag its whole dependency graph (the bot
 * driver, the turn-timer singletons, the command endpoint) into a test about
 * routing, where an unrelated failure in any of them would read as a chat bug.
 */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { chatRouter } from "../../src/routes/chat";

/** Every path pattern `src/routes/rooms.ts` registers, as of this wave. */
function roomsRouterStandIn(): Hono {
  const router = new Hono();
  const answer = (c: { text: (body: string) => Response }) => c.text("rooms");
  router.post("/", answer);
  router.post("/join", answer);
  router.get("/:roomId", answer);
  router.post("/:roomId/start", answer);
  router.post("/:roomId/roll", answer);
  router.post("/:roomId/respond", answer);
  router.put("/:roomId/character", answer);
  router.post("/:roomId/bots", answer);
  router.delete("/:roomId/bots/:memberId", answer);
  return router;
}

function mounted(): Hono {
  const app = new Hono();
  app.route("/api/rooms", roomsRouterStandIn());
  app.route("/api/rooms", chatRouter);
  return app;
}

describe("mounting chat beside rooms", () => {
  it("Given both routers on /api/rooms, When a chat path is requested, Then chat answers it", async () => {
    const response = await mounted().request(
      "http://localhost:3072/api/rooms/room-mount-check/messages",
    );

    // 401, not 404 and not "rooms": the chat handler ran and refused an
    // unauthenticated read. A 404 would mean `/:roomId` had swallowed the path.
    expect(response.status).toBe(401);
  });

  it("Given both routers on /api/rooms, When a room path is requested, Then rooms still answers it", async () => {
    const response = await mounted().request(
      "http://localhost:3072/api/rooms/room-mount-check",
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("rooms");
  });

  it("Given both routers on /api/rooms, When an unknown path under it is requested, Then it is a 404", async () => {
    const response = await mounted().request(
      "http://localhost:3072/api/rooms/room-mount-check/messages/m1/reactions/extra",
    );

    expect(response.status).toBe(404);
  });
});
