/**
 * `agenteval import-harbor <job-dir> --into tasks/<name>` — a finished Harbor
 * job as an agenteval task with one run, nothing re-run (src/core/import-harbor.ts).
 */

import { DEFAULT_THRESHOLD, importHarborJob } from "../../core/import-harbor.js";
import { displayPath } from "../../paths.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";

export const IMPORT_HARBOR_HELP = `agenteval import-harbor <job-dir> --into <task-dir> [options]

  Read a finished Harbor job (one result.json and agent/trajectory.json per
  trial) and write it as an agenteval task with one run: each (agent, model)
  Harbor ran is a command candidate, each Harbor task an input, the
  verifier's reward the required check. The recommendation, "how sure",
  GAPS and the agent-activity table then come from \`agenteval report\` and
  the dashboard as for any run. Nothing is re-run.

  A missing reward is an evaluator error, never the candidate's failure
  (Harbor's own mean counts it as 0). Cost is what the agent reported to
  Harbor, recorded as estimated. The written task is runnable afresh with
  \`agenteval run\`: it carries the Harbor wrapper tasks/harbor-spike uses.

  --into DIR          the task directory to create (its name is the run name)
  --mode MODE         operating mode for the pick (default highest-assurance)
  --threshold N       reward at or above which a trial passes (default ${DEFAULT_THRESHOLD})
  --html              also write report.html
  --force             overwrite an existing task's spec and files (runs are kept)`;

export async function cmdImportHarbor(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["into", "mode", "threshold", "html", "force"]);
  const jobDir = args.positional[0];
  if (jobDir === undefined) throw new UsageError("which Harbor job directory?");
  const into = stringFlag(args.flags, "into");
  if (!into) throw new UsageError("--into <task-dir> is required: where to write the task");
  const thresholdFlag = stringFlag(args.flags, "threshold");
  const threshold = thresholdFlag === undefined ? undefined : Number(thresholdFlag);
  if (threshold !== undefined && !Number.isFinite(threshold)) throw new UsageError(`--threshold ${thresholdFlag} is not a number`);
  const result = await importHarborJob(jobDir, {
    into,
    mode: stringFlag(args.flags, "mode"),
    threshold,
    html: args.flags.html === true,
    force: args.flags.force === true,
  });
  io.out(`  task ${displayPath(result.taskDir)}: ${result.candidates.length} candidate(s) × ${result.inputs.length} input(s), ${result.trials} trial(s) imported\n`);
  io.out(`  → ${result.chosen ?? "no recommendation"} (${result.firmness})\n`);
  io.out(`✔ ${displayPath(result.runDir)}\n`);
  return EXIT.ok;
}
