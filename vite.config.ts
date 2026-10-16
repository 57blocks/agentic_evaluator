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

/**
 * `vite build --mode static` builds the copy `agenteval dash --export` ships:
 * one JS file and one CSS file with fonts inlined, so the exporter can put
 * both inside index.html and the page opens from disk (file://), where a
 * browser loads no module script or chunk from a separate file.
 */
export default defineConfig(({ mode }) => ({
  root,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    // Matches tsconfig paths: shadcn components live inside the demo client,
    // not in the harness source tree they would otherwise land in.
    alias: { "@": root },
  },
  build:
    mode === "static"
      ? {
          outDir: path.resolve(here, "dist/demo-static"),
          emptyOutDir: true,
          minify: true,
          sourcemap: false,
          cssCodeSplit: false,
          assetsInlineLimit: 100_000_000,
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : {
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
}));
