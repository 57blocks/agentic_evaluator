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
 * `checks/task-coverage.mjs`) resolve against that task dir, so a task can be
 * copied or archived whole. `resolveTaskAsset` falls back to the repo root for
 * specs that still live under `specs/`, which keeps the migration incremental.
 */

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
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

export function tasksDir(): string {
  return path.join(REPO_ROOT, "tasks");
}

/** Resolve a repo-relative path (as written in suite/spec files) to absolute. */
export function resolveRepo(p: string): string {
  return path.resolve(REPO_ROOT, p);
}

/** True while `taskRoot` is a migrated task dir rather than the old `specs/`. */
export function isTaskRoot(taskRoot: string): boolean {
  const rel = path.relative(tasksDir(), taskRoot);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve an asset a spec refers to (rubric, scaffold, check script).
 *
 * Task dir first, repo root second. The fallback is what lets a migrated task
 * and an un-migrated spec coexist during the move; once `specs/` is empty it
 * only ever takes the first branch.
 */
export async function resolveTaskAsset(taskRoot: string, p: string): Promise<string> {
  if (path.isAbsolute(p)) return p;
  const inTask = path.resolve(taskRoot, p);
  try {
    await fs.access(inTask);
    return inTask;
  } catch {
    return path.resolve(REPO_ROOT, p);
  }
}

/**
 * The task dir a Suite belongs to. Structurally typed so this module stays
 * free of a `types.js` import. Falls back to the repo root for Suites built
 * before the task layout (tests, legacy callers), which reproduces the old
 * repo-relative resolution exactly.
 */
export function taskRootOf(suite: { taskRoot?: string }): string {
  return suite.taskRoot ?? REPO_ROOT;
}

/** Sync twin of `resolveTaskAsset`, for the argv resolution in `check.ts`. */
export function resolveTaskAssetSync(taskRoot: string, p: string): string {
  if (path.isAbsolute(p)) return p;
  const inTask = path.resolve(taskRoot, p);
  return existsSync(inTask) ? inTask : path.resolve(REPO_ROOT, p);
}

/** Input text lives with its task: `tasks/<name>/inputs/<slug>.txt`. */
export function taskInputPath(taskRoot: string, slug: string): string {
  return path.join(taskRoot, "inputs", `${slug}.txt`);
}

/**
 * Where a task's runs are written. Migrated tasks keep their evidence beside
 * their definition; anything still under `specs/` keeps using the top-level
 * `runs/` so old specs stay runnable mid-migration.
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
 * Every run directory on disk: each task's own `runs/`, plus the legacy
 * top-level `runs/`.
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
