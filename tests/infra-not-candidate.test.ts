/**
 * A failure of the harness, the provider or the transport is not the
 * candidate's. It must leave the trial undetermined: out of the task-success
 * denominator, out of reliability's, and visible as lost evaluation coverage
 * instead of as a miss the candidate is gated on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ratesFor } from "../src/canon/rates.js";
import { summaryLines } from "../src/cli/summary.js";
import type { TrialRow } from "../src/canon/rows.js";
import { recommend } from "../src/canon/select.js";
import { classifyCompletion } from "../src/canon/states.js";
import { decideTaskOutcome } from "../src/canon/success.js";
import type { CompletionState, EvaluationResult, TaskOutcome } from "../src/canon/types.js";

const all = { mandatory_checks: "all" as const };
const pass: EvaluationResult = { evaluator: "reward", version: "v", state: "pass" };
const evErr: EvaluationResult = { evaluator: "reward", version: "v", state: "evaluator_error", reason: "no result" };

test("an error nobody could classify stays the candidate's failure (fail closed)", () => {
  // e.g. a command that floods stdout past the harness's buffer: candidate-triggerable.
  const v = classifyCompletion({ error: { kind: "unknown" } });

  assert.equal(v.state, "malformed");
  assert.equal(decideTaskOutcome({ criteria: all, requiredChecks: ["reward"], completion: v.state, checks: [] }).outcome, "failure");
});

for (const completion of ["provider_error", "cancelled"] as const) {
  test(`a ${completion} trial is undetermined, not the candidate's failure`, () => {
    const d = decideTaskOutcome({ criteria: all, requiredChecks: ["reward"], completion, checks: [] });

    assert.equal(d.outcome, "undetermined");
    assert.match(d.reasons.join(" "), new RegExp(completion));
  });
}

test("a timeout is still the candidate's failure", () => {
  const d = decideTaskOutcome({ criteria: all, requiredChecks: ["reward"], completion: "timeout", checks: [] });

  assert.equal(d.outcome, "failure");
});

test("malformed output stays a failure even when the check then crashed (fail closed)", () => {
  // A candidate must not escape a miss by leaving output that breaks the check.
  const d = decideTaskOutcome({
    criteria: all, requiredChecks: ["reward"], completion: "malformed",
    completionReason: "output contained no parseable units", checks: [evErr],
  });

  assert.equal(d.outcome, "failure");
});

test("malformed output with a check that ran is still the candidate's failure", () => {
  const d = decideTaskOutcome({ criteria: all, requiredChecks: ["reward"], completion: "malformed", checks: [pass] });

  assert.equal(d.outcome, "failure");
});

function row(trial: number, completion: CompletionState, outcome: TaskOutcome): TrialRow {
  return {
    run: "r", step: "s", candidate: "agent", model_ref: "agent", deployment_ref: null,
    input: "in", trial, trial_hash: `h${trial}`,
    completion_state: completion, truncated: false, task_outcome: outcome, outcome_reasons: [], rule_version: "v",
    checks: {}, judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0.01, source: "provider-reported" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms: 1000, ttft_ms: null, cache: null, finish_reason: "stop", isolation: null, error: null,
    legacy_status: completion === "success" ? "ok" : "error", legacy_check_passed: null, reused_from: null,
  };
}

test("reliability leaves infra failures out of its denominator; coverage shows them", () => {
  const rows = [
    row(0, "success", "success"),
    row(1, "provider_error", "undetermined"),
    row(2, "cancelled", "undetermined"),
    row(3, "timeout", "failure"),
  ];

  const r = ratesFor("agent", rows);

  assert.equal(r.valid_attempts, 4);
  assert.deepEqual(r.reliability, { value: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(r.task_success_rate, { value: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(r.evaluation_coverage, { value: 0.5, numerator: 2, denominator: 4 });
});

test("a candidate whose every trial hit infra is gated with a reason that says so", () => {
  const r = ratesFor("agent", [row(0, "provider_error", "undetermined"), row(1, "provider_error", "undetermined")]);

  const rec = recommend({
    operatingMode: "lowest-cost", controlCandidate: "agent", requiredChecks: ["reward"], mmd: null,
    directionality: { directional: true, reasons: [] }, candidates: [r],
  });

  assert.equal(rec.chosen, null);
  const removed = rec.filters.flatMap((f) => f.removed).find((x) => x.candidate === "agent");
  assert.match(removed?.reason ?? "", /no attempt completed \(2 infra errors?\)/);
});

test("the run summary does not count an undetermined trial as a miss", () => {
  const rows = [row(0, "success", "success"), row(1, "provider_error", "undetermined")];

  const lines = summaryLines({
    step: "s", candidates: ["agent"], trials: rows, chosen: "agent", firmness: "directional",
    gated: [], ledgerTotal: 0.02, ledgerSource: "provider-reported",
  });

  assert.match(lines.find((l) => l.trimStart().startsWith("agent")) ?? "", /1\/1, 1 undetermined/);
});

test("a trial whose check could not run is neither a check failure nor an unexplained 0/0", () => {
  const graded = { ...row(1, "malformed", "undetermined"), checks: { reward: { state: "evaluator_error" as const, version: "v" } } };
  const passed = { ...row(0, "success", "success"), checks: { reward: { state: "pass" as const, version: "v" } } };

  const lines = summaryLines({
    step: "s", candidates: ["agent"], trials: [graded], chosen: null, firmness: "needs-review",
    gated: [], ledgerTotal: 0, ledgerSource: "none",
  });
  const rec = recommend({
    operatingMode: "lowest-cost", controlCandidate: null, requiredChecks: ["reward"], mmd: null,
    directionality: { directional: true, reasons: [] },
    candidates: [{ ...ratesFor("agent", [graded]), check_states: { pass: 0, fail: 0, not_evaluated: 0, evaluator_error: 1 } }],
  });

  assert.doesNotMatch(lines.find((l) => l.trimStart().startsWith("agent")) ?? "", /0\/1/);
  assert.match(rec.filters.flatMap((f) => f.removed)[0]?.reason ?? "", /no attempt could be graded \(1 evaluator error\)/);
  assert.match(summaryLines({
    step: "s", candidates: ["agent"], trials: [passed, graded], chosen: "agent", firmness: "directional",
    gated: [], ledgerTotal: 0, ledgerSource: "none",
  }).find((l) => l.trimStart().startsWith("agent")) ?? "", /1\/1, 1 undetermined\s+1\/1/);
});
