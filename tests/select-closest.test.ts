/** When every candidate is gated out, the selector still names the closest one, without adopting it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recommend } from "../src/canon/select.js";
import type { CandidateRates } from "../src/canon/rates.js";
import { recommendationSentence } from "../src/report-copy.js";
import { summaryLines } from "../src/cli/summary.js";

const rate = (n: number, d: number) => ({ value: d > 0 ? n / d : null, numerator: n, denominator: d });

function cand(id: string, pass: number, of: number, cost: number | null): CandidateRates {
  return {
    candidate: id,
    valid_attempts: of,
    classified: of,
    task_success_rate: rate(pass, of),
    reliability: rate(of, of),
    evaluation_coverage: rate(of, of),
    required_check_pass_rate: rate(pass, of),
    completion_states: { success: of, refusal: 0, timeout: 0, malformed: 0, cancelled: 0, provider_error: 0 },
    outcomes: { success: pass, failure: of - pass, undetermined: 0 },
    check_states: { pass, fail: of - pass, not_evaluated: 0, evaluator_error: 0 },
    generation_cost_per_success: cost,
    p50_ms: 5000,
    p95_ms: 8000,
  };
}

const base = {
  operatingMode: "lowest-cost",
  controlCandidate: "a",
  requiredChecks: ["check"],
  mmd: null,
  directionality: { directional: true as const, reasons: ["30 inputs"] },
};

test("nobody passes the gates: nothing is chosen, and the highest pass rate is named closest", () => {
  const rec = recommend({ ...base, candidates: [cand("a", 25, 30, 0.02), cand("b", 26, 29, 0.06), cand("c", 23, 30, 0.004)] });

  assert.equal(rec.chosen, null);
  assert.equal(rec.firmness, "needs-review");
  assert.equal(rec.closest?.candidate, "b");
  assert.match(rec.closest!.reason, /0\.897 \(26\/29\)/);
  assert.deepEqual(rec.closest!.gated_by, ["required-check pass rate 0.897 (26/29) < 1"]);
});

test("a tie on pass rate goes to the cheaper candidate", () => {
  const rec = recommend({ ...base, candidates: [cand("a", 27, 30, 0.02), cand("b", 27, 30, 0.005)] });
  assert.equal(rec.closest?.candidate, "b");
});

test("a candidate with unknown cost loses a tie to one whose cost is known", () => {
  const rec = recommend({ ...base, candidates: [cand("a", 27, 30, null), cand("b", 27, 30, 0.05)] });
  assert.equal(rec.closest?.candidate, "b");
});

test("when a candidate qualifies there is no closest", () => {
  const rec = recommend({ ...base, candidates: [cand("a", 30, 30, 0.02), cand("b", 26, 30, 0.001)] });
  assert.equal(rec.chosen, "a");
  assert.equal(rec.closest, null);
});

test("no operating mode: no closest either, since nothing was gated", () => {
  const rec = recommend({ ...base, operatingMode: null, candidates: [cand("a", 25, 30, 0.02)] });
  assert.equal(rec.closest, null);
});

test("the report sentence names the closest candidate, both its rates, and says it is not adopted", () => {
  // b timed out once: 26/29 graded passed, 26/30 attempts succeeded. The check gate removes it,
  // so the reliability gate never runs on it; the sentence must still show reliability.
  const timedOut = { ...cand("b", 26, 29, 0.06), reliability: rate(26, 30) };
  const rec = recommend({ ...base, candidates: [cand("a", 25, 30, 0.02), timedOut] });
  const s = recommendationSentence(rec);
  assert.match(s, /No candidate passes every gate/);
  assert.match(s, /closest is b/);
  assert.match(s, /required check 89\.7% \(26\/29\)/);
  assert.match(s, /reliability 86\.7% \(26\/30\)/);
  assert.match(s, /not adopted/i);
});

test("the CLI summary line names the closest candidate", () => {
  const lines = summaryLines({
    step: "s",
    candidates: [],
    trials: [],
    chosen: null,
    closest: "b",
    firmness: "needs-review",
    gated: [],
    ledgerTotal: 1,
    ledgerSource: "provider-reported",
  });
  assert.ok(lines.some((l) => l.includes("no candidate qualified · closest b")), lines.join("\n"));
});
