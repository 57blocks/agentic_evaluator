/**
 * The `run` entry point: parse argv, load the environment, print.
 *
 * Everything this file used to do — 1300 lines of driver — now lives under
 * `src/core/`, which knows nothing about a terminal. What is left is the
 * adapter: where the key comes from, what the flags mean, and who is
 * watching. `src/cli/print.ts` turns the run's events into lines.
 *
 *   pnpm run run -- --suite tasks/codegen-w38/spec.yaml --html --yes
 *   pnpm run run -- --suite suites/codegen.json          --html   (legacy JSON)
 *
 * `runSuite`, `aggregate` and `scoreAll` are re-exported here because
 * rescore.ts, dashboard.ts and the tests still import them from this path.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { INSTALL_ROOT } from "./paths.js";
import { consoleSink } from "./cli/print.js";
import { runSuite } from "./core/execute.js";

/**
 * Load KEY=VALUE lines from .env.local into process.env (no dependency).
 *
 * The working directory first, then the installation: a user running the tool
 * against their own workspace keeps their key next to their work, and the
 * checkout's own .env.local still works when you are standing in it. An
 * ambient variable always wins over both.
 */
async function loadEnvLocal(dirs: readonly string[] = [process.cwd(), INSTALL_ROOT]): Promise<void> {
  for (const dir of dirs) await loadEnvFile(path.join(dir, ".env.local"));
}

async function loadEnvFile(file: string): Promise<void> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key]) continue;
      process.env[key] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local here — try the next place, then rely on ambient env.
  }
}

interface CliArgs {
  suite: string;
  html: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let suite = "tasks/codegen-w38/spec.yaml";
  let html = false;
  let yes = process.env.EVAL_YES === "1";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--suite") suite = argv[++i];
    else if (argv[i] === "--html") html = true;
    else if (argv[i] === "--yes") yes = true;
  }
  return { suite, html, yes };
}

async function main(): Promise<void> {
  await loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  await runSuite(args.suite, args.html, { yes: args.yes, onEvent: consoleSink() });
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { loadEnvLocal, runSuite };
export { aggregate } from "./core/scorecard.js";
export { scoreAll, type ScoreHooks } from "./core/evaluate.js";
export { reportRunId } from "./core/generate.js";
export { maybeRunE2eValidation, workflowMode, workflowThresholds } from "./core/e2e-arms.js";
export type { RunOptions } from "./core/execute.js";
