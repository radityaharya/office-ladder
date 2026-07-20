import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import devServer, { defaultOptions } from "@hono/vite-dev-server";
import bunAdapter from "@hono/vite-dev-server/bun";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: fileURLToPath(new URL("../../", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "dist/client",
  },
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    devServer({
      entry: "../server/src/index.ts",
      adapter: bunAdapter,
      exclude: [...defaultOptions.exclude, /^\/(?!api\/|ws\/).*/],
      injectClientScript: false,
    }),
  ],
});
