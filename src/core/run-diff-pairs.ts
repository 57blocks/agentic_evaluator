/**
 * Two run directories into the step diffs between them: one diff for two
 * single-step runs, one per shared step for two workflow runs. The CLI
 * (`agenteval diff`) and the dashboard (`/api/diff/…`) both come here, so
 * they pair steps the same way.
 */

import path from "node:path";
import { diffRuns, type RunDiff } from "../canon/run-diff.js";
import { DiffTargetError, loadRunSide } from "./run-diff-load.js";
import { exists, isWorkflowRun, stepRunDirs } from "./run-dirs.js";

export { DiffTargetError };

export interface RunDirDiff {
  /** One per compared step. */
  diffs: RunDiff[];
  /** Steps only one of two workflow runs has, which could not be compared. */
  unmatched: string[];
}

/** A workflow run's steps by name, or null for a single-step run. A workflow that did not finish has its steps but no workflow.json. */
async function stepsOf(dir: string): Promise<Map<string, string> | null> {
  const isStepRun = !(await isWorkflowRun(dir)) && (await exists(path.join(dir, "manifest.json")));
  if (isStepRun) return null;
  const found = await stepRunDirs(dir);
  if (found.length === 0) throw new DiffTargetError(`${path.basename(dir)} holds no run: no manifest.json and no step directories`);
  return new Map(found.map((d) => [path.basename(d), d]));
}

async function stepPairs(before: string, after: string, step: string | undefined): Promise<{ pairs: Array<[string, string]>; unmatched: string[] }> {
  const [sa, sb] = await Promise.all([stepsOf(before), stepsOf(after)]);
  const pick = (m: Map<string, string> | null, dir: string): string => {
    if (m === null) return dir;
    const hit = m.get(step!);
    if (!hit) throw new DiffTargetError(`no step ${step} in ${path.basename(dir)} (steps: ${[...m.keys()].join(", ")})`);
    return hit;
  };
  if (step !== undefined) return { pairs: [[pick(sa, before), pick(sb, after)]], unmatched: [] };
  if (sa === null && sb === null) return { pairs: [[before, after]], unmatched: [] };
  if (sa === null || sb === null) throw new DiffTargetError("one run is a workflow run and the other is not: pick its step with --step ID");
  const common = [...sa.keys()].filter((s) => sb.has(s));
  if (common.length === 0) throw new DiffTargetError("the two workflow runs share no step");
  const unmatched = [
    ...[...sa.keys()].filter((s) => !sb.has(s)).map((s) => `step ${s} is only in the first run`),
    ...[...sb.keys()].filter((s) => !sa.has(s)).map((s) => `step ${s} is only in the second run`),
  ];
  return { pairs: common.map((s) => [sa.get(s)!, sb.get(s)!]), unmatched };
}

export async function diffRunDirs(before: string, after: string, step?: string): Promise<RunDirDiff> {
  const { pairs, unmatched } = await stepPairs(before, after, step);
  const diffs = await Promise.all(pairs.map(async ([a, b]) => diffRuns(await loadRunSide(a), await loadRunSide(b))));
  return { diffs, unmatched };
}
