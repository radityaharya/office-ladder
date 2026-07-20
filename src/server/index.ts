import { websocket } from "hono/bun";

import { app } from "./app";

export default {
  fetch: app.fetch,
  websocket,
};
