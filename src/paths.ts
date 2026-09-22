/**
 * Repository paths — resolved from this file's location, not from `process.cwd()`,
 * so every CLI works no matter which directory it is launched from.
 *
 * The original harness lived under `agentic-builder/eval/` and hard-coded that
 * prefix in seven places. Here the repo root IS the harness root.
 *
 * A **task** is one self-contained runnable unit: `tasks/<name>/` holds the
 * spec, the inputs it feeds, the rubric that judges them, its checks and its
 * runs. Paths written inside a spec (`rubrics/codegen.md`, `scaffold`,
 * `checks/behaviour.mjs`) resolve against that task dir, so a task can be
 * copied or archived whole.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function runsDir(): string {
  return path.join(REPO_ROOT, "runs");
}

export function suitesDir(): string {
  return path.join(REPO_ROOT, "suites");
}

export function tasksDir(): string {
  return path.join(REPO_ROOT, "tasks");
}

/** Resolve a repo-relative path (as written in suite/spec files) to absolute. */
export function resolveRepo(p: string): string {
  return path.resolve(REPO_ROOT, p);
}

/** True when `taskRoot` is a real task dir rather than the repo root. */
export function isTaskRoot(taskRoot: string): boolean {
  const rel = path.relative(tasksDir(), taskRoot);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve an asset a spec refers to (rubric, scaffold, check script).
 *
 * Always inside the task. A missing file resolves to where it should have
 * been rather than to a repo-root copy: silently grading against a shared
 * file the task does not own is how two runs of "the same" task end up
 * judged by different rubrics.
 */
export async function resolveTaskAsset(taskRoot: string, p: string): Promise<string> {
  return path.isAbsolute(p) ? p : path.resolve(taskRoot, p);
}

/**
 * The task dir a Suite belongs to. Structurally typed so this module stays
 * free of a `types.js` import. Suites built without one — test fixtures,
 * legacy suites/*.json — resolve against the repo root.
 */
export function taskRootOf(suite: { taskRoot?: string }): string {
  return suite.taskRoot ?? REPO_ROOT;
}

/** Sync twin of `resolveTaskAsset`, for the argv resolution in `check.ts`. */
export function resolveTaskAssetSync(taskRoot: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(taskRoot, p);
}

/** Input text lives with its task: `tasks/<name>/inputs/<slug>.txt`. */
export function taskInputPath(taskRoot: string, slug: string): string {
  return path.join(taskRoot, "inputs", `${slug}.txt`);
}

/**
 * Where a task's runs are written: beside the definition that produced them.
 * A Suite with no task dir — a test fixture, a legacy suites/*.json — still
 * writes to the top-level `runs/`.
 */
export function runsRootFor(taskRoot: string): string {
  return isTaskRoot(taskRoot) ? path.join(taskRoot, "runs") : runsDir();
}

export interface RunDirEntry {
  /** Run id — the directory's own name. */
  name: string;
  /** Absolute path to the run directory. */
  dir: string;
  /** Owning task, or null for a run under the legacy top-level `runs/`. */
  task: string | null;
}

async function readRunDirs(root: string, task: string | null): Promise<RunDirEntry[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, dir: path.join(root, e.name), task }));
}

/**
 * Every run directory on disk: each task's own `runs/`, plus the top-level
 * `runs/` that legacy suites still use.
 *
 * Generation reuse matches on `trialHash`, which is content-addressed, so a
 * result produced under one task is safely reusable under another — scanning
 * every task (not just the current one) is what keeps `code-utils`, which nine
 * specs share, from being re-generated once per task.
 */
export async function listRunDirs(): Promise<RunDirEntry[]> {
  const out = await readRunDirs(runsDir(), null);
  let taskNames: string[];
  try {
    taskNames = (await fs.readdir(tasksDir(), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const task of taskNames) {
    out.push(...(await readRunDirs(path.join(tasksDir(), task, "runs"), task)));
  }
  return out;
}
