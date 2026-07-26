// Must stay above ./app: it prints the startup line, and ./app transitively
// loads packages/db, which throws at module load when DATABASE_URL is absent.
// See observability/startup-log.ts.
import { serverPort } from "./observability/startup-log";

import { fileURLToPath } from "node:url";

import { serveStatic } from "hono/bun";
import { websocket } from "hono/bun";

import { assertServerEnvironment } from "./config/environment";
import { app } from "./app";

// After the startup line (so the resolved config is on record) and before the
// port is bound. A misconfigured BETTER_AUTH_URL otherwise 403s every mutation
// with no diagnostic at all — see config/environment.ts.
assertServerEnvironment();

const clientDir = fileURLToPath(new URL("../../web/dist/client", import.meta.url));

app.use("/*", serveStatic({ root: clientDir }));
app.get("*", serveStatic({ path: `${clientDir}/index.html` }));

export default {
  port: serverPort,
  fetch: app.fetch,
  websocket,
};
