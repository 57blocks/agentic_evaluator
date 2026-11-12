/**
 * What a `<run>` argument names: a run directory, or a run id in the
 * workspace — and, for a workflow run, the step directories under it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { listRunDirs, type Workspace } from "../core/workspace.js";
import { UsageError } from "./args.js";

export async function resolveRunDir(ws: Workspace, target: string): Promise<string> {
  const asPath = path.resolve(target);
  const isDir = await fs.stat(asPath).then((s) => s.isDirectory()).catch(() => false);
  const runDir = isDir ? asPath : (await listRunDirs(ws)).find((e) => e.name === target)?.dir;
  if (runDir === undefined) throw new UsageError(`no run "${target}" in ${ws.root}`);
  return runDir;
}

export { exists, isWorkflowRun, stepRunDirs } from "../core/run-dirs.js";
