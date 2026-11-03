/**
 * Evaluator-error ablation (paper experiment 3): what a harness that cannot
 * tell a broken grader from a wrong answer would have decided.
 *
 * The protocol keeps a required check that could not run (`evaluator_error`,
 * `not_evaluated`) out of the candidate's score: the trial is undetermined
 * (success.ts). Here every such check is read as `fail`, so the trial becomes
 * a candidate failure, and the step is decided again by the same selector.
 *
 * Infra completion states (provider_error, cancelled) are deliberately left
 * alone: they are a separate axis of the outcome taxonomy, and folding them in
 * would also mean rewriting completion states the rates read their
 * denominators from. Pure; returns new rows and never edits the ones given.
 */

import type { CheckCell, TrialRow } from "./rows.js";
import type { Recommendation } from "./select.js";

export const ABLATION_RULE_VERSION = "ablation-evaluator-errors-v1" as const;

const UNGRADED = new Set<CheckCell["state"]>(["evaluator_error", "not_evaluated"]);

export interface AblatedRows {
  rows: TrialRow[];
  /** Trials whose outcome changed: undetermined → failure. */
  changed: number;
}

function failCell(cell: CheckCell): CheckCell {
  return UNGRADED.has(cell.state)
    ? { ...cell, state: "fail", reason: `ablation: ${cell.state} counted as fail` }
    : cell;
}

function ablateRow(row: TrialRow): TrialRow {
  const ungraded = Object.values(row.checks).some((c) => UNGRADED.has(c.state));
  if (!ungraded) return row;
  const checks = Object.fromEntries(Object.entries(row.checks).map(([id, cell]) => [id, failCell(cell)]));
  // Only an undetermined trial moves; an infra trial stays undetermined
  // because its completion state, not its checks, made it so.
  const flips = row.task_outcome === "undetermined" && row.completion_state === "success";
  return {
    ...row,
    checks,
    ...(flips
      ? {
          task_outcome: "failure" as const,
          outcome_reasons: [...row.outcome_reasons, "ablation: an ungraded required check counted as a candidate failure"],
        }
      : {}),
  };
}

export function countEvaluatorErrorsAsFailures(rows: readonly TrialRow[]): AblatedRows {
  const ablated = rows.map(ablateRow);
  const changed = ablated.filter((r, i) => r.task_outcome !== rows[i].task_outcome).length;
  return { rows: ablated, changed };
}

export interface AblationComparison {
  rule_version: typeof ABLATION_RULE_VERSION;
  changed_trials: number;
  original: { chosen: string | null; eligible: string[] };
  ablated: { chosen: string | null; eligible: string[] };
  /** The pick changed, or the set of eligible candidates did. */
  flipped: boolean;
}

export function compareAblation(original: Recommendation, ablated: Recommendation, changed: number): AblationComparison {
  const sameEligible =
    original.eligible.length === ablated.eligible.length &&
    original.eligible.every((c) => ablated.eligible.includes(c));
  return {
    rule_version: ABLATION_RULE_VERSION,
    changed_trials: changed,
    original: { chosen: original.chosen, eligible: original.eligible },
    ablated: { chosen: ablated.chosen, eligible: ablated.eligible },
    flipped: original.chosen !== ablated.chosen || !sameEligible,
  };
}
