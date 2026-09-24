/**
 * A workspace — where the user's tasks and runs live.
 *
 * Separate from the installation (`src/paths.ts`) on purpose: the harness is
 * a tool, and a tool is pointed at work it does not own. A workspace is any
 * directory holding `tasks/`; the harness's own checkout is simply the
 * workspace you get when you stand in it.
 *
 * Resolution order, most explicit first:
 *   1. an explicit root (`--workspace`, or a task path given on the command line)
 *   2. the nearest ancestor of the working directory that holds `tasks/`
 *   3. the installation itself, so running inside the checkout keeps working
 */

import fs from "node:fs/promises";
import path from "node:path";
import { INSTALL_ROOT } from "../paths.js";

/** A name or path that resolves to no spec — a bad argument, not a failed run. */
export class NoSuchSpecError extends Error {}

export interface Workspace {
  /** Directory holding `tasks/`. */
  readonly root: string;
}

export function workspaceAt(root: string): Workspace {
  return { root: path.resolve(root) };
}

async function isDir(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then((s) => s.isDirectory())
    .catch(() => false);
}

/**
 * Walk up from `startDir` for a directory that holds `tasks/`.
 *
 * With none found, `startDir` itself is the workspace: an installed CLI run
 * from a fresh project must write there, never into its own node_modules.
 * The checkout needs no special case — it has its own `tasks/`.
 */
export async function findWorkspace(startDir: string = process.cwd()): Promise<Workspace> {
  const start = path.resolve(startDir);
  let dir = start;
  for (;;) {
    if (await isDir(path.join(dir, "tasks"))) return workspaceAt(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return workspaceAt(start);
    dir = parent;
  }
}

/**
 * The workspace a spec file belongs to: the nearest ancestor holding `tasks/`,
 * so a task given by absolute path drags its own workspace along.
 */
export async function workspaceForSpec(specPath: string): Promise<Workspace> {
  return findWorkspace(path.dirname(path.resolve(specPath)));
}

export function tasksDir(ws: Workspace): string {
  return path.join(ws.root, "tasks");
}

/** Top-level runs written by older versions of the harness; read, never written. */
export function runsDir(ws: Workspace): string {
  return path.join(ws.root, "runs");
}

/**
 * Where a run is written: beside the task that produced it, so the definition
 * and its evidence travel together.
 */
export function runsRootFor(taskRoot: string): string {
  return path.join(taskRoot, "runs");
}

export interface RunDirEntry {
  /** Run id — the directory's own name. */
  name: string;
  /** Absolute path to the run directory. */
  dir: string;
  /** Owning task, or null for a run under the workspace's top-level `runs/`. */
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
 * Every run directory in the workspace: each task's own `runs/`, plus the
 * top-level `runs/` that older versions of the harness wrote to.
 *
 * Generation reuse matches on `trialHash`, which is content-addressed, so a
 * result produced under one task is safely reusable under another — scanning
 * every task (not just the current one) is what keeps `code-utils`, which
 * several tasks share, from being re-generated once per task.
 */
export async function listRunDirs(ws: Workspace): Promise<RunDirEntry[]> {
  const out = await readRunDirs(runsDir(ws), null);
  let taskNames: string[];
  try {
    taskNames = (await fs.readdir(tasksDir(ws), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const task of taskNames) {
    out.push(...(await readRunDirs(path.join(tasksDir(ws), task, "runs"), task)));
  }
  return out;
}

/**
 * Turn what a user typed into a spec file path.
 *
 * Accepts a task name (`smoke-local`), a directory (with `spec.yaml` inside),
 * or a file. Relative paths resolve against the working directory first —
 * a CLI resolves what you type where you are standing — and against the
 * workspace's `tasks/` second, so `agenteval run smoke-local` works from
 * anywhere in the workspace.
 */
export async function resolveSpecPath(ws: Workspace, arg: string): Promise<string> {
  const candidates = [path.resolve(arg), path.join(tasksDir(ws), arg), path.join(ws.root, arg)];
  for (const c of candidates) {
    if (await isDir(c)) {
      const spec = path.join(c, "spec.yaml");
      if (await fs.stat(spec).then(() => true).catch(() => false)) return spec;
      continue;
    }
    if (await fs.stat(c).then((s) => s.isFile()).catch(() => false)) return c;
  }
  const looked = `no spec found for "${arg}" (looked in ${candidates.join(", ")})`;
  const sample = await sampleNamed(arg);
  const hint = sample
    ? `did you mean ${path.relative(process.cwd(), sample) || "."}?`
    : "try `agenteval ls` for this workspace's tasks";
  throw new NoSuchSpecError(`${looked}\n${hint}`);
}

/**
 * The installation's sample with this bare name, if there is one.
 *
 * The samples live in their own workspace (`examples/`), so from the checkout
 * root or a user's workspace a sample's name alone does not resolve — the
 * first thing a new user types. Naming the path is cheaper than explaining
 * workspaces in an error message.
 */
async function sampleNamed(arg: string): Promise<string | null> {
  if (arg.includes("/") || arg.includes(path.sep)) return null;
  const dir = path.join(INSTALL_ROOT, "examples", "tasks", arg);
  const hasSpec = await fs
    .stat(path.join(dir, "spec.yaml"))
    .then((s) => s.isFile())
    .catch(() => false);
  return hasSpec ? dir : null;
}
