/**
 * Judge saturation: a grader that says 5 to everything must not rank anyone.
 *
 * Taken from a real run — every dimension of every candidate in all three
 * steps came back 5, while the pairwise judge was meanwhile calling out an
 * invented feature in one of those same outputs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeDiscrimination, saturationGap } from "../src/canon/discrimination.js";
import type { TrialRow } from "../src/canon/rows.js";
import { recommend } from "../src/canon/select.js";
import { toEvaluationRows } from "../src/canon/adapt.js";
import type { CandidateRates } from "../src/canon/rates.js";

function trial(candidate: string, overall: number | null, dims: Record<string, number>): TrialRow {
  return {
    run: "r",
    step: "prd",
    candidate,
    model_ref: candidate,
    deployment_ref: null,
    input: "todo-app",
    trial: 0,
    trial_hash: `${candidate}-h`,
    completion_state: "success",
    truncated: false,
    task_outcome: "undetermined",
    outcome_reasons: [],
    rule_version: "success-v1",
    checks: {},
    judge: {
      pairwise: null,
      absolute_overall: overall,
      absolute_dimensions: Object.keys(dims).length > 0 ? dims : null,
    },
    cost: { generation: 0.01, source: "provider-reported" },
    tokens: { prompt: 10, completion: 10, cached: null },
    ms: 100,
    ttft_ms: null,
    cache: null,
    finish_reason: "stop",
    error: null,
    legacy_status: "ok",
    legacy_check_passed: null,
    reused_from: null,
  };
}

function rates(candidate: string, over: Partial<CandidateRates> = {}): CandidateRates {
  return {
    candidate,
    trials: 1,
    completion_states: {},
    task_success_rate: { value: null, numerator: 0, denominator: 0 },
    reliability: { value: null, numerator: 0, denominator: 0 },
    required_check_pass_rate: { value: null, numerator: 0, denominator: 0 },
    evaluation_coverage: { value: null, numerator: 0, denominator: 0 },
    first_pass_success_rate: { value: null, numerator: 0, denominator: 0 },
    autonomous_completion_rate: { value: null, numerator: 0, denominator: 0 },
    generation_cost_per_success: null,
    generation_cost_per_attempt: 0.01,
    p50_ms: 100,
    p95_ms: 100,
    ...over,
  } as CandidateRates;
}

const DIRECTIONAL = { directional: true, reasons: ["1 inputs; fewer than 10"] };

test("one distinct score across graded trials is saturation, not agreement", () => {
  // Arrange — the real shape: two candidates, every dimension 5.
  const trials = [
    trial("sonnet-5", 5, { completeness: 5, "no-hallucination": 5 }),
    trial("deepseek-v4-pro", 5, { completeness: 5, "no-hallucination": 5 }),
  ];

  // Act
  const d = judgeDiscrimination(trials);

  // Assert
  assert.equal(d.discriminates, false);
  assert.deepEqual(d.saturated.sort(), ["completeness", "no-hallucination", "overall"]);
  assert.match(saturationGap(d) ?? "", /every graded trial scored 5/);
});

test("differing scores discriminate and raise no gap", () => {
  const d = judgeDiscrimination([
    trial("a", 5, { completeness: 5 }),
    trial("b", 3, { completeness: 2 }),
  ]);

  assert.equal(d.discriminates, true);
  assert.deepEqual(d.saturated, []);
  assert.equal(saturationGap(d), null);
});

test("a single graded trial is not called saturated", () => {
  const d = judgeDiscrimination([trial("a", 5, { completeness: 5 })]);
  assert.equal(d.dimensions[0].saturated, false);
  assert.equal(d.overall.saturated, false);
});

test("judge-preference refuses to choose on saturated scores alone", () => {
  // Arrange — no pairwise verdict anywhere, identical absolute scores.
  const trials = [trial("sonnet-5", 5, { completeness: 5 }), trial("deepseek-v4-pro", 5, { completeness: 5 })];

  // Act
  const rec = recommend({
    operatingMode: "judge-preference",
    controlCandidate: null,
    requiredChecks: [],
    mmd: null,
    directionality: DIRECTIONAL,
    candidates: [rates("sonnet-5"), rates("deepseek-v4-pro")],
    judge: [
      { candidate: "sonnet-5", wins: 0, losses: 0, ties: 0, comparisons: 0, win_rate: null, absolute_mean: 5, absolute_scored: 1 },
      { candidate: "deepseek-v4-pro", wins: 0, losses: 0, ties: 0, comparisons: 0, win_rate: null, absolute_mean: 5, absolute_scored: 1 },
    ],
    absoluteDiscriminates: judgeDiscrimination(trials).discriminates,
  });

  // Assert
  assert.equal(rec.chosen, null);
  assert.equal(rec.firmness, "needs-review");
  assert.match(rec.reasons.join(" "), /no usable judge evidence/);
});

test("a pairwise win still decides when the absolute scale is saturated", () => {
  const rec = recommend({
    operatingMode: "judge-preference",
    controlCandidate: null,
    requiredChecks: [],
    mmd: null,
    directionality: DIRECTIONAL,
    candidates: [rates("sonnet-5"), rates("deepseek-v4-pro")],
    judge: [
      { candidate: "sonnet-5", wins: 1, losses: 0, ties: 0, comparisons: 1, win_rate: 1, absolute_mean: 5, absolute_scored: 1 },
      { candidate: "deepseek-v4-pro", wins: 0, losses: 1, ties: 0, comparisons: 1, win_rate: 0, absolute_mean: 5, absolute_scored: 1 },
    ],
    absoluteDiscriminates: false,
  });

  assert.equal(rec.chosen, "sonnet-5");
  assert.match(rec.reasons.join(" "), /absolute scores ignored/);
});

test("the canonical row keeps the grader's reason beside each score", () => {
  // Arrange — the scorer's prompt demands a checkable reason per dimension.
  const rows = toEvaluationRows({
    runId: "r",
    step: "prd",
    requiredChecks: [],
    checkId: "tsc-noemit",
    pairwiseId: "pairwise-swap",
    absoluteId: "absolute-1-5",
    versions: { check: null, pairwise: "p@1", absolute: "a@1" },
    records: [],
    judgements: [],
    judgeFailures: [],
    skippedPairs: [],
    scores: [
      {
        candidate: "sonnet-5",
        inputSlug: "todo-app",
        trial: 0,
        dimensions: { "no-hallucination": 5 },
        overall: 5,
        reasons: {
          dimensions: { "no-hallucination": "Every requirement traces to the brief; no invented screens." },
          overall: "Complete and disciplined.",
        },
        usage: { calls: 1, costUsd: 0.01, retryCostUsd: 0, costSource: "provider-reported", ms: 10 },
      },
    ],
    scoreFailures: [],
  });

  // Act
  const absolute = rows.find((r) => r.evaluator === "absolute-1-5");

  // Assert
  assert.equal(absolute?.score_detail?.["no-hallucination"].score, 5);
  assert.match(absolute?.score_detail?.["no-hallucination"].reason ?? "", /no invented screens/);
  assert.equal(absolute?.reason, "Complete and disciplined.");
});

test("the only candidate that produced output is named as such, not as a preference", () => {
  // Arrange — the real taskbreakdown step: one candidate timed out entirely.
  const rec = recommend({
    operatingMode: "judge-preference",
    controlCandidate: null,
    requiredChecks: [],
    mmd: null,
    directionality: DIRECTIONAL,
    candidates: [rates("sonnet-5"), rates("deepseek-v4-pro")],
    judge: [
      { candidate: "sonnet-5", wins: 0, losses: 0, ties: 0, comparisons: 0, win_rate: null, absolute_mean: 5, absolute_scored: 1 },
      { candidate: "deepseek-v4-pro", wins: 0, losses: 0, ties: 0, comparisons: 0, win_rate: null, absolute_mean: null, absolute_scored: 0 },
    ],
    absoluteDiscriminates: true,
  });

  assert.equal(rec.chosen, "sonnet-5");
  assert.match(rec.reasons.join(" "), /last one standing, not a preference/);
});
