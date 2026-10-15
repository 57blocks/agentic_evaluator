/**
 * `exit_code: ignore` (on a step, or a command candidate's cli) — a non-zero
 * exit is evidence, not the verdict.
 *
 * An agent harness exits non-zero for its own reasons: agb fails a task its
 * own gates or its own verifier would not pass, however the code turned out.
 * When the spec's check grades the work itself, the harness's opinion should
 * not decide the trial before the check does. With `ignore`, the exit code is
 * kept (`finish_reason: exit 1`) and the trial counts as completed when the
 * command ran to the end; the check decides success. A timeout, a crash to
 * start, or no output at all still fail as before.
 */

import { decideTaskOutcome } from "../canon/success.js";
import type { TrialRow } from "../canon/rows.js";
import type { CandidateDef } from "../canon/types.js";
import type { Suite } from "../types.js";

const NONZERO_EXIT = /^exit [1-9]\d*$/;

/** The step's `exit_code` wins over the candidate's: what an exit means depends on what the step runs. */
export function ignoresExit(def: CandidateDef | undefined, step?: Pick<Suite, "exitCode">): boolean {
  return (step?.exitCode ?? def?.cli?.exit_code) === "ignore";
}

/** The finish reason completion is classified on: a non-zero exit reads as a normal stop under `ignore`. */
export function finishForCompletion(def: CandidateDef | undefined, finishReason: string | undefined, step?: Pick<Suite, "exitCode">): string | undefined {
  return ignoresExit(def, step) && finishReason !== undefined && NONZERO_EXIT.test(finishReason) ? "stop" : finishReason;
}

/**
 * Rows recorded before `ignore` was declared, re-decided under it: a trial
 * that ran to a non-zero exit becomes completed, and its outcome follows its
 * checks. Rows of other candidates, or other completion states, are unchanged.
 */
export function applyExitPolicy(rows: readonly TrialRow[], suite: Pick<Suite, "candidateDefs" | "successCriteria" | "requiredChecks" | "exitCode">): TrialRow[] {
  return rows.map((r) => {
    if (!ignoresExit(suite.candidateDefs?.[r.candidate], suite)) return r;
    if (r.completion_state !== "malformed" || !NONZERO_EXIT.test(r.finish_reason ?? "")) return r;
    const decided = decideTaskOutcome({
      criteria: suite.successCriteria,
      requiredChecks: suite.requiredChecks ?? [],
      completion: "success",
      checks: Object.entries(r.checks).map(([evaluator, c]) => ({ evaluator, version: c.version, state: c.state, ...(c.reason ? { reason: c.reason } : {}) })),
    });
    return { ...r, completion_state: "success", task_outcome: decided.outcome, outcome_reasons: decided.reasons, rule_version: decided.ruleVersion };
  });
}
