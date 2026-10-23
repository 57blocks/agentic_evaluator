import { test } from "node:test";
import assert from "node:assert/strict";
import { recommend } from "../src/canon/select.js";
import { ratesFor } from "../src/canon/rates.js";
import type { TrialRow } from "../src/canon/rows.js";
import type { TaskOutcome } from "../src/canon/types.js";

function row(candidate: string, input: string, trial: number, outcome: TaskOutcome, cost = 0.01): TrialRow {
  const pass = outcome === "success";
  return {
    run: "r", step: "s", candidate, model_ref: candidate, deployment_ref: null,
    input, trial, trial_hash: `${candidate}-${input}-${trial}`,
    completion_state: "success", truncated: false, task_outcome: outcome, outcome_reasons: [], rule_version: "success-v1",
    checks: { check: { state: pass ? "pass" : "fail", version: "v" } },
    judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: cost, source: "provider-reported" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms: 1000, ttft_ms: null, cache: null, finish_reason: "stop", isolation: null, error: null,
    legacy_status: "ok", legacy_check_passed: pass, reused_from: null,
  };
}

/** `passing` of `inputs` inputs succeed on every trial; the rest fail. */
function rows(candidate: string, inputs: number, passing: number, trials = 1, cost = 0.01): TrialRow[] {
  return Array.from({ length: inputs }, (_, i) =>
    Array.from({ length: trials }, (_, t) => row(candidate, `in-${i}`, t, i < passing ? "success" : "failure", cost)),
  ).flat();
}

const firmSample = { directional: false as const, reasons: [] };

function decide(mode: string, trials: TrialRow[], gate: number) {
  const ids = [...new Set(trials.map((t) => t.candidate))];
  return recommend({
    operatingMode: mode,
    controlCandidate: null,
    requiredChecks: ["check"],
    eligibility: { minimum_required_check_pass_rate: gate, minimum_reliability: gate },
    mmd: null,
    directionality: firmSample,
    candidates: ids.map((id) => ratesFor(id, trials)),
    trials,
  });
}

test("lowest-cost: 60 of 60 clears a 0.9 gate at the low end of its interval, so firm", () => {
  const rec = decide("lowest-cost", rows("a", 60, 60), 0.9);
  assert.equal(rec.chosen, "a");
  assert.equal(rec.firmness, "firm");
  assert.ok(rec.evidence!.gates.every((g) => g.low >= 0.9));
});

test("lowest-cost: 20 of 20 does not — the true rate could be 0.84", () => {
  const rec = decide("lowest-cost", rows("a", 20, 20), 0.9);
  assert.equal(rec.chosen, "a");
  assert.equal(rec.firmness, "directional");
  assert.ok(rec.firmness_reasons.some((r) => /interval down to 0\.83/.test(r)), rec.firmness_reasons.join("\n"));
});

test("repeated trials count per input: 10 inputs × 3 trials is 10 observations, not 30", () => {
  const rec = decide("lowest-cost", rows("a", 10, 10, 3), 0.9);
  const g = rec.evidence!.gates[0];
  assert.equal(g.n, 10);
  assert.equal(rec.firmness, "directional");
});

test("highest-assurance: a clear per-input win over the runner-up is firm", () => {
  const trials = [...rows("strong", 80, 80), ...rows("weak", 80, 70)];
  const rec = decide("highest-assurance", trials, 0.8);
  assert.equal(rec.chosen, "strong");
  assert.equal(rec.evidence!.versus_runner_up!.a_better, 10);
  assert.equal(rec.firmness, "firm", rec.firmness_reasons.join("\n"));
});

test("highest-assurance: candidates the sign test cannot separate stay directional", () => {
  const trials = [...rows("x", 80, 80), ...rows("y", 80, 77, 1, 0.001)];
  const rec = decide("highest-assurance", trials, 0.8);
  assert.equal(rec.chosen, "x");
  assert.equal(rec.firmness, "directional");
  assert.ok(rec.firmness_reasons.some((r) => r.includes("cannot be told apart")));
});

test("highest-assurance: a tie broken by cost is directional, not firm", () => {
  const trials = [...rows("x", 80, 80, 1, 0.02), ...rows("y", 80, 80, 1, 0.01)];
  const rec = decide("highest-assurance", trials, 0.8);
  assert.equal(rec.chosen, "y");
  assert.equal(rec.firmness, "directional");
  assert.equal(rec.evidence!.versus_runner_up!.same, 80);
});
