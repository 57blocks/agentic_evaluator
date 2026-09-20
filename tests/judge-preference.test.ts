import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeStandings } from "../src/canon/judge-standings.js";
import { recommend } from "../src/canon/select.js";
import type { TrialRow } from "../src/canon/rows.js";
import type { CandidateRates } from "../src/canon/rates.js";

function trial(
  candidate: string,
  trialIndex: number,
  pairwise: Array<{ vs: string; resolved: "win" | "loss" | "tie" }> | null,
  absolute: number | null,
): TrialRow {
  return {
    candidate,
    trial: trialIndex,
    input: "case-1",
    completion_state: "success",
    task_outcome: "undetermined",
    judge: { pairwise, absolute_overall: absolute, absolute_dimensions: null },
  } as unknown as TrialRow;
}

const rate = (numerator: number, denominator: number) => ({
  value: denominator > 0 ? numerator / denominator : null,
  numerator,
  denominator,
});

function rates(candidate: string, over: Partial<CandidateRates> = {}): CandidateRates {
  return {
    candidate,
    valid_attempts: 2,
    classified: 0,
    task_success_rate: rate(0, 0),
    reliability: rate(0, 2),
    evaluation_coverage: rate(0, 2),
    required_check_pass_rate: rate(0, 0),
    completion_states: { success: 2, refusal: 0, timeout: 0, malformed: 0, cancelled: 0, provider_error: 0 },
    outcomes: { success: 0, failure: 0, undetermined: 2 },
    check_states: { pass: 0, fail: 0, not_evaluated: 0, evaluator_error: 0 },
    generation_cost_per_success: null,
    p50_ms: 1000,
    p95_ms: 2000,
    ...over,
  };
}

const TRIALS: TrialRow[] = [
  trial("alpha", 0, [{ vs: "beta", resolved: "win" }, { vs: "gamma", resolved: "loss" }], 4),
  trial("alpha", 1, null, 4),
  trial("beta", 0, [{ vs: "alpha", resolved: "loss" }, { vs: "gamma", resolved: "loss" }], 2),
  trial("beta", 1, null, 2),
  trial("gamma", 0, [{ vs: "alpha", resolved: "win" }, { vs: "beta", resolved: "win" }], 4),
  trial("gamma", 1, null, 4),
];

const BASE = {
  controlCandidate: "alpha",
  requiredChecks: [] as string[],
  mmd: null,
  directionality: { directional: true, reasons: ["fewer than 10 inputs"] },
  candidates: [rates("alpha"), rates("beta"), rates("gamma")],
  judge: judgeStandings(TRIALS),
};

test("judgeStandings counts duels and averages the absolute scores", () => {
  const standings = judgeStandings(TRIALS);
  assert.deepEqual(standings.map((s) => s.candidate), ["alpha", "beta", "gamma"]);
  const gamma = standings.find((s) => s.candidate === "gamma")!;
  assert.deepEqual([gamma.wins, gamma.losses, gamma.ties, gamma.comparisons], [2, 0, 0, 2]);
  assert.equal(gamma.win_rate, 1);
  assert.equal(gamma.absolute_mean, 4);
  assert.equal(gamma.absolute_scored, 2);
});

test("a candidate that was never judged has null standings, not zero", () => {
  const [only] = judgeStandings([trial("solo", 0, null, null)]);
  assert.equal(only.win_rate, null);
  assert.equal(only.absolute_mean, null);
  assert.equal(only.comparisons, 0);
});

test("judge-preference ranks on the judge verdicts and picks the winner", () => {
  const rec = recommend({ ...BASE, operatingMode: "judge-preference" });
  assert.equal(rec.chosen, "gamma");
  assert.match(rec.reasons.join(" "), /2–0–0 over 2 comparison/);
});

test("judge-preference can never be firm, whatever the sample", () => {
  const rec = recommend({
    ...BASE,
    operatingMode: "judge-preference",
    directionality: { directional: false, reasons: [] },
  });
  assert.equal(rec.firmness, "directional");
  assert.match(rec.reasons.join(" "), /rests entirely on the judge model/);
});

test("judge-preference does not remove candidates for lacking required checks", () => {
  const rec = recommend({ ...BASE, operatingMode: "judge-preference" });
  assert.equal(rec.filters.some((f) => f.id === "qualifying-success-criteria"), false);
  assert.deepEqual(rec.eligible, ["alpha", "beta", "gamma"]);
});

test("every other mode still refuses a step with no required check", () => {
  const rec = recommend({ ...BASE, operatingMode: "highest-assurance" });
  assert.equal(rec.chosen, null);
  assert.equal(rec.firmness, "needs-review");
  assert.match(rec.reasons.join(" "), /no candidate passed eligibility gates/);
});

test("judge-preference still honours declared eligibility gates", () => {
  const rec = recommend({
    ...BASE,
    operatingMode: "judge-preference",
    eligibility: { minimum_reliability: 0.5 },
    candidates: [
      rates("alpha", { reliability: rate(2, 2) }),
      rates("beta", { reliability: rate(2, 2) }),
      rates("gamma", { reliability: rate(0, 2) }),
    ],
  });
  assert.equal(rec.eligible.includes("gamma"), false, "an unreliable candidate won on judge opinion");
  assert.equal(rec.chosen, "alpha");
});

test("judge-preference reports no choice when nobody was judged", () => {
  const rec = recommend({
    ...BASE,
    operatingMode: "judge-preference",
    judge: judgeStandings([trial("alpha", 0, null, null)]),
  });
  assert.equal(rec.chosen, null);
  assert.match(rec.reasons.join(" "), /no eligible candidate carries a judge verdict/);
});

test("the decision trace records the judge numbers it ranked on", () => {
  const rec = recommend({ ...BASE, operatingMode: "judge-preference" });
  const gamma = rec.tradeoffs.find((t) => t.candidate === "gamma")!;
  assert.deepEqual(gamma.judge, { win_rate: 1, wins: 2, comparisons: 2, absolute_mean: 4 });
  const other = recommend({ ...BASE, operatingMode: "highest-assurance" });
  assert.equal(other.tradeoffs[0].judge, undefined, "judge numbers leaked into a measured mode");
});
