/**
 * Under judge-preference the judge decides, so "how sure" must count the
 * judge's verdicts: which inputs it separated, and whether the pick beat the
 * runner-up input by input. The required check alone said 1 of 10 inputs
 * carried evidence on a run where the judge preferred the pick on 8.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { judgePairByInput, pairByInput } from "../src/canon/stats.js";
import { itemStats } from "../src/canon/item-stats.js";
import { judgeStandings } from "../src/canon/judge-standings.js";
import { recommend } from "../src/canon/select.js";
import { certaintyLines } from "../src/cli/certainty-lines.js";
import type { TrialRow } from "../src/canon/rows.js";
import type { CandidateRates } from "../src/canon/rates.js";

type Verdict = "win" | "loss" | "tie";

function row(candidate: string, input: string, pairwise: Array<{ vs: string; resolved: Verdict }> | null): TrialRow {
  return {
    run: "r", step: "s", candidate, model_ref: candidate, deployment_ref: null,
    input, trial: 0, trial_hash: `${candidate}-${input}`,
    completion_state: "success", truncated: false, task_outcome: "success", outcome_reasons: [], rule_version: "success-v1",
    checks: {}, judge: { pairwise, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0, source: "provider-reported" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms: 1, ttft_ms: null, cache: null, finish_reason: "stop", isolation: null, error: null,
    legacy_status: "ok", legacy_check_passed: null, reused_from: null,
  };
}

const flip = (v: Verdict): Verdict => (v === "win" ? "loss" : v === "loss" ? "win" : "tie");

/** Both sides of an a-vs-b duel on each input, from a's point of view. */
function duels(a: string, b: string, verdicts: readonly Verdict[]): TrialRow[] {
  return verdicts.flatMap((v, i) => [row(a, `in-${i}`, [{ vs: b, resolved: v }]), row(b, `in-${i}`, [{ vs: a, resolved: flip(v) }])]);
}

const rate = (numerator: number, denominator: number) => ({
  value: denominator > 0 ? numerator / denominator : null,
  numerator,
  denominator,
});

function rates(candidate: string): CandidateRates {
  return {
    candidate,
    valid_attempts: 10,
    classified: 10,
    task_success_rate: rate(10, 10),
    reliability: rate(10, 10),
    evaluation_coverage: rate(10, 10),
    required_check_pass_rate: rate(10, 10),
    completion_states: { success: 10, refusal: 0, timeout: 0, malformed: 0, cancelled: 0, provider_error: 0 },
    outcomes: { success: 10, failure: 0, undetermined: 0 },
    check_states: { pass: 10, fail: 0, not_evaluated: 0, evaluator_error: 0 },
    generation_cost_per_success: 0.01,
    p50_ms: 1000,
    p95_ms: 2000,
  };
}

function judgePick(trials: TrialRow[]) {
  return recommend({
    operatingMode: "judge-preference",
    controlCandidate: "base",
    requiredChecks: ["check"],
    eligibility: { minimum_reliability: 0, minimum_required_check_pass_rate: 0 },
    mmd: null,
    directionality: { directional: true, reasons: ["no minimum meaningful difference declared"] },
    candidates: [rates("base"), rates("variant")],
    judge: judgeStandings(trials),
    trials,
  });
}

const EIGHT_OH = ["win", "win", "win", "win", "win", "win", "win", "win", "tie", "tie"] as const;

test("the judge's pairing counts each input once, by its verdict", () => {
  const v = judgePairByInput(duels("variant", "base", EIGHT_OH), "variant", "base");
  assert.deepEqual([v.a_better, v.b_better, v.same, v.compared], [8, 0, 2, 10]);
  assert.equal(v.basis, "judge");
  assert.ok(v.significant, `8-0 should be significant, p ${v.p_value}`);
  assert.equal(pairByInput([], "a", "b").basis, "task-success");
});

test("effective N counts the inputs the judge separated beside those the check did", () => {
  const s = itemStats(duels("variant", "base", EIGHT_OH));
  assert.equal(s.effective_n, 0, "every trial passed the check");
  assert.equal(s.judge_effective_n, 8);
  assert.equal(itemStats([row("a", "x", null), row("b", "x", null)]).judge_effective_n, null, "no pairwise judging ran");
});

test("a judge-preference pick carries the judge's input-by-input contest with the runner-up", () => {
  const rec = judgePick(duels("variant", "base", EIGHT_OH));
  assert.equal(rec.chosen, "variant");
  assert.equal(rec.evidence?.versus_runner_up?.b, "base");
  assert.equal(rec.evidence?.versus_runner_up?.basis, "judge");
  // Still capped: one model's opinion is not a measured outcome.
  assert.equal(rec.firmness, "directional");
  assert.ok(!rec.firmness_reasons.some((r) => r.includes("cannot be told apart")));
});

test("a judge-preference pick the judge did not separate from the runner-up says so", () => {
  const rec = judgePick(duels("variant", "base", ["win", "win", "loss", "tie", "tie"]));
  assert.equal(rec.chosen, "variant");
  assert.ok(
    rec.firmness_reasons.some((r) => r.startsWith("variant and base cannot be told apart by the judge")),
    rec.firmness_reasons.join("\n"),
  );
});

test("the terminal names what each count is over", () => {
  const trials = duels("variant", "base", EIGHT_OH);
  const rec = judgePick(trials);
  const lines = certaintyLines({
    chosen: rec.chosen,
    firmness: rec.firmness,
    firmnessReasons: rec.firmness_reasons,
    evidence: rec.evidence,
    items: itemStats(trials),
  }).join("\n");
  assert.match(lines, /vs runner-up base, by the judge: preferred on 8 input\(s\), dispreferred on 0, tied on 2/);
  assert.match(lines, /effective N 0 of 10 inputs separated the candidates on the required check; the judge separated 8/);
});
