import { fileURLToPath } from "node:url";

import { serveStatic } from "hono/bun";
import { websocket } from "hono/bun";

import { app } from "./app";

const clientDir = fileURLToPath(new URL("../../web/dist/client", import.meta.url));

app.use("/*", serveStatic({ root: clientDir }));
app.get("*", serveStatic({ path: `${clientDir}/index.html` }));

const port = Number(process.env.PORT ?? 3072);

export default {
  port,
  fetch: app.fetch,
  websocket,
};
