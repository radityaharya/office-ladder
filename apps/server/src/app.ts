import { Hono } from "hono";

import { auth } from "@/lib/auth";
import { chatRouter } from "./routes/chat";
import { roomsRouter } from "./routes/rooms";
import { registerWebSocketRoutes } from "./routes/ws";

export const app = new Hono();

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/rooms", roomsRouter);
// Chat (spec §11.2) shares the /api/rooms base but is a separate router: it owns
// no game state, takes no revision and never reaches the engine. Hono merges a
// sub-app's routes into the parent's table with the prefix applied, so both
// routers coexist here and roomsRouter's "/:roomId" does not swallow
// "/:roomId/messages".
app.route("/api/rooms", chatRouter);

registerWebSocketRoutes(app);

export default app;
