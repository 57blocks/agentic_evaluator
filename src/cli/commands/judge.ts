/**
 * `agenteval judge <task> <run>` — judge a finished run again, pairwise, with
 * each step's current judge config, on the files its trials left. Generates
 * nothing (src/core/judge-run.ts).
 */

import { judgeRun } from "../../core/judge-run.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import { resolveTask } from "./run.js";

export const JUDGE_HELP = `agenteval judge <task> <run> [options]

  Judge a finished run (or a combined one) again: each step's pair verdicts
  are replaced by a pairwise comparison with the step's current judge config
  (rubric, show, dimensions), on the files every trial left. On a step with
  fixtures the judge reads only what each candidate added or changed. The
  step's rates, recommendation, ledger and reports are worked out again.
  Nothing is generated; the judge's calls are billed.

  --step ID[,ID]      judge only these steps (default: those whose judge
                      declares pairwise-swap)
  --html              also write report.html
  --workspace DIR     workspace to resolve <task> under`;

export async function cmdJudge(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["step", "html", "workspace"]);
  const run = args.positional[1];
  if (!run) throw new UsageError("which run? (try `agenteval ls`)");
  const spec = await resolveTask(args);
  const steps = stringFlag(args.flags, "step")?.split(",").map((s) => s.trim()).filter(Boolean);
  const result = await judgeRun(spec, run, { html: args.flags.html === true, ...(steps ? { steps } : {}) });
  for (const s of result.steps) {
    io.out(`  ${s.id}: ${s.pairs} pair(s) judged${s.failed ? `, ${s.failed} failed` : ""} · $${s.costUsd.toFixed(4)} · recommend ${s.chosen ?? "none"}\n`);
  }
  return EXIT.ok;
}
