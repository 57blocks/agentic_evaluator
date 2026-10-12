/**
 * `agenteval check-task <task>` — what can be known about a task before a
 * run is paid. Prints findings; the logic is in core/preflight.ts so the
 * dashboard and the authoring skill can drive it too.
 */

import { preflightTask, type Finding } from "../../core/preflight.js";
import { displayPath } from "../../paths.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import { resolveTask } from "./run.js";

export const CHECK_TASK_HELP = `agenteval check-task <task> [options]

  Check a task before paying for a run. No key, no model call; nothing is
  written outside the task's runs/.

    inputs      how many, empty or duplicated, and how far a pass rate can
                move by chance at that size
    check       an empty answer must fail it; each reference answer
                (references/<input>/ or references/<input>.txt) must pass it
    candidates  a declared script that does not exist; a command running
                without an image, where it can read the answer key

  --json              print the findings as JSON
  --keep              keep the probe work dirs under runs/ to inspect
  --workspace DIR     workspace to resolve <task> under

  Exits 1 when any finding blocks, 0 otherwise.`;

const MARK: Record<Finding["severity"], string> = { blocking: "✖", warning: "⚠", ok: "✔" };

export async function cmdCheckTask(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["json", "keep", "workspace"]);
  const spec = await resolveTask(args);
  const report = await preflightTask(spec, { keep: args.flags.keep === true });

  if (args.flags.json) {
    io.out(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.out(`${displayPath(spec)}\n`);
    for (const step of report.steps) {
      io.out(`\n  ${step.step}\n`);
      for (const f of step.findings) io.out(`  ${MARK[f.severity]} ${f.message}\n`);
    }
    io.out(`\n  ${report.blocking} blocking · ${report.warnings} warning${report.warnings === 1 ? "" : "s"}\n`);
  }
  return report.blocking > 0 ? EXIT.failed : EXIT.ok;
}
