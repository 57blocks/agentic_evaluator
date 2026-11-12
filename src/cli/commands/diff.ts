/**
 * `agenteval diff <before> <after>` — did the conclusion change between two
 * runs, and why. Reads what each run recorded; never calls a model and never
 * writes. The comparison itself is src/canon/run-diff.ts.
 */

import path from "node:path";
import { diffRuns } from "../../canon/run-diff.js";
import { loadRunSide } from "../../core/run-diff-load.js";
import { findWorkspace, workspaceAt } from "../../core/workspace.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import { diffLines } from "../diff-lines.js";
import { exists, isWorkflowRun, resolveRunDir, stepRunDirs } from "../run-target.js";

export const DIFF_HELP = `agenteval diff <before> <after> [options]

  Compare two finished runs of a step: did the recommendation change, who
  entered or left the gates, how each candidate's pass rate moved (split into
  the inputs both runs share and the ones only one has), and which shared
  inputs flipped — with whether the answer changed or the same answer was
  graded differently. Reads what each run recorded; calls no model, writes
  nothing.

  <before> <after>    run ids, or paths to run directories
  --step ID           the step to compare, when a run is a workflow run
                      (without it, every step both workflow runs have)
  --json              print the comparison as JSON
  --workspace DIR     workspace to look the run ids up in`;

/** The step directories to compare, as [before, after] pairs. */
async function stepPairs(before: string, after: string, step: string | undefined): Promise<Array<[string, string]>> {
  // A workflow run that did not finish has its steps but no workflow.json.
  const steps = async (dir: string): Promise<Map<string, string> | null> => {
    const isStepRun = !(await isWorkflowRun(dir)) && (await exists(path.join(dir, "manifest.json")));
    if (isStepRun) return null;
    const found = await stepRunDirs(dir);
    if (found.length === 0) throw new UsageError(`${dir} holds no run: no manifest.json and no step directories`);
    return new Map(found.map((d) => [path.basename(d), d]));
  };
  const [sa, sb] = await Promise.all([steps(before), steps(after)]);
  const pick = (m: Map<string, string> | null, dir: string): string => {
    if (m === null) return dir;
    const hit = m.get(step!);
    if (!hit) throw new UsageError(`no step ${step} in ${dir} (steps: ${[...m.keys()].join(", ")})`);
    return hit;
  };
  if (step !== undefined) return [[pick(sa, before), pick(sb, after)]];
  if (sa === null && sb === null) return [[before, after]];
  if (sa === null || sb === null) throw new UsageError("one run is a workflow run and the other is not: pick its step with --step ID");
  const common = [...sa.keys()].filter((s) => sb.has(s));
  if (common.length === 0) throw new UsageError("the two workflow runs share no step");
  return common.map((s) => [sa.get(s)!, sb.get(s)!]);
}

/** Steps only one of two workflow runs has, which the diff cannot compare. */
async function unmatchedSteps(before: string, after: string): Promise<string[]> {
  const names = async (dir: string) => new Set((await stepRunDirs(dir)).map((d) => path.basename(d)));
  const [sa, sb] = await Promise.all([names(before), names(after)]);
  return [...[...sa].filter((s) => !sb.has(s)).map((s) => `step ${s} is only in the first run`), ...[...sb].filter((s) => !sa.has(s)).map((s) => `step ${s} is only in the second run`)];
}

export async function cmdDiff(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["workspace", "step", "json"]);
  const [before, after] = args.positional;
  if (before === undefined || after === undefined) throw new UsageError("which two runs? `agenteval diff <before> <after>` (try `agenteval ls`)");

  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();
  const [da, db] = await Promise.all([resolveRunDir(ws, before), resolveRunDir(ws, after)]);

  const step = stringFlag(args.flags, "step");
  const pairs = await stepPairs(da, db, step);
  const diffs = await Promise.all(pairs.map(async ([a, b]) => diffRuns(await loadRunSide(a), await loadRunSide(b))));

  if (args.flags.json) {
    io.out(`${JSON.stringify(diffs.length === 1 ? diffs[0] : diffs, null, 2)}\n`);
    return EXIT.ok;
  }
  const unmatched = step === undefined && pairs.length > 1 ? await unmatchedSteps(da, db) : [];
  io.out(`${[...unmatched.map((u) => `note: ${u}, not compared`), ...diffs.map((d) => diffLines(d).join("\n"))].join("\n\n")}\n`);
  return EXIT.ok;
}
