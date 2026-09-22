/**
 * The demo page as served. The markup, styles and client logic live in
 * src/demo/client/ as real files; Vite bundles them to dist/demo.
 *
 * `demoPage()` returns the built index.html. It builds on first call when the
 * output is missing so `pnpm demo` stays one command, and the build is cached
 * for the life of the process.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../paths.js";

export const DIST_DIR = path.join(REPO_ROOT, "dist", "demo");
const INDEX_HTML = path.join(DIST_DIR, "index.html");

let building: Promise<void> | null = null;

/** Build the client bundle. Vite is a dev dependency, so import it lazily. */
async function buildClient(): Promise<void> {
  const { build } = await import("vite");
  await build({ configFile: path.join(REPO_ROOT, "vite.config.ts"), logLevel: "warn" });
}

/** Build once per process, and let concurrent callers share that one build. */
async function ensureBuilt(): Promise<void> {
  try {
    await fs.access(INDEX_HTML);
    return;
  } catch {
    // Not built yet.
  }
  building ??= buildClient();
  await building;
}

export async function demoPage(): Promise<string> {
  await ensureBuilt();
  return fs.readFile(INDEX_HTML, "utf-8");
}
