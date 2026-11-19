/**
 * `decision: scorecard` on a step: report each candidate's results and pick
 * nobody. No gate is applied, the recommendation is the defined value "no
 * pick (scorecard)" (`chosen: null`, `firmness: "scorecard"`), and every
 * reader of a recommendation — the run's own output, report, workflow page,
 * diff, combine, dashboard catalog and overview — says so rather than
 * "no candidate qualified".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runSuite } from "../src/core/execute.js";
import { loadWorkflow } from "../src/spec/load-spec.js";
import { recommendFromCanon, type Recommendation } from "../src/canon/select.js";
import { loadBundle, renderRunReport } from "../src/report-v2.js";
import { buildStepReport } from "../src/report-model.js";
import { writeWorkflowReport } from "../src/report-workflow.js";
import { diffRuns } from "../src/canon/run-diff.js";
import { diffLines } from "../src/cli/diff-lines.js";
import { loadRunSide } from "../src/core/run-diff-load.js";
import { listTasks, loadRun } from "../src/demo/catalog.js";
import { buildOverview } from "../src/server/overview.js";
import { workspaceAt } from "../src/core/workspace.js";
import { pickLabel } from "../src/report-format.js";
import { summaryLines } from "../src/cli/summary.js";
import { itemStats } from "../src/canon/item-stats.js";
import type { CandidateRates } from "../src/canon/rates.js";

const SAMPLE = path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check");

/** custom-check in its own workspace: careful passes the check, sloppy fails it; the gates (1.0) would remove sloppy. */
async function task(edit: (yaml: string) => string = (y) => y): Promise<{ spec: string; ws: string }> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "scorecard-"));
  const dir = path.join(ws, "tasks", "card");
  await fs.cp(SAMPLE, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  const spec = path.join(dir, "spec.yaml");
  await fs.writeFile(spec, edit(await fs.readFile(spec, "utf-8")));
  return { spec, ws };
}

const SCORECARD = (yaml: string) => yaml.replace("      operating_mode: lowest-cost\n", "      operating_mode: lowest-cost\n      decision: scorecard\n");

/* ── the spec ────────────────────────────────────────────────────────────── */

test("decision is validated: pick or scorecard, nothing else", async () => {
  const { spec } = await task(SCORECARD);
  const [suite] = await loadWorkflow(spec);
  assert.equal(suite?.decision, "scorecard");

  const { spec: pick } = await task((y) => y.replace("      operating_mode: lowest-cost\n", "      operating_mode: lowest-cost\n      decision: pick\n"));
  assert.equal((await loadWorkflow(pick))[0]?.decision, undefined, "pick is the default and is not recorded");

  const { spec: bad } = await task((y) => y.replace("      operating_mode: lowest-cost\n", "      operating_mode: lowest-cost\n      decision: maybe\n"));
  await assert.rejects(loadWorkflow(bad), /decision/);
});

test("a scorecard step cannot be in a chain: the proposed combination needs a pick on every step", async () => {
  const { spec } = await task((y) =>
    SCORECARD(y).replace(
      "candidates:\n",
      `    - id: again\n      version: "1"\n      input_from: notes\n      test_set: { id: changelog-v1, inputs: [changelog] }\n      candidate_ids: [careful, sloppy]\n      required_checks: [release-notes]\n      operating_mode: lowest-cost\n\ncandidates:\n`,
    ),
  );
  await assert.rejects(loadWorkflow(spec), /scorecard.*chain|chain.*scorecard/);
});

/* ── the selector ────────────────────────────────────────────────────────── */

const rate = (n: number, d: number) => ({ value: d ? n / d : null, numerator: n, denominator: d });

function rates(candidate: string, pass: number): CandidateRates {
  return {
    candidate, valid_attempts: 2, classified: 2,
    task_success_rate: rate(pass, 2), reliability: rate(pass, 2), evaluation_coverage: rate(2, 2), required_check_pass_rate: rate(pass, 2),
    completion_states: { success: 2, refusal: 0, timeout: 0, malformed: 0, cancelled: 0, provider_error: 0 },
    outcomes: { success: pass, failure: 2 - pass, undetermined: 0 },
    check_states: { pass, fail: 2 - pass, not_evaluated: 0, evaluator_error: 0 },
    generation_cost_per_success: pass ? 0.1 : null, p50_ms: 1000, p95_ms: 2000,
  };
}

function manifest(decision?: "scorecard") {
  return {
    operating_mode: "lowest-cost", control_candidate: null, minimum_meaningful_difference: null,
    evaluators: { required_checks: ["c"] },
    ...(decision ? { decision } : {}),
  };
}

test("a scorecard recommendation picks nobody, applies no gate, and says why", () => {
  const summary = { candidates: [rates("a", 2), rates("b", 0)], directionality: { directional: true, reasons: [] } };
  const rec = recommendFromCanon(manifest("scorecard"), summary);
  assert.equal(rec.chosen, null);
  assert.equal(rec.firmness, "scorecard");
  assert.deepEqual(rec.filters, []);
  assert.deepEqual(rec.eligible, ["a", "b"]);
  assert.equal(rec.closest, null);
  assert.equal(rec.evidence, null);
  assert.deepEqual(rec.firmness_reasons, []);
  assert.match(rec.reasons.join(" "), /scorecard/);
  assert.deepEqual(Object.values(rec.eligibility), [null, null, null, null, null]);

  const picked = recommendFromCanon(manifest(), summary);
  assert.equal(picked.chosen, "a", "without decision the step picks as before");
});

test("every one-line reading of a recommendation names the scorecard", () => {
  assert.equal(pickLabel({ chosen: null, firmness: "scorecard" }), "no pick (scorecard)");
  assert.equal(pickLabel({ chosen: "a", firmness: "firm" }), "a (firm)");
  assert.equal(pickLabel({ chosen: null, firmness: "needs-review" }), "none (needs-review)");
});

/* ── a real run ──────────────────────────────────────────────────────────── */

test("a scorecard run: recommendation, manifest and report lead with the scorecard, not a missing pick", async () => {
  // Arrange
  const { spec } = await task(SCORECARD);

  // Act — early stop asked for, which a scorecard must ignore: it has no gate to miss
  const result = await runSuite(spec, false, { yes: true, earlyStop: true, onEvent: () => {} });

  // Assert
  assert.ok(result);
  assert.equal(result.recommendation.firmness, "scorecard");
  assert.equal(result.recommendation.chosen, null);
  const onDisk = JSON.parse(await fs.readFile(path.join(result.dir, "recommendation.json"), "utf-8")) as Recommendation;
  assert.equal(onDisk.firmness, "scorecard");
  const frozen = JSON.parse(await fs.readFile(path.join(result.dir, "manifest.json"), "utf-8"));
  assert.equal(frozen.decision, "scorecard");
  assert.deepEqual(Object.values(frozen.eligibility), [null, null, null, null, null]);
  const summary = JSON.parse(await fs.readFile(path.join(result.dir, "summary.json"), "utf-8"));
  assert.equal(summary.early_stop.enabled, false);

  const bundle = await loadBundle(result.dir);
  const html = renderRunReport(bundle);
  const card = html.indexOf("<h2>Scorecard");
  assert.ok(card > 0, "no scorecard section");
  assert.ok(card < html.indexOf("<h2>Per input"), "the scorecard does not lead");
  assert.equal(html.indexOf("<h2>Selection"), -1, "a scorecard has no gate trace");
  assert.match(html, /no pick \(scorecard\)/);
  assert.match(html, /<h2>Failed trials/);
  assert.match(html, /sloppy/);
  assert.doesNotMatch(html, /No candidate to recommend|gated out/);
  // careful passed 1 of 1: Wilson 95% 0.21–1.00.
  assert.match(html, /1\/1 · 21%–100%/);

  const model = buildStepReport(bundle);
  assert.equal(model.verdict.firmness, "scorecard");
  assert.match(model.verdict.text, /scorecard/i);
  assert.match(model.facts.find((f) => f.label === "Operating mode")?.value ?? "", /no pick \(scorecard\)/);

  // The terminal summary `run` prints.
  const lines = summaryLines({
    step: "notes", candidates: bundle.summary.candidates.map((c) => c.candidate), trials: bundle.trials, chosen: null, firmness: "scorecard",
    firmnessReasons: [], evidence: null, gated: [], ledgerTotal: 0, ledgerSource: "estimated",
  }).join("\n");
  assert.match(lines, /→ no pick \(scorecard\)/);
  assert.doesNotMatch(lines, /no candidate qualified/);
  assert.ok(itemStats(bundle.trials).inputs > 0);
});

test("diff, workflow page, catalog and overview read a scorecard step without calling it a failure to choose", async () => {
  // Arrange — two independent steps, one scorecard; then the same run again.
  const { spec, ws } = await task((y) =>
    SCORECARD(y).replace(
      "candidates:\n",
      `    - id: notes2\n      version: "1"\n      test_set: { id: changelog-v1, inputs: [changelog] }\n      candidate_ids: [careful, sloppy]\n      required_checks: [release-notes]\n      operating_mode: lowest-cost\n      eligibility: { minimum_reliability: 0.0, minimum_required_check_pass_rate: 0.0 }\n\ncandidates:\n`,
    ),
  );
  await runSuite(spec, false, { yes: true, onEvent: () => {} });
  await new Promise((r) => setTimeout(r, 20));
  await runSuite(spec, false, { yes: true, onEvent: () => {} });
  const runsRoot = path.join(path.dirname(spec), "runs");
  const [first, second] = (await fs.readdir(runsRoot)).sort();

  // Act / Assert — workflow page
  const page = await fs.readFile(await writeWorkflowReport(path.join(runsRoot, second!)), "utf-8");
  assert.match(page, /scorecard/);

  // diff
  const d = diffRuns(await loadRunSide(path.join(runsRoot, first!, "notes")), await loadRunSide(path.join(runsRoot, second!, "notes")));
  assert.match(diffLines(d).join("\n"), /recommendation unchanged: no pick \(scorecard\)/);

  // catalog and overview
  const run = await loadRun(second!, { ws: workspaceAt(ws) });
  assert.equal(run?.steps.find((s) => s.id === "notes")?.firmness, "scorecard");
  assert.ok((await listTasks({ ws: workspaceAt(ws) })).tasks.length === 1);
  const overview = await buildOverview(workspaceAt(ws));
  assert.equal(overview.steps.find((s) => s.step === "notes")?.firmness, "scorecard");
  assert.ok(!overview.unobserved.stepsWithNoChoice.some((s) => s.step === "notes"), "a scorecard step is not a step that could not choose");
});

test("combine under a scorecard spec records the scorecard", async () => {
  const { combineRuns } = await import("../src/core/combine.js");
  const { spec } = await task();
  await runSuite(spec, false, { yes: true, onEvent: () => {} });
  const runsRoot = path.join(path.dirname(spec), "runs");
  const [run] = await fs.readdir(runsRoot);
  await fs.writeFile(spec, SCORECARD(await fs.readFile(spec, "utf-8")));

  const result = await combineRuns(spec, [run!], {});

  const dir = path.join(result.dir, "notes");
  const stepDir = (await fs.stat(dir).catch(() => null)) ? dir : result.dir;
  const rec = JSON.parse(await fs.readFile(path.join(stepDir, "recommendation.json"), "utf-8")) as Recommendation;
  assert.equal(rec.firmness, "scorecard");
  assert.equal(JSON.parse(await fs.readFile(path.join(stepDir, "manifest.json"), "utf-8")).decision, "scorecard");
});
