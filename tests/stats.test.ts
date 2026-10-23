import { test } from "node:test";
import assert from "node:assert/strict";
import { inputsToClearGate, minDetectableGap, pairByInput, signTestP, wilson, MIN_DIFFERING_INPUTS } from "../src/canon/stats.js";
import type { TrialRow } from "../src/canon/rows.js";
import type { TaskOutcome } from "../src/canon/types.js";

function row(candidate: string, input: string, trial: number, outcome: TaskOutcome): TrialRow {
  return {
    run: "r", step: "s", candidate, model_ref: candidate, deployment_ref: null,
    input, trial, trial_hash: `${candidate}-${input}-${trial}`,
    completion_state: "success", truncated: false, task_outcome: outcome, outcome_reasons: [], rule_version: "success-v1",
    checks: {}, judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0, source: "provider-reported" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms: 1, ttft_ms: null, cache: null, finish_reason: "stop", isolation: null, error: null,
    legacy_status: "ok", legacy_check_passed: null, reused_from: null,
  };
}

test("wilson: 30 of 30 still leaves the true rate as low as ~0.886", () => {
  const ci = wilson(30, 30)!;
  assert.ok(Math.abs(ci.low - 0.8865) < 0.001, `low ${ci.low}`);
  assert.equal(ci.high, 1);
});

test("wilson: half-way rate is symmetric and nothing observed is null", () => {
  const ci = wilson(50, 100)!;
  assert.ok(Math.abs(ci.low - 0.4038) < 0.001);
  assert.ok(Math.abs(ci.high - 0.5962) < 0.001);
  assert.equal(wilson(0, 0), null);
});

test("sign test: 6–0 is the smallest one-sided split under 0.05; 5–0 is not", () => {
  assert.ok(Math.abs(signTestP(6, 0) - 0.03125) < 1e-9);
  assert.ok(Math.abs(signTestP(5, 0) - 0.0625) < 1e-9);
  assert.equal(signTestP(0, 0), 1);
  assert.equal(signTestP(3, 3), 1);
  assert.equal(MIN_DIFFERING_INPUTS, 6);
});

test("sign test: 18–2 is decisive", () => {
  assert.ok(signTestP(18, 2) < 0.001);
});

test("pairByInput: trials collapse per input; only inputs that differ count", () => {
  const rows = [
    // in-1: a 2/2, b 0/2 → a better
    row("a", "in-1", 0, "success"), row("a", "in-1", 1, "success"),
    row("b", "in-1", 0, "failure"), row("b", "in-1", 1, "failure"),
    // in-2: a 1/2, b 1/2 → same
    row("a", "in-2", 0, "success"), row("a", "in-2", 1, "failure"),
    row("b", "in-2", 0, "failure"), row("b", "in-2", 1, "success"),
    // in-3: a 0/1 (one undetermined), b 1/2 → b better
    row("a", "in-3", 0, "failure"), row("a", "in-3", 1, "undetermined"),
    row("b", "in-3", 0, "success"), row("b", "in-3", 1, "failure"),
    // in-4: only a has a classified trial → not compared
    row("a", "in-4", 0, "success"), row("b", "in-4", 0, "undetermined"),
  ];
  const p = pairByInput(rows, "a", "b");
  assert.equal(p.compared, 3);
  assert.equal(p.a_better, 1);
  assert.equal(p.b_better, 1);
  assert.equal(p.same, 1);
  assert.equal(p.p_value, 1);
  assert.equal(p.significant, false);
});

test("pairByInput: six inputs all one way is significant for a", () => {
  const rows = [1, 2, 3, 4, 5, 6].flatMap((i) => [row("a", `in-${i}`, 0, "success"), row("b", `in-${i}`, 0, "failure")]);
  const p = pairByInput(rows, "a", "b");
  assert.equal(p.a_better, 6);
  assert.equal(p.significant, true);
});

test("minDetectableGap: 6 of n inputs, null when fewer than 6", () => {
  assert.equal(minDetectableGap(30), 0.2);
  assert.equal(minDetectableGap(300), 0.02);
  assert.equal(minDetectableGap(5), null);
});

test("inputsToClearGate: a perfect record clears 0.9 from 35 inputs; 1.0 never", () => {
  assert.equal(inputsToClearGate(0.9), 35);
  assert.ok(wilson(35, 35)!.low >= 0.9);
  assert.ok(wilson(34, 34)!.low < 0.9);
  assert.equal(inputsToClearGate(0.95), 73);
  assert.equal(inputsToClearGate(1), null);
});
