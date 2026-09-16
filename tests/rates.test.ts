import { test } from "node:test";
import assert from "node:assert/strict";
import { directionality, ratesFor } from "../src/canon/rates.js";
import type { TrialRow } from "../src/canon/rows.js";
import type { CompletionState, EvaluationState, TaskOutcome } from "../src/canon/types.js";

function row(
  trial: number,
  completion: CompletionState,
  outcome: TaskOutcome,
  check: EvaluationState | null,
  ms = 1000,
): TrialRow {
  return {
    run: "r", step: "codegen", candidate: "kimi-k3", model_ref: "moonshotai/kimi-k3", deployment_ref: "openrouter/moonshot",
    input: `in-${trial % 3}`, trial, trial_hash: `h${trial}`,
    completion_state: completion, truncated: false, task_outcome: outcome, outcome_reasons: [], rule_version: "success-v1",
    checks: check ? { "tsc-noemit": { state: check, version: "v" } } : {},
    judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0.01, source: "provider-reported" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms, ttft_ms: null, cache: null, finish_reason: "stop", error: null,
    legacy_status: completion === "success" ? "ok" : "error", legacy_check_passed: check === "pass" ? true : check === "fail" ? false : null,
    reused_from: null,
  };
}

// The mock's kimi-k3 row: 9 attempts — 6 pass, 1 tsc fail, 2 timeouts.
const rows: TrialRow[] = [
  ...[0, 1, 2, 3, 4, 5].map((i) => row(i, "success", "success", "pass")),
  row(6, "success", "failure", "fail"),
  row(7, "timeout", "failure", null),
  row(8, "timeout", "failure", null),
];

test("denominators: reliability counts timeouts, check pass rate counts executed checks only", () => {
  const r = ratesFor("kimi-k3", rows);
  assert.equal(r.valid_attempts, 9);
  assert.equal(r.classified, 9);
  assert.deepEqual(r.reliability, { value: 6 / 9, numerator: 6, denominator: 9 });
  assert.deepEqual(r.required_check_pass_rate, { value: 6 / 7, numerator: 6, denominator: 7 });
  assert.equal(r.completion_states.timeout, 2);
  assert.equal(r.evaluation_coverage.value, 1);
});

test("undetermined trials leave the classified denominator", () => {
  const withUndetermined = [...rows, row(9, "success", "undetermined", "evaluator_error")];
  const r = ratesFor("kimi-k3", withUndetermined);
  assert.equal(r.valid_attempts, 10);
  assert.equal(r.classified, 9);
  assert.equal(r.task_success_rate.denominator, 9);
  assert.equal(r.evaluation_coverage.value, 0.9);
  assert.equal(r.check_states.evaluator_error, 1);
});

test("cost per success is null when nothing succeeded", () => {
  const r = ratesFor("kimi-k3", [row(0, "timeout", "failure", null)]);
  assert.equal(r.generation_cost_per_success, null);
  assert.equal(r.task_success_rate.value, 0);
  assert.equal(r.p50_ms, null);
});

test("directional when fewer than 10 inputs or no minimum meaningful difference", () => {
  assert.equal(directionality(3, null).directional, true);
  assert.equal(directionality(3, null).reasons.length, 2);
  assert.equal(directionality(12, 0.05).directional, false);
  assert.equal(directionality(12, null).reasons.length, 1);
});
