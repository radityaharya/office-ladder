import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // vitest runs on Node, where Bun's built-in `bun` module does not exist.
      // drizzle-orm/bun-sql imports `SQL` from it at module scope, so this
      // alias is what makes the Hono app importable in a test process at all.
      // See tests/stubs/bun.ts — it is only ever resolved, never called.
      bun: fileURLToPath(new URL("./tests/stubs/bun.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        // Node externalizes node_modules by default, which would bypass the
        // `bun` alias above — drizzle's bun-sql driver must go through Vite's
        // resolver for it to apply.
        inline: [/drizzle-orm/],
      },
    },
  },
});
