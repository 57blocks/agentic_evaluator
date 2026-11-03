/**
 * What a `<run>` argument names: a run directory, or a run id in the
 * workspace — and, for a workflow run, the step directories under it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { listRunDirs, type Workspace } from "../core/workspace.js";
import { UsageError } from "./args.js";

export const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false);

export async function resolveRunDir(ws: Workspace, target: string): Promise<string> {
  const asPath = path.resolve(target);
  const isDir = await fs.stat(asPath).then((s) => s.isDirectory()).catch(() => false);
  const runDir = isDir ? asPath : (await listRunDirs(ws)).find((e) => e.name === target)?.dir;
  if (runDir === undefined) throw new UsageError(`no run "${target}" in ${ws.root}`);
  return runDir;
}

/** A workflow run carries workflow.json at its root; a single-step run does not. */
export const isWorkflowRun = (runDir: string): Promise<boolean> => exists(path.join(runDir, "workflow.json"));

/** A workflow run's step directories: the subdirectories holding a step manifest. */
export async function stepRunDirs(runDir: string): Promise<string[]> {
  const entries = await fs.readdir(runDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(runDir, e.name));
  const isStep = await Promise.all(dirs.map((d) => exists(path.join(d, "manifest.json"))));
  return dirs.filter((_, i) => isStep[i]);
}
