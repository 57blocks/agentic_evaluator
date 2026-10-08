/**
 * A candidate whose spend the harness cannot see (cost source "none", e.g. an
 * agent run as a command) must never look free: its cost per success is
 * undefined, the ledger's per-success figures are undefined, GAPS says so,
 * and lowest-cost selection names it instead of ranking it at $0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedger } from "../src/canon/cost.js";
import { summaryLines } from "../src/cli/summary.js";
import { ratesFor } from "../src/canon/rates.js";
import type { TrialRow } from "../src/canon/rows.js";
import { recommend } from "../src/canon/select.js";
import type { CostSource } from "../src/canon/types.js";
import { buildGaps } from "../src/canon/write.js";
import { fmtCost } from "../src/report-format.js";
import { ledgerNote, unobservedCostCandidates } from "../src/report-model.js";

function trial(candidate: string, trialNo: number, generation: number, source: CostSource): TrialRow {
  return {
    run: "r", step: "terminal", candidate, model_ref: candidate, deployment_ref: null,
    input: "fix-git", trial: trialNo, trial_hash: `${candidate}-${trialNo}`,
    completion_state: "success", truncated: false, task_outcome: "success", outcome_reasons: [], rule_version: "success-v1",
    checks: { reward: { state: "pass", version: "v" } },
    judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation, source }, tokens: { prompt: 0, completion: 0, cached: null },
    ms: 1000, ttft_ms: null, cache: null, finish_reason: "stop", isolation: null, error: null,
    legacy_status: "ok", legacy_check_passed: true, reused_from: null,
  };
}

test("cost per success is undefined when any of the candidate's attempts had unobserved cost", () => {
  const rows = [trial("agent", 0, 0.07, "estimated"), trial("agent", 1, 0, "none")];

  const r = ratesFor("agent", rows);

  assert.equal(r.generation_cost_per_success, null);
});

test("cost per success is still computed when every attempt's cost was observed", () => {
  const rows = [trial("agent", 0, 0.06, "estimated"), trial("agent", 1, 0.02, "provider-reported")];

  const r = ratesFor("agent", rows);

  assert.equal(r.generation_cost_per_success, 0.04);
});

test("the ledger's per-success and per-attempt figures are undefined when any trial's cost was unobserved", () => {
  const rows = [trial("oracle", 0, 0, "none"), trial("agent", 0, 0.07, "estimated")];

  const ledger = buildLedger(rows, [], "pairwise", "absolute");

  assert.equal(ledger.generation, 0.07);
  assert.equal(ledger.cost_per_success, null);
  assert.equal(ledger.cost_per_attempt, null);
});

test("GAPS names the candidates whose generation cost was not observed", () => {
  const rows = [trial("oracle", 0, 0, "none"), trial("nop", 0, 0, "none"), trial("agent", 0, 0.07, "estimated")];

  const gaps = buildGaps(rows, []);

  assert.match(gaps, /generation cost: \*\*not observed\*\* for 2 trial\(s\) \(nop, oracle\)/);
  assert.match(gaps, /lower bounds/);
});

test("GAPS has no unobserved-cost line when every trial's cost was observed", () => {
  const gaps = buildGaps([trial("agent", 0, 0.07, "estimated")], []);

  assert.doesNotMatch(gaps, /generation cost: \*\*not observed\*\*/);
});

const rate = (n: number, d: number) => ({ value: d > 0 ? n / d : null, numerator: n, denominator: d });
function eligible(candidate: string, cps: number | null) {
  return {
    candidate, valid_attempts: 1, classified: 1,
    task_success_rate: rate(1, 1), reliability: rate(1, 1), evaluation_coverage: rate(1, 1), required_check_pass_rate: rate(1, 1),
    completion_states: { success: 1, refusal: 0, timeout: 0, malformed: 0, cancelled: 0, provider_error: 0 },
    outcomes: { success: 1, failure: 0, undetermined: 0 },
    check_states: { pass: 1, fail: 0, not_evaluated: 0, evaluator_error: 0 },
    generation_cost_per_success: cps, p50_ms: 1000, p95_ms: 1000,
  };
}
const DIRECTIONAL = { directional: true, reasons: ["1 inputs; fewer than 10"] };

test("lowest-cost with no candidate's cost observed picks nobody and names them", () => {
  const rec = recommend({
    operatingMode: "lowest-cost", controlCandidate: "oracle", requiredChecks: ["reward"], mmd: null,
    directionality: DIRECTIONAL,
    candidates: [eligible("oracle", null), eligible("nop", null)],
  });

  assert.equal(rec.chosen, null);
  assert.match(rec.reasons.join(" "), /cost per successful task is undefined for nop, oracle/);
});

test("lowest-cost ranks only observed costs and names the candidates it could not price", () => {
  const rec = recommend({
    operatingMode: "lowest-cost", controlCandidate: "oracle", requiredChecks: ["reward"], mmd: null,
    directionality: DIRECTIONAL,
    candidates: [eligible("oracle", null), eligible("terminus", 0.07)],
  });

  assert.equal(rec.chosen, "terminus");
  assert.match(rec.reasons.join(" "), /not ranked.*oracle/);
});

// ── how it reads ────────────────────────────────────────────────────────────


const MIXED = [trial("oracle", 0, 0, "none"), trial("agent", 0, 0.07, "estimated")];

test("the run summary says a candidate's cost was unobserved instead of printing $0", () => {
  const lines = summaryLines({
    step: "terminal", candidates: ["oracle", "agent"], trials: MIXED, chosen: "agent", firmness: "directional",
    gated: [], ledgerTotal: 0.07, ledgerSource: "estimated",
  });

  const row = (id: string) => lines.find((l) => l.trimStart().startsWith(id)) ?? "";
  assert.match(row("oracle"), /unobserved/);
  assert.doesNotMatch(row("oracle"), /\$0\.0000/);
  assert.match(row("agent"), /\$0\.0700/);
  assert.match(lines.join("\n"), /total \$0\.0700 \(estimated, lower bound\)/);
});

test("a report cell reads 'unobserved' only when the cost was not observed", () => {
  assert.equal(fmtCost(null, false), "unobserved");
  assert.equal(fmtCost(0.07, true), "$0.0700");
  assert.equal(fmtCost(null, true), "—");
});

test("the ledger note names unobserved candidates rather than blaming zero successes", () => {
  const ledger = buildLedger(MIXED, [], "pairwise", "absolute");

  const note = ledgerNote(ledger, MIXED);

  assert.deepEqual(unobservedCostCandidates(MIXED), ["oracle"]);
  assert.match(note, /not observed for oracle/);
  assert.match(note, /lower bound/);
  assert.doesNotMatch(note, /No task succeeded/);
});
