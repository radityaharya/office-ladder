import { serveStatic } from "hono/bun";
import { websocket } from "hono/bun";

import { app } from "./app";

app.use("/*", serveStatic({ root: "./dist/client" }));
app.get("*", serveStatic({ path: "./dist/client/index.html" }));

const port = Number(process.env.PORT ?? 3072);

export default {
  port,
  fetch: app.fetch,
  websocket,
};
