/**
 * Per-candidate rates with explicit numerators and denominators (protocol §3).
 *
 *   valid attempts        every trial of the candidate
 *   classified            success + candidate-caused failure (undetermined excluded)
 *   task-success rate     success / classified
 *   reliability           success / valid attempts (refusal, timeout … stay in)
 *   evaluation coverage   classified / valid attempts
 *   required-check pass   pass / (pass + fail) — executed checks only
 *
 * A result is `directional` unless the sample and a predeclared minimum
 * meaningful difference both support a firm claim.
 */

import type { TrialRow } from "./rows.js";
import type { CompletionState, EvaluationState } from "./types.js";

export interface Rate {
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface CandidateRates {
  candidate: string;
  valid_attempts: number;
  classified: number;
  task_success_rate: Rate;
  reliability: Rate;
  evaluation_coverage: Rate;
  required_check_pass_rate: Rate;
  completion_states: Record<CompletionState, number>;
  outcomes: { success: number; failure: number; undetermined: number };
  check_states: Record<EvaluationState, number>;
  /** Generation cost only; the all-in figure (with judging) lives in ledger.json. */
  generation_cost_per_success: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
}

export interface Directionality {
  directional: boolean;
  reasons: string[];
}

export const FIRM_MIN_INPUTS = 10;

export const rate = (numerator: number, denominator: number): Rate => ({
  value: denominator > 0 ? numerator / denominator : null,
  numerator,
  denominator,
});

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

const EMPTY_COMPLETION: Record<CompletionState, number> = {
  success: 0, refusal: 0, timeout: 0, malformed: 0, cancelled: 0, provider_error: 0,
};
const EMPTY_EVAL: Record<EvaluationState, number> = {
  pass: 0, fail: 0, not_evaluated: 0, evaluator_error: 0,
};

export function ratesFor(candidate: string, rows: readonly TrialRow[]): CandidateRates {
  const own = rows.filter((r) => r.candidate === candidate);
  const successes = own.filter((r) => r.task_outcome === "success").length;
  const failures = own.filter((r) => r.task_outcome === "failure").length;
  const undetermined = own.length - successes - failures;
  const classified = successes + failures;

  const completion = own.reduce<Record<CompletionState, number>>(
    (acc, r) => ({ ...acc, [r.completion_state]: acc[r.completion_state] + 1 }),
    { ...EMPTY_COMPLETION },
  );
  const checkCells = own.flatMap((r) => Object.values(r.checks));
  const checkStates = checkCells.reduce<Record<EvaluationState, number>>(
    (acc, c) => ({ ...acc, [c.state]: acc[c.state] + 1 }),
    { ...EMPTY_EVAL },
  );
  const generation = own.reduce((s, r) => s + r.cost.generation, 0);
  const durations = own.filter((r) => r.completion_state === "success").map((r) => r.ms).sort((a, b) => a - b);

  return {
    candidate,
    valid_attempts: own.length,
    classified,
    task_success_rate: rate(successes, classified),
    reliability: rate(successes, own.length),
    evaluation_coverage: rate(classified, own.length),
    required_check_pass_rate: rate(checkStates.pass, checkStates.pass + checkStates.fail),
    completion_states: completion,
    outcomes: { success: successes, failure: failures, undetermined },
    check_states: checkStates,
    generation_cost_per_success: successes > 0 ? Math.round((generation / successes) * 1e6) / 1e6 : null,
    p50_ms: percentile(durations, 0.5),
    p95_ms: percentile(durations, 0.95),
  };
}

export function directionality(inputCount: number, mmd: number | null | undefined): Directionality {
  const reasons: string[] = [];
  if (inputCount < FIRM_MIN_INPUTS) reasons.push(`${inputCount} inputs; fewer than ${FIRM_MIN_INPUTS}`);
  if (mmd === null || mmd === undefined) reasons.push("no minimum meaningful difference declared");
  return { directional: reasons.length > 0, reasons };
}
