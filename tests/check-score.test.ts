/**
 * A command check may report how much of the deliverable it accepted, not
 * only whether it passed: `{"score": 0.93}` on stdout. Pass/fail still
 * decides success and the gates; the score only separates candidates that
 * pass/fail cannot (two builds that both came up, one passing 41 of 44
 * held-out tests and the other 31), ahead of the judge.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommandCheck } from "../src/check.js";
import { ratesFor, type CandidateRates } from "../src/canon/rates.js";
import { judgeStandings } from "../src/canon/judge-standings.js";
import { recommend } from "../src/canon/select.js";
import type { TrialRow } from "../src/canon/rows.js";

const NODE = process.execPath;

async function check(stdout: unknown, exit = 0) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-check-score-"));
  try {
    return await runCommandCheck({
      argv: [NODE, "-e", `console.log(${JSON.stringify(JSON.stringify(stdout))}); process.exit(${exit})`],
      versionFiles: [],
      timeoutMs: 20_000,
      files: [],
      output: "the deliverable",
      input: "the input",
      meta: { step: "build", candidate: "cand-a", input: "invoice", trial: 0 },
      workDir: dir,
      taskRoot: process.cwd(),
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("a score in [0, 1] on the check's stdout is kept with the result", async () => {
  const result = await check({ evidence: "held-out 41/44", score: 41 / 44 });
  assert.equal(result.state, "pass");
  assert.equal(result.score, 41 / 44);
});

test("a failing check keeps its score too", async () => {
  const result = await check({ evidence: "held-out 3/44", score: 3 / 44 }, 1);
  assert.equal(result.state, "fail");
  assert.equal(result.score, 3 / 44);
});

test("no score, or one that is not a number in [0, 1], is absent and never an evaluator error", async () => {
  for (const bad of [undefined, 1.5, -0.1, "0.9", null, Number.NaN]) {
    const result = await check({ evidence: "ok", ...(bad === undefined ? {} : { score: bad }) });
    assert.equal(result.state, "pass", `score ${String(bad)} changed the verdict`);
    assert.equal(result.score, undefined, `score ${String(bad)} was kept`);
  }
});

function row(candidate: string, input: string, score?: number): TrialRow {
  return {
    candidate,
    input,
    trial: 0,
    completion_state: "success",
    task_outcome: "success",
    checks: { "build-tests": { state: "pass", version: "v1", ...(score === undefined ? {} : { score }) } },
    cost: { generation: 1, source: "estimated" },
    ms: 1000,
  } as unknown as TrialRow;
}

test("the candidate's check score is the mean over its graded trials", () => {
  const r = ratesFor("a", [row("a", "x", 0.5), row("a", "y", 1)]);
  assert.equal(r.required_check_score, 0.75);
});

test("one graded trial without a score leaves the candidate's check score unknown", () => {
  assert.equal(ratesFor("a", [row("a", "x", 0.5), row("a", "y")]).required_check_score, null);
  assert.equal(ratesFor("a", [row("a", "x")]).required_check_score, null);
});

const r = (numerator: number, denominator: number) => ({ value: denominator ? numerator / denominator : null, numerator, denominator });

function rates(candidate: string, score: number | null, cost: number): CandidateRates {
  return {
    candidate,
    valid_attempts: 1,
    classified: 1,
    task_success_rate: r(1, 1),
    reliability: r(1, 1),
    evaluation_coverage: r(1, 1),
    required_check_pass_rate: r(1, 1),
    required_check_score: score,
    completion_states: { success: 1, refusal: 0, timeout: 0, malformed: 0, cancelled: 0, provider_error: 0 },
    outcomes: { success: 1, failure: 0, undetermined: 0 },
    check_states: { pass: 1, fail: 0, not_evaluated: 0, evaluator_error: 0 },
    generation_cost_per_success: cost,
    p50_ms: 1000,
    p95_ms: 1000,
  };
}

/** opus wins every judge duel; sonnet is cheaper. */
const JUDGE = judgeStandings([
  { candidate: "opus", input: "invoice", trial: 0, completion_state: "success", judge: { pairwise: [{ vs: "sonnet", resolved: "win" }], absolute_overall: null, absolute_dimensions: null } },
  { candidate: "sonnet", input: "invoice", trial: 0, completion_state: "success", judge: { pairwise: [{ vs: "opus", resolved: "loss" }], absolute_overall: null, absolute_dimensions: null } },
] as unknown as TrialRow[]);

function pick(opus: number | null, sonnet: number | null) {
  return recommend({
    controlCandidate: null,
    requiredChecks: ["build-tests"],
    mmd: null,
    directionality: { directional: true, reasons: ["1 input"] },
    operatingMode: "highest-assurance",
    candidates: [rates("opus", opus, 71), rates("sonnet", sonnet, 15)],
    judge: JUDGE,
  });
}

test("highest-assurance: among candidates tied on pass rate, the higher check score wins over the judge", () => {
  const rec = pick(31 / 44, 41 / 44);
  assert.equal(rec.chosen, "sonnet");
  assert.match(rec.reasons.join(" "), /required check.s score \(sonnet 93%, next opus 70%\)/);
  assert.doesNotMatch(rec.reasons.join(" "), /judge's pairwise score/);
});

test("highest-assurance: equal check scores fall to the judge", () => {
  const rec = pick(1, 1);
  assert.equal(rec.chosen, "opus");
  assert.match(rec.reasons.join(" "), /judge's pairwise score/);
});

test("highest-assurance: a check score known for only one candidate does not decide", () => {
  const rec = pick(null, 41 / 44);
  assert.equal(rec.chosen, "opus");
  assert.match(rec.reasons.join(" "), /judge's pairwise score/);
});

test("highest-assurance: rates written before check scores existed pick exactly as before", () => {
  const old = (c: string, cost: number) => {
    const { required_check_score: _drop, ...rest } = rates(c, null, cost);
    return rest as CandidateRates;
  };
  const rec = recommend({
    controlCandidate: null,
    requiredChecks: ["build-tests"],
    mmd: null,
    directionality: { directional: true, reasons: ["1 input"] },
    operatingMode: "highest-assurance",
    candidates: [old("opus", 71), old("sonnet", 15)],
    judge: JUDGE,
  });
  assert.equal(rec.chosen, "opus");
});

test("highest-assurance: a candidate the check score put below is named, even when the judge broke the rest", () => {
  const rec = recommend({
    controlCandidate: null,
    requiredChecks: ["build-tests"],
    mmd: null,
    directionality: { directional: true, reasons: ["1 input"] },
    operatingMode: "highest-assurance",
    candidates: [rates("opus", 23 / 24, 19), rates("sonnet", 1, 3), rates("bare", 1, 1)],
    judge: judgeStandings([
      { candidate: "opus", input: "x", trial: 0, completion_state: "success", judge: { pairwise: [{ vs: "sonnet", resolved: "win" }, { vs: "bare", resolved: "win" }], absolute_overall: null, absolute_dimensions: null } },
      { candidate: "sonnet", input: "x", trial: 0, completion_state: "success", judge: { pairwise: [{ vs: "opus", resolved: "loss" }, { vs: "bare", resolved: "win" }], absolute_overall: null, absolute_dimensions: null } },
      { candidate: "bare", input: "x", trial: 0, completion_state: "success", judge: { pairwise: [{ vs: "opus", resolved: "loss" }, { vs: "sonnet", resolved: "loss" }], absolute_overall: null, absolute_dimensions: null } },
    ] as unknown as TrialRow[]),
  });
  assert.equal(rec.chosen, "sonnet");
  const why = rec.reasons.join(" ");
  assert.match(why, /required check's score first \(opus 96% below 100%\), then the judge's pairwise score \(sonnet 50%, next bare 0%\)/);
});

/**
 * A declared minimum meaningful difference, in highest-assurance, is a share
 * (0–1): rates and check scores closer than it to the best count as equal, so
 * one test out of 48 does not outrank the judge.
 */
function pickWithin(mmd: number | null, opus: number, sonnet: number, extra: Partial<CandidateRates> = {}) {
  return recommend({
    controlCandidate: null,
    requiredChecks: ["build-tests"],
    mmd,
    directionality: { directional: true, reasons: ["2 inputs"] },
    operatingMode: "highest-assurance",
    // The default gate is 100% reliability; declare a looser one so a 97% candidate is compared at all.
    eligibility: { minimum_reliability: 0.9, minimum_required_check_pass_rate: 1 },
    candidates: [{ ...rates("opus", opus, 90), ...extra }, rates("sonnet", sonnet, 18)],
    judge: JUDGE,
  });
}

test("highest-assurance with a minimum meaningful difference: a check-score gap below it is a tie, and the judge decides", () => {
  const rec = pickWithin(0.05, 47 / 48, 1);
  assert.equal(rec.chosen, "opus");
  const why = rec.reasons.join(" ");
  assert.match(why, /within the minimum meaningful difference 0\.05/);
  assert.match(why, /judge's pairwise score/);
});

test("highest-assurance with a minimum meaningful difference: a gap at or above it still decides", () => {
  const rec = pickWithin(0.05, 31 / 44, 41 / 44);
  assert.equal(rec.chosen, "sonnet");
  assert.match(rec.reasons.join(" "), /required check's score/);
});

test("highest-assurance with a minimum meaningful difference: a reliability gap below it is a tie too", () => {
  const rec = pickWithin(0.05, 1, 1, { reliability: r(97, 100) });
  assert.equal(rec.chosen, "opus", "a 3-point reliability gap under a 5-point threshold decided");
});

test("highest-assurance without one: any gap still counts, as before", () => {
  assert.equal(pickWithin(null, 47 / 48, 1).chosen, "sonnet");
});

test("highest-assurance ignores a minimum meaningful difference that is not a share, and says so", () => {
  const rec = pickWithin(5, 47 / 48, 1);
  assert.equal(rec.chosen, "sonnet");
  assert.match(rec.reasons.join(" "), /not a share \(0–1\)/);
});
