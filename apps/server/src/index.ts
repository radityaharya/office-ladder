// Must stay above ./app for the same reason as in serve.ts: the startup line
// goes out before anything that can abort the boot.
import { serverPort } from "./observability/startup-log";

import { websocket } from "hono/bun";

import { assertServerEnvironment } from "./config/environment";
import { app } from "./app";

assertServerEnvironment();

export default {
  port: serverPort,
  fetch: app.fetch,
  websocket,
};
