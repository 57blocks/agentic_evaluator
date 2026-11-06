import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareBaselines } from "../src/canon/baselines.js";
import { countEvaluatorErrorsAsFailures } from "../src/canon/ablation.js";
import { ratesFor } from "../src/canon/rates.js";
import type { TrialRow } from "../src/canon/rows.js";
import { recommend } from "../src/canon/select.js";
import type { RunManifest } from "../src/canon/manifest.js";
import type { CompletionState, EvaluationState, TaskOutcome } from "../src/canon/types.js";
import { replayStep } from "../src/core/replay.js";
import { bufferIo } from "../src/cli/io.js";
import { main } from "../src/cli/index.js";
import { EXIT } from "../src/cli/exit-codes.js";

const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures");
const firm = { directional: false as const, reasons: [] };

function row(
  candidate: string,
  trial: number,
  check: EvaluationState | null,
  cost: number,
  completion: CompletionState = "success",
): TrialRow {
  const outcome: TaskOutcome =
    completion === "provider_error" ? "undetermined"
      : completion !== "success" ? "failure"
        : check === "pass" ? "success" : check === "fail" ? "failure" : "undetermined";
  return {
    run: "r", step: "s", candidate, model_ref: candidate, deployment_ref: null,
    input: `in-${trial}`, trial: 0, trial_hash: `h-${candidate}-${trial}`,
    completion_state: completion, truncated: false, task_outcome: outcome, outcome_reasons: [], rule_version: "success-v2",
    checks: check ? { gate: { state: check, version: "v" } } : {},
    judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: cost, source: "provider-reported" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms: 1000, ttft_ms: null, cache: null, finish_reason: "stop", isolation: null, error: null,
    legacy_status: "ok", legacy_check_passed: check === "pass", reused_from: null,
  };
}

/** `passes` of 20 trials pass the check; the rest fail it. */
function candidateRows(candidate: string, passes: number, costPerTrial: number): TrialRow[] {
  return Array.from({ length: 20 }, (_, i) => row(candidate, i, i < passes ? "pass" : "fail", costPerTrial));
}

const ELIGIBILITY = {
  minimum_reliability: 0.9,
  minimum_required_check_pass_rate: 0.9,
  minimum_all_trials_pass_rate: null,
  maximum_p95_ms: null,
  cost_ceiling_per_success_usd: null,
};

function gatedOn(rows: readonly TrialRow[], ids: readonly string[]) {
  const candidates = ids.map((c) => ratesFor(c, rows));
  const gated = recommend({
    operatingMode: "lowest-cost",
    controlCandidate: null,
    requiredChecks: ["gate"],
    eligibility: ELIGIBILITY,
    mmd: null,
    directionality: firm,
    candidates,
    trials: rows,
  });
  return { candidates, gated };
}

test("a cost-weighted rule picks the cheap candidate the gate rejects, and names the gate", () => {
  // Arrange: strong passes 19/20 at $1 a trial; cheap passes 15/20 at $0.05
  const rows = [...candidateRows("strong", 19, 1), ...candidateRows("cheap", 15, 0.05)];
  const { candidates, gated } = gatedOn(rows, ["strong", "cheap"]);

  // Act
  const result = compareBaselines(gated, candidates);

  // Assert
  assert.equal(gated.chosen, "strong");
  const weighted = result.picks.find((p) => p.rule === "weighted λ=1")!;
  assert.equal(weighted.chosen, "cheap");
  // Filters remove a candidate once, so the first gate it fails is the one named
  assert.deepEqual(weighted.failed_gates.map((g) => g.gate), ["required-check-pass-rate"]);
  const leaderboard = result.picks.find((p) => p.rule === "leaderboard")!;
  assert.equal(leaderboard.chosen, "strong");
  assert.deepEqual(leaderboard.failed_gates, []);
});

test("within q of best takes the cheapest candidate close enough to the best", () => {
  // Arrange: 20/20 vs 19/20 — 0.95 is within both 90% and 95% of 1.0
  const rows = [...candidateRows("strong", 20, 1), ...candidateRows("near", 19, 0.1)];
  const { candidates, gated } = gatedOn(rows, ["strong", "near"]);

  // Act
  const picks = compareBaselines(gated, candidates).picks;

  // Assert
  assert.equal(picks.find((p) => p.rule === "within 95% of best")!.chosen, "near");
  assert.equal(picks.find((p) => p.rule === "within 90% of best")!.chosen, "near");
});

test("a candidate with no success is left out of the weighted rule rather than ranked as free", () => {
  // Arrange: zero passes → cost per success undefined
  const rows = [...candidateRows("strong", 19, 1), ...candidateRows("broken", 0, 0)];
  const { candidates, gated } = gatedOn(rows, ["strong", "broken"]);

  // Act
  const weighted = compareBaselines(gated, candidates).picks.find((p) => p.rule === "weighted λ=0.5")!;

  // Assert
  assert.equal(weighted.chosen, "strong");
  assert.match(weighted.reason, /cost per success undefined: broken/);
});

test("ablation turns ungraded trials into failures and leaves the given rows untouched", () => {
  // Arrange
  const rows = [
    row("a", 0, "evaluator_error", 0.1),
    row("a", 1, "not_evaluated", 0.1),
    row("a", 2, "pass", 0.1),
    row("a", 3, null, 0.1, "provider_error"),
  ];
  const before = JSON.stringify(rows);

  // Act
  const { rows: ablated, changed } = countEvaluatorErrorsAsFailures(rows);

  // Assert
  assert.equal(changed, 2);
  assert.deepEqual(ablated.map((r) => r.task_outcome), ["failure", "failure", "success", "undetermined"]);
  assert.equal(ablated[0].checks.gate.state, "fail");
  assert.equal(JSON.stringify(rows), before);
});

test("ablation moves the decision when grader errors were hiding a candidate's misses", () => {
  // Arrange: cheap has 17 passes and 3 grader errors — 17/17 graded, eligible;
  // blamed on the candidate it is 17/20, below the 0.9 gate. Only the check
  // gate is declared: reliability already counts ungraded trials against the
  // candidate, so with it at 0.9 cheap would be out before the ablation.
  const cheap = [
    ...Array.from({ length: 17 }, (_, i) => row("cheap", i, "pass", 0.05)),
    ...[17, 18, 19].map((i) => row("cheap", i, "evaluator_error", 0.05)),
  ];
  const trials = [...candidateRows("strong", 20, 1), ...cheap];
  const manifest = {
    run_id: "r",
    step: { id: "s", version: "1", description: null },
    operating_mode: "lowest-cost",
    control_candidate: null,
    minimum_meaningful_difference: null,
    evaluators: { required_checks: ["gate"] },
    eligibility: { ...ELIGIBILITY, minimum_reliability: null },
  } as unknown as RunManifest;

  // Act
  const result = replayStep({ manifest, candidates: ["strong", "cheap"], directionality: firm, trials });

  // Assert
  assert.equal(result.ablation.original.chosen, "cheap");
  assert.equal(result.ablation.ablated.chosen, "strong");
  assert.equal(result.ablation.changed_trials, 3);
  assert.equal(result.ablation.flipped, true);
});

test("agenteval replay reads a recorded run and reports the gated pick, the baselines and the ablation", async () => {
  // Arrange: a copy, so a bug that wrote into the run could not touch the fixture
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-replay-"));
  const run = path.join(dir, "smoke-canon");
  await fs.cp(path.join(FIXTURES, "smoke-canon"), run, { recursive: true });
  const before = await fs.readdir(run);
  const io = bufferIo();

  // Act
  const code = await main(["replay", run, "--json", "--workspace", dir], io);

  // Assert
  assert.equal(code, EXIT.ok, io.stderr);
  const out = JSON.parse(io.stdout) as {
    steps: Array<{ baselines: { gated: { chosen: string | null; eligible: string[] }; picks: unknown[] } }>;
    totals: { steps: number };
  };
  assert.equal(out.totals.steps, 1);
  assert.equal(out.steps[0].baselines.picks.length, 6);
  // Everything else rests on this: the replay reproduces the decision the run recorded
  const recorded = JSON.parse(await fs.readFile(path.join(run, "recommendation.json"), "utf-8")) as { chosen: string | null; eligible: string[] };
  assert.equal(out.steps[0].baselines.gated.chosen, recorded.chosen);
  assert.deepEqual(out.steps[0].baselines.gated.eligible, recorded.eligible);
  assert.deepEqual(await fs.readdir(run), before);
});
