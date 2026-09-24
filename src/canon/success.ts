/**
 * Success-decision contract (protocol §5): outcome from declared criteria.
 *
 *   - any mandatory check `fail`                         → failure
 *   - any mandatory check `evaluator_error`/`not_evaluated` → undetermined
 *   - all mandatory checks `pass`                        → success
 *   - no required checks declared for the step          → undetermined
 *   - candidate did not complete                        → failure (candidate-caused)
 *
 * Every decision cites the criteria it used and the rule version, so a report
 * can reproduce it from stored evidence. Never infers success from a score.
 */

import type {
  CompletionState,
  EvaluationResult,
  SuccessCriteria,
  SuccessDecision,
} from "./types.js";

const SUCCESS_RULE_VERSION = "success-v1" as const;

export interface SuccessInput {
  criteria?: SuccessCriteria;
  requiredChecks: readonly string[];
  completion: CompletionState;
  /** Results of the required checks for this trial (may be missing entries). */
  checks: readonly EvaluationResult[];
}

export function decideTaskOutcome(input: SuccessInput): SuccessDecision {
  const { criteria, requiredChecks, completion, checks } = input;

  if (completion !== "success") {
    return {
      outcome: "failure",
      reasons: [`candidate completion state is ${completion}`],
      ruleVersion: SUCCESS_RULE_VERSION,
    };
  }

  if (!criteria || requiredChecks.length === 0) {
    return {
      outcome: "undetermined",
      reasons: ["no required checks declared for this step; success cannot be decided"],
      ruleVersion: SUCCESS_RULE_VERSION,
    };
  }

  const reasons: string[] = [];
  let sawFail = false;
  let sawUnknown = false;

  for (const id of requiredChecks) {
    const result = checks.find((c) => c.evaluator === id);
    if (!result) {
      sawUnknown = true;
      reasons.push(`${id}: no result recorded`);
      continue;
    }
    if (result.state === "pass") {
      reasons.push(`${id}: pass`);
    } else if (result.state === "fail") {
      sawFail = true;
      reasons.push(`${id}: fail`);
    } else {
      sawUnknown = true;
      reasons.push(`${id}: ${result.state}${result.reason ? ` (${result.reason})` : ""}`);
    }
  }

  if (sawFail) return { outcome: "failure", reasons, ruleVersion: SUCCESS_RULE_VERSION };
  if (sawUnknown) return { outcome: "undetermined", reasons, ruleVersion: SUCCESS_RULE_VERSION };
  return { outcome: "success", reasons, ruleVersion: SUCCESS_RULE_VERSION };
}
