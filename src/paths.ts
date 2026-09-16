/**
 * Repository paths — resolved from this file's location, not from `process.cwd()`,
 * so every CLI works no matter which directory it is launched from.
 *
 * The original harness lived under `agentic-builder/eval/` and hard-coded that
 * prefix in seven places. Here the repo root IS the harness root.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function inputsDir(): string {
  return path.join(REPO_ROOT, "inputs");
}

export function runsDir(): string {
  return path.join(REPO_ROOT, "runs");
}

export function suitesDir(): string {
  return path.join(REPO_ROOT, "suites");
}

/** Resolve a repo-relative path (as written in suite/spec files) to absolute. */
export function resolveRepo(p: string): string {
  return path.resolve(REPO_ROOT, p);
}
