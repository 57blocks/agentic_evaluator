/**
 * `agenteval diff <before> <after>` — did the conclusion change between two
 * runs, and why. Reads what each run recorded; never calls a model and never
 * writes. The comparison itself is src/canon/run-diff.ts.
 */

import { DiffTargetError, diffRunDirs } from "../../core/run-diff-pairs.js";
import { findWorkspace, workspaceAt } from "../../core/workspace.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import { diffLines } from "../diff-lines.js";
import { resolveRunDir } from "../run-target.js";

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
  --why               under each flip, what the check said on each side,
                      input by input and trial by trial
  --json              print the comparison as JSON: an array, one entry
                      per compared step
  --workspace DIR     workspace to look the run ids up in`;

export async function cmdDiff(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["workspace", "step", "json", "why"]);
  const [before, after] = args.positional;
  if (before === undefined || after === undefined) throw new UsageError("which two runs? `agenteval diff <before> <after>` (try `agenteval ls`)");

  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();
  const [da, db] = await Promise.all([resolveRunDir(ws, before), resolveRunDir(ws, after)]);

  let result;
  try {
    result = await diffRunDirs(da, db, stringFlag(args.flags, "step"));
  } catch (err) {
    if (err instanceof DiffTargetError) throw new UsageError(err.message);
    throw err;
  }
  const { diffs, unmatched } = result;

  if (args.flags.json) {
    // Always one entry per compared step, so a script reads one shape.
    io.out(`${JSON.stringify(diffs, null, 2)}\n`);
    return EXIT.ok;
  }
  io.out(`${[...unmatched.map((u) => `note: ${u}, not compared`), ...diffs.map((d) => diffLines(d, { why: args.flags.why === true }).join("\n"))].join("\n\n")}\n`);
  return EXIT.ok;
}
