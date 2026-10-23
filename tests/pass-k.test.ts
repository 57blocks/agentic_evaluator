import { test } from "node:test";
import assert from "node:assert/strict";
import { recommend } from "../src/canon/select.js";
import { allTrialsPassRate, ratesFor } from "../src/canon/rates.js";
import type { TrialRow } from "../src/canon/rows.js";
import type { TaskOutcome } from "../src/canon/types.js";
import { summaryLines } from "../src/cli/summary.js";

function row(candidate: string, input: string, trial: number, outcome: TaskOutcome): TrialRow {
  const pass = outcome === "success";
  return {
    run: "r", step: "s", candidate, model_ref: candidate, deployment_ref: null,
    input, trial, trial_hash: `${candidate}-${input}-${trial}`,
    completion_state: "success", truncated: false, task_outcome: outcome, outcome_reasons: [], rule_version: "success-v1",
    checks: outcome === "undetermined" ? {} : { check: { state: pass ? "pass" : "fail", version: "v" } },
    judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0.01, source: "provider-reported" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms: 1000, ttft_ms: null, cache: null, finish_reason: "stop", isolation: null, error: null,
    legacy_status: "ok", legacy_check_passed: pass, reused_from: null,
  };
}

/** Two trials per input; `flaky` of the inputs fail their second trial. */
function twoTrials(candidate: string, inputs: number, flaky: number): TrialRow[] {
  return Array.from({ length: inputs }, (_, i) => [
    row(candidate, `in-${i}`, 0, "success"),
    row(candidate, `in-${i}`, 1, i < flaky ? "failure" : "success"),
  ]).flat();
}

test("pass^k counts an input only when every trial succeeded", () => {
  // Arrange: 10 inputs, 3 flaky → 17/20 trials succeed, 7/10 inputs all pass
  const rows = twoTrials("a", 10, 3);

  // Act
  const r = ratesFor("a", rows);

  // Assert
  assert.equal(r.reliability.value, 17 / 20);
  assert.deepEqual(r.all_trials_pass_rate, { value: 0.7, numerator: 7, denominator: 10 });
});

test("pass^k leaves out an input with an undetermined trial and no failure", () => {
  const rows = [row("a", "in-0", 0, "success"), row("a", "in-0", 1, "undetermined"), row("a", "in-1", 0, "success"), row("a", "in-1", 1, "success")];
  assert.deepEqual(allTrialsPassRate(rows), { value: 1, numerator: 1, denominator: 1 });
});

test("pass^k counts an input with a failure as failed even if another trial is undetermined", () => {
  const rows = [row("a", "in-0", 0, "failure"), row("a", "in-0", 1, "undetermined"), row("a", "in-1", 0, "success"), row("a", "in-1", 1, "success")];
  assert.deepEqual(allTrialsPassRate(rows), { value: 0.5, numerator: 1, denominator: 2 });
});

test("a pass^k gate removes the flaky candidate that reliability alone would keep", () => {
  // Arrange: "steady" passes 90 of 100 inputs both times; "flaky" passes every
  // input once and 20 of them only once → reliability 0.9 for both
  const steady = Array.from({ length: 100 }, (_, i) => [0, 1].map((t) => row("steady", `in-${i}`, t, i < 90 ? "success" : "failure"))).flat();
  const flaky = twoTrials("flaky", 100, 20);
  const trials = [...steady, ...flaky];

  // Act
  const rec = recommend({
    operatingMode: "lowest-cost",
    controlCandidate: null,
    requiredChecks: ["check"],
    eligibility: { minimum_reliability: 0.85, minimum_required_check_pass_rate: 0.85, minimum_all_trials_pass_rate: 0.85 },
    mmd: 0.001,
    directionality: { directional: false, reasons: [] },
    candidates: ["steady", "flaky"].map((id) => ratesFor(id, trials)),
    trials,
  });

  // Assert
  assert.deepEqual(rec.eligible, ["steady"]);
  const gate = rec.filters.find((f) => f.id === "all-trials-pass-rate")!;
  assert.match(gate.removed[0].reason, /pass\^k 0\.800 \(80\/100\) < 0\.85/);
  assert.ok(rec.evidence!.gates.some((g) => g.gate === "all-trials-pass-rate" && g.n === 100));
});

test("the terminal summary shows pass^k only when inputs were tried more than once", () => {
  const base = { step: "s", candidates: ["a"], chosen: "a", firmness: "directional", gated: [], ledgerTotal: 0, ledgerSource: "none" };
  const repeated = summaryLines({ ...base, trials: twoTrials("a", 4, 1) }).join("\n");
  const once = summaryLines({ ...base, trials: [row("a", "in-0", 0, "success")] }).join("\n");
  assert.match(repeated, /pass\^k/);
  assert.match(repeated, /3\/4/);
  assert.doesNotMatch(once, /pass\^k/);
});

test("the terminal summary says how sure and how many inputs carried evidence", () => {
  const trials = [...twoTrials("a", 40, 0), ...twoTrials("b", 40, 10)];
  const rec = recommend({
    operatingMode: "highest-assurance",
    controlCandidate: null,
    requiredChecks: ["check"],
    eligibility: { minimum_reliability: 0.8, minimum_required_check_pass_rate: 0.8 },
    mmd: 0.001,
    directionality: { directional: false, reasons: [] },
    candidates: ["a", "b"].map((id) => ratesFor(id, trials)),
    trials,
  });
  const text = summaryLines({
    step: "s", candidates: ["a", "b"], trials, chosen: rec.chosen, firmness: rec.firmness,
    firmnessReasons: rec.firmness_reasons, evidence: rec.evidence, gated: [], ledgerTotal: 0, ledgerSource: "none",
  }).join("\n");
  assert.match(text, /how sure a is:/);
  assert.match(text, /reliability 40\/40 → 95% 0\.912–1\.000, gate 0\.8 holds/);
  assert.match(text, /vs runner-up b: better on 10 input\(s\), worse on 0, equal on 30 — sign test p 0\.002/);
  assert.match(text, /effective N 10 of 40 inputs/);
});
