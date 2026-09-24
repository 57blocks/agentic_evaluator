import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { recommend, recommendFromCanon, resolveEligibility, SELECT_RULE_VERSION } from "../src/canon/select.js";
import type { CandidateRates } from "../src/canon/rates.js";
import type { RunManifest } from "../src/canon/manifest.js";
import type { CanonSummary } from "../src/canon/write.js";
import { loadBundle, renderRunReport } from "../src/report-v2.js";

const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures");

const rate = (n: number, d: number) => ({
  value: d > 0 ? n / d : null,
  numerator: n,
  denominator: d,
});

function cand(id: string, over: Partial<CandidateRates> = {}): CandidateRates {
  return {
    candidate: id,
    valid_attempts: 9,
    classified: 9,
    task_success_rate: rate(9, 9),
    reliability: rate(9, 9),
    evaluation_coverage: rate(9, 9),
    required_check_pass_rate: rate(9, 9),
    completion_states: { success: 9, refusal: 0, timeout: 0, malformed: 0, cancelled: 0, provider_error: 0 },
    outcomes: { success: 9, failure: 0, undetermined: 0 },
    check_states: { pass: 9, fail: 0, not_evaluated: 0, evaluator_error: 0 },
    generation_cost_per_success: 0.01,
    p50_ms: 5000,
    p95_ms: 8000,
    ...over,
  };
}

const directional = { directional: true as const, reasons: ["3 inputs; fewer than 10"] };
const firmSample = { directional: false as const, reasons: [] };

test("resolveEligibility defaults to 1.0 gates when required checks exist", () => {
  assert.deepEqual(resolveEligibility(["tsc-noemit"]), {
    minimum_reliability: 1,
    minimum_required_check_pass_rate: 1,
    maximum_p95_ms: null,
    cost_ceiling_per_success_usd: null,
  });
});

test("resolveEligibility does not invent gates when no required checks", () => {
  assert.equal(resolveEligibility([]).minimum_reliability, null);
  assert.equal(resolveEligibility([]).minimum_required_check_pass_rate, null);
});

test("frozen null stays not-applied even when checks exist", () => {
  const frozen = resolveEligibility(["tsc-noemit"], {
    minimum_reliability: null,
    minimum_required_check_pass_rate: 1,
    maximum_p95_ms: null,
    cost_ceiling_per_success_usd: null,
  });
  assert.equal(frozen.minimum_reliability, null);
  assert.equal(frozen.minimum_required_check_pass_rate, 1);
});

test("cheaper candidate that fails a required check is not chosen", () => {
  const rec = recommend({
    operatingMode: "lowest-cost",
    controlCandidate: "sonnet-5",
    requiredChecks: ["tsc-noemit"],
    mmd: null,
    directionality: directional,
    candidates: [
      cand("sonnet-5", { generation_cost_per_success: 0.00755 }),
      cand("deepseek-v4-pro", {
        reliability: rate(8, 9),
        required_check_pass_rate: rate(8, 9),
        task_success_rate: rate(8, 9),
        outcomes: { success: 8, failure: 1, undetermined: 0 },
        check_states: { pass: 8, fail: 1, not_evaluated: 0, evaluator_error: 0 },
        generation_cost_per_success: 0.003301,
      }),
      cand("kimi-k3", { generation_cost_per_success: 0.042528, p50_ms: 26115, p95_ms: 115511 }),
    ],
  });
  assert.equal(rec.rule_version, SELECT_RULE_VERSION);
  assert.equal(rec.chosen, "sonnet-5");
  assert.equal(rec.firmness, "directional");
  assert.deepEqual(rec.eligible, ["sonnet-5", "kimi-k3"]);
  assert.ok(rec.filters.some((f) => f.removed.some((r) => r.candidate === "deepseek-v4-pro")));
  assert.equal(rec.compared_to_control?.beats_control, false);
});

test("a step without required checks cannot qualify any candidate", () => {
  const rec = recommend({
    operatingMode: "highest-assurance",
    controlCandidate: "sonnet-5",
    requiredChecks: [],
    mmd: null,
    directionality: directional,
    candidates: [
      cand("sonnet-5", {
        classified: 0,
        task_success_rate: rate(0, 0),
        reliability: rate(0, 4),
        evaluation_coverage: rate(0, 4),
        required_check_pass_rate: rate(0, 0),
        outcomes: { success: 0, failure: 0, undetermined: 4 },
      }),
    ],
  });
  assert.equal(rec.chosen, null);
  assert.equal(rec.firmness, "needs-review");
  assert.equal(rec.eligible.length, 0);
});

test("fastest-within-cost-ceiling without a ceiling does not pick", () => {
  const rec = recommend({
    operatingMode: "fastest-within-cost-ceiling",
    controlCandidate: null,
    requiredChecks: ["tsc-noemit"],
    mmd: null,
    directionality: firmSample,
    candidates: [cand("a", { p50_ms: 1000 }), cand("b", { p50_ms: 2000 })],
  });
  assert.equal(rec.chosen, null);
  assert.equal(rec.firmness, "needs-review");
  assert.ok(rec.reasons.some((r) => r.includes("cost_ceiling_per_success_usd")));
});

test("fastest-within-cost-ceiling picks lowest p50 under the ceiling", () => {
  const rec = recommend({
    operatingMode: "fastest-within-cost-ceiling",
    controlCandidate: "slow",
    requiredChecks: ["tsc-noemit"],
    eligibility: { cost_ceiling_per_success_usd: 0.05 },
    mmd: null,
    directionality: firmSample,
    candidates: [
      cand("slow", { p50_ms: 9000, generation_cost_per_success: 0.01 }),
      cand("fast", { p50_ms: 1000, generation_cost_per_success: 0.02 }),
      cand("cheap-but-over-ceiling", { p50_ms: 500, generation_cost_per_success: 0.2 }),
    ],
  });
  assert.equal(rec.chosen, "fast");
  assert.equal(rec.firmness, "firm");
  assert.ok(!rec.eligible.includes("cheap-but-over-ceiling"));
});

test("difference below declared MMD keeps the control", () => {
  const rec = recommend({
    operatingMode: "lowest-cost",
    controlCandidate: "control",
    requiredChecks: ["tsc-noemit"],
    mmd: 0.05,
    directionality: firmSample,
    candidates: [
      cand("control", { generation_cost_per_success: 0.1 }),
      cand("other", { generation_cost_per_success: 0.09 }),
    ],
  });
  assert.equal(rec.chosen, "control");
  assert.match(rec.reasons[0] ?? "", /minimum meaningful difference/);
});

test("difference at or above MMD may leave the control", () => {
  const rec = recommend({
    operatingMode: "lowest-cost",
    controlCandidate: "control",
    requiredChecks: ["tsc-noemit"],
    mmd: 0.05,
    directionality: firmSample,
    candidates: [
      cand("control", { generation_cost_per_success: 0.1 }),
      cand("other", { generation_cost_per_success: 0.04 }),
    ],
  });
  assert.equal(rec.chosen, "other");
  assert.equal(rec.compared_to_control?.beats_control, true);
});

test("highest-assurance ranks reliability before cost", () => {
  const rec = recommend({
    operatingMode: "highest-assurance",
    controlCandidate: null,
    requiredChecks: ["tsc-noemit"],
    eligibility: { minimum_reliability: 0.5, minimum_required_check_pass_rate: 0.5 },
    mmd: null,
    directionality: firmSample,
    candidates: [
      cand("cheap", { reliability: rate(8, 10), required_check_pass_rate: rate(8, 10), generation_cost_per_success: 0.001 }),
      cand("solid", { reliability: rate(10, 10), required_check_pass_rate: rate(10, 10), generation_cost_per_success: 0.05 }),
    ],
  });
  assert.equal(rec.chosen, "solid");
});

test("recommend is deterministic", () => {
  const input = {
    operatingMode: "lowest-cost" as const,
    controlCandidate: "a",
    requiredChecks: ["tsc-noemit"],
    mmd: null,
    directionality: directional,
    candidates: [cand("b", { generation_cost_per_success: 0.02 }), cand("a", { generation_cost_per_success: 0.01 })],
  };
  assert.deepEqual(recommend(input), recommend(input));
});

test("codegen-w38 fixture: deepseek gated, sonnet-5 recommended lowest-cost, directional", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(FIXTURES, "codegen-w38", "manifest.json"), "utf-8")) as RunManifest;
  const summary = JSON.parse(await fs.readFile(path.join(FIXTURES, "codegen-w38", "summary.json"), "utf-8")) as CanonSummary;
  const rec = recommendFromCanon(manifest, summary);
  assert.equal(rec.chosen, "sonnet-5");
  assert.equal(rec.firmness, "directional");
  assert.ok(!rec.eligible.includes("deepseek-v4-pro"));
  assert.ok(rec.eligible.includes("kimi-k3"));
});

test("prd-w38 fixture: no required checks → no recommendation", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(FIXTURES, "prd-w38", "manifest.json"), "utf-8")) as RunManifest;
  const summary = JSON.parse(await fs.readFile(path.join(FIXTURES, "prd-w38", "summary.json"), "utf-8")) as CanonSummary;
  const rec = recommendFromCanon(manifest, summary);
  assert.equal(rec.chosen, null);
  assert.equal(rec.firmness, "needs-review");
});

test("canonical report for codegen fixture names the recommendation, not pairwise champion", async () => {
  const html = renderRunReport(await loadBundle(path.join(FIXTURES, "codegen-w38")));
  assert.match(html, /sonnet-5/);
  assert.match(html, /select-v1/);
  assert.doesNotMatch(html, /makes no recommendation/);
});
