/**
 * What a run directory holds: one step, or a workflow's steps under it.
 */

import fs from "node:fs/promises";
import path from "node:path";

export const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false);

/** A workflow run carries workflow.json at its root; a single-step run does not. */
export const isWorkflowRun = (runDir: string): Promise<boolean> => exists(path.join(runDir, "workflow.json"));

/** A workflow run's step directories: the subdirectories holding a step manifest. */
export async function stepRunDirs(runDir: string): Promise<string[]> {
  const entries = await fs.readdir(runDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(runDir, e.name));
  const isStep = await Promise.all(dirs.map((d) => exists(path.join(d, "manifest.json"))));
  return dirs.filter((_, i) => isStep[i]);
}
