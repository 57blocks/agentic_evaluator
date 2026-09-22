/**
 * Demo UI build. The client lives in src/demo/client and is bundled to
 * dist/demo; demo/server.ts serves that output alongside the JSON API.
 *
 * `pnpm demo` builds on demand and serves both from one origin. `pnpm
 * demo:dev` runs Vite's dev server for HMR and proxies the API routes to the
 * already-running demo server, so the two halves stay one origin in the
 * browser either way.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "src/demo/client");
const API_ORIGIN = process.env.DEMO_API_ORIGIN ?? "http://127.0.0.1:4173";

export default defineConfig({
  root,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    // Matches tsconfig paths: shadcn components live inside the demo client,
    // not in the harness source tree they would otherwise land in.
    alias: { "@": root },
  },
  build: {
    outDir: path.resolve(here, "dist/demo"),
    emptyOutDir: true,
    // The demo is read locally; a readable bundle is worth more than bytes.
    minify: false,
    sourcemap: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api": API_ORIGIN,
      "/artifact": API_ORIGIN,
    },
  },
});
