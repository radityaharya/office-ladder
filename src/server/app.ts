import { Hono } from "hono";

import { auth } from "@/lib/auth";
import { roomsRouter } from "./routes/rooms";
import { registerWebSocketRoutes } from "./routes/ws";

export const app = new Hono();

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/rooms", roomsRouter);

registerWebSocketRoutes(app);

export default app;
