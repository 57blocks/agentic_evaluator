import { test } from "node:test";
import assert from "node:assert/strict";
import {
  armRates,
  decideValidation,
  proposedAssignment,
  type E2eCase,
  type ValidationArm,
} from "../src/canon/e2e.js";

function caseOf(
  input: string,
  trial: number,
  steps: Array<{ id: string; outcome: "success" | "failure" | "undetermined"; cost: number; ms: number; check?: "pass" | "fail" }>,
): E2eCase {
  return {
    input,
    trial,
    steps: steps.map((s) => ({
      id: s.id,
      candidate: "c",
      completion_state: s.outcome === "success" ? "success" : "malformed",
      task_outcome: s.outcome,
      outcome_reasons: [],
      cost_usd: s.cost,
      ms: s.ms,
      input_sha: "a",
      output_sha: "b",
      checks: s.check ? [{ evaluator: "tsc-noemit", version: "t", state: s.check }] : [],
    })),
    outcome: steps.some((s) => s.outcome === "failure")
      ? "failure"
      : steps.some((s) => s.outcome === "undetermined")
        ? "undetermined"
        : "success",
    aborted: false,
  };
}

function arm(
  armId: string,
  kind: "proposed" | "control",
  assignment: Record<string, string>,
  cases: E2eCase[],
): ValidationArm {
  return { arm_id: armId, kind, assignment, cases: cases.length, rates: armRates(cases) };
}

test("proposedAssignment maps each chained step to its chosen candidate", () => {
  const got = proposedAssignment(["draft", "review"], {
    draft: "model-a",
    review: "model-b",
  });
  assert.deepEqual(got, { assignment: { draft: "model-a", review: "model-b" } });
});

test("proposedAssignment refuses when a step has no chosen candidate", () => {
  const got = proposedAssignment(["draft", "review"], { draft: "model-a", review: null });
  assert.equal("assignment" in got, false);
  assert.match((got as { reason: string }).reason, /review/);
});

test("armRates separates classified outcomes from undetermined", () => {
  const rates = armRates([
    caseOf("i1", 0, [{ id: "draft", outcome: "success", cost: 1, ms: 10, check: "pass" }]),
    caseOf("i2", 0, [{ id: "draft", outcome: "failure", cost: 1, ms: 30, check: "fail" }]),
    caseOf("i3", 0, [{ id: "draft", outcome: "undetermined", cost: 1, ms: 20 }]),
  ]);
  assert.equal(rates.cases, 3);
  assert.deepEqual(rates.task_success_rate, { value: 0.5, numerator: 1, denominator: 2 });
  assert.deepEqual(rates.reliability, { value: 1 / 3, numerator: 1, denominator: 3 });
  assert.deepEqual(rates.required_check_pass_rate, { value: 0.5, numerator: 1, denominator: 2 });
  assert.equal(rates.total_cost_usd, 3);
  assert.equal(rates.cost_per_success, 3);
  assert.equal(rates.p50_ms, 20);
});

const THRESHOLDS = { minimum_reliability: 1, minimum_required_check_pass_rate: 1 };

function passing(cost: number, ms: number, n = 12): E2eCase[] {
  return Array.from({ length: n }, (_, i) =>
    caseOf(`i${i}`, 0, [{ id: "draft", outcome: "success", cost, ms, check: "pass" }]),
  );
}

test("adopts the combination when it beats the control by at least the declared difference", () => {
  const v = decideValidation({
    mode: "lowest-cost",
    mmd: 0.5,
    thresholds: THRESHOLDS,
    inputs: 12,
    control: arm("control", "control", { draft: "ctrl" }, passing(2, 10)),
    proposed: arm("proposed", "proposed", { draft: "model-a" }, passing(1, 10)),
  });
  assert.equal(v.verdict, "adopt-combination");
  assert.equal(v.firmness, "firm");
  assert.equal(v.deltas?.improvement, 1);
});

test("keeps the control when the improvement is below the declared difference", () => {
  const v = decideValidation({
    mode: "lowest-cost",
    mmd: 0.5,
    thresholds: THRESHOLDS,
    inputs: 12,
    control: arm("control", "control", { draft: "ctrl" }, passing(2, 10)),
    proposed: arm("proposed", "proposed", { draft: "model-a" }, passing(1.8, 10)),
  });
  assert.equal(v.verdict, "keep-control");
  assert.match(v.reasons.join(" "), /below the declared minimum meaningful difference/);
});

test("a cheaper combination that fails eligibility never wins", () => {
  const unreliable = [
    ...passing(0.1, 10, 6),
    ...Array.from({ length: 6 }, (_, i) =>
      caseOf(`f${i}`, 0, [{ id: "draft", outcome: "failure", cost: 0.1, ms: 10, check: "fail" }]),
    ),
  ];
  const v = decideValidation({
    mode: "lowest-cost",
    mmd: 0.5,
    thresholds: THRESHOLDS,
    inputs: 12,
    control: arm("control", "control", { draft: "ctrl" }, passing(2, 10)),
    proposed: arm("proposed", "proposed", { draft: "model-a" }, unreliable),
  });
  assert.equal(v.verdict, "keep-control");
  assert.match(v.reasons.join(" "), /reliability/);
});

test("no predeclared difference means superiority cannot be concluded", () => {
  const v = decideValidation({
    mode: "lowest-cost",
    mmd: null,
    thresholds: THRESHOLDS,
    inputs: 12,
    control: arm("control", "control", { draft: "ctrl" }, passing(2, 10)),
    proposed: arm("proposed", "proposed", { draft: "model-a" }, passing(1, 10)),
  });
  assert.equal(v.verdict, "keep-control");
  assert.equal(v.firmness, "directional");
  assert.match(v.reasons.join(" "), /minimum meaningful difference/);
});

test("fewer than ten inputs keeps the verdict directional", () => {
  const v = decideValidation({
    mode: "lowest-cost",
    mmd: 0.5,
    thresholds: THRESHOLDS,
    inputs: 2,
    control: arm("control", "control", { draft: "ctrl" }, passing(2, 10, 2)),
    proposed: arm("proposed", "proposed", { draft: "model-a" }, passing(1, 10, 2)),
  });
  assert.equal(v.verdict, "adopt-combination");
  assert.equal(v.firmness, "directional");
});

test("highest-assurance compares reliability and ignores the cost difference", () => {
  const weakControl = [
    ...passing(0.1, 10, 6),
    ...Array.from({ length: 6 }, (_, i) =>
      caseOf(`f${i}`, 0, [{ id: "draft", outcome: "failure", cost: 0.1, ms: 10, check: "fail" }]),
    ),
  ];
  const v = decideValidation({
    mode: "highest-assurance",
    mmd: null,
    thresholds: { minimum_reliability: null, minimum_required_check_pass_rate: null },
    inputs: 12,
    control: arm("control", "control", { draft: "ctrl" }, weakControl),
    proposed: arm("proposed", "proposed", { draft: "model-a" }, passing(5, 10)),
  });
  assert.equal(v.verdict, "adopt-combination");
  assert.equal(v.deltas?.metric, "reliability");
});

test("a proposed assignment identical to the control is not re-run", () => {
  const v = decideValidation({
    mode: "lowest-cost",
    mmd: 0.5,
    thresholds: THRESHOLDS,
    inputs: 12,
    control: arm("control", "control", { draft: "ctrl" }, passing(2, 10)),
    proposed: null,
    blockedReason: "proposed assignment equals the single-model control (ctrl)",
  });
  assert.equal(v.verdict, "keep-control");
  assert.match(v.reasons.join(" "), /equals the single-model control/);
});

test("a step without a chosen candidate leaves the workflow not validated", () => {
  const v = decideValidation({
    mode: "lowest-cost",
    mmd: 0.5,
    thresholds: THRESHOLDS,
    inputs: 12,
    control: arm("control", "control", { draft: "ctrl" }, passing(2, 10)),
    proposed: null,
    notValidatedReason: "step review has no chosen candidate",
  });
  assert.equal(v.verdict, "not-validated");
  assert.equal(v.firmness, "needs-review");
});

test("paired case counts accompany the verdict", () => {
  const v = decideValidation({
    mode: "lowest-cost",
    mmd: 0.5,
    thresholds: THRESHOLDS,
    inputs: 12,
    control: arm("control", "control", { draft: "ctrl" }, passing(2, 10)),
    proposed: arm("proposed", "proposed", { draft: "model-a" }, passing(1, 10)),
    pairs: { compared: 12, both_success: 12, proposed_only: 0, control_only: 0, neither: 0 },
  });
  assert.deepEqual(v.deltas?.paired, {
    compared: 12,
    both_success: 12,
    proposed_only: 0,
    control_only: 0,
    neither: 0,
  });
});

test("runChainArm routes each step to the candidate the arm assigned", async () => {
  const { runChainArm } = await import("../src/e2e-control.js");
  const { loadWorkflow } = await import("../src/spec/load-spec.js");
  const suites = await loadWorkflow("tasks/smoke-e2e-control/spec.yaml");
  const seen: Array<{ step: string; candidate: string }> = [];
  const report = await runChainArm({
    armId: "e2e-proposed",
    armKind: "proposed",
    assignment: { draft: "model-a", review: "model-b" },
    chain: suites,
    rootInputs: [{ slug: "code-utils", text: "spec-v1" }],
    trials: 1,
    generate: async (step, candidate) => {
      seen.push({ step: step.step, candidate });
      return {
        completion_state: "success",
        text: `from-${candidate}`,
        artifacts: [],
        cost_usd: 0.25,
        ms: 4,
        checks: [{ evaluator: "tsc-noemit", version: "t", state: "pass" }],
      };
    },
  });
  assert.deepEqual(seen, [
    { step: "draft", candidate: "model-a" },
    { step: "review", candidate: "model-b" },
  ]);
  assert.equal(report.cases[0].steps[1].candidate, "model-b");
  assert.equal(report.rates.cost_per_success, 0.5);
});

test("runChainArm refuses an assignment that misses a chained step", async () => {
  const { runChainArm } = await import("../src/e2e-control.js");
  const { loadWorkflow } = await import("../src/spec/load-spec.js");
  const suites = await loadWorkflow("tasks/smoke-e2e-control/spec.yaml");
  await assert.rejects(
    runChainArm({
      armId: "e2e-proposed",
      armKind: "proposed",
      assignment: { draft: "model-a" },
      chain: suites,
      rootInputs: [{ slug: "code-utils", text: "spec-v1" }],
      trials: 1,
      generate: async () => {
        throw new Error("must not run");
      },
    }),
    /no candidate for step\(s\): review/,
  );
});

test("the workflow gate is the strictest gate any chained step declares", async () => {
  const { workflowThresholds, workflowMode } = await import("../src/run.js");
  const chain = [
    { step: "draft", requiredChecks: ["tsc-noemit"], eligibility: { minimum_reliability: 0.8 }, operatingMode: "lowest-cost" },
    { step: "review", requiredChecks: ["tsc-noemit"], eligibility: { minimum_reliability: 1 }, operatingMode: "lowest-cost" },
  ] as unknown as Parameters<typeof workflowThresholds>[0];
  assert.deepEqual(workflowThresholds(chain), {
    minimum_reliability: 1,
    minimum_required_check_pass_rate: 1,
  });
  assert.deepEqual(workflowMode(chain), { mode: "lowest-cost" });
});

test("chained steps with different operating modes cannot be compared", async () => {
  const { workflowMode } = await import("../src/run.js");
  const chain = [
    { step: "draft", operatingMode: "lowest-cost" },
    { step: "review", operatingMode: "highest-assurance" },
  ] as unknown as Parameters<typeof workflowMode>[0];
  const got = workflowMode(chain);
  assert.match((got as { reason: string }).reason, /different operating modes/);
});

test("maybeRunE2eValidation runs both arms and adopts the combination the control cannot match", async () => {
  const { maybeRunE2eValidation } = await import("../src/run.js");
  const { loadWorkflow } = await import("../src/spec/load-spec.js");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");

  const suites = await loadWorkflow("tasks/smoke-e2e-validation/spec.yaml");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eval-e2e-validate-"));
  const arms = await maybeRunE2eValidation({
    suites,
    root,
    runId: "smoke-e2e-validation-test",
    chosenByStep: { draft: "fake-pass", review: "fake-pass" },
    emit: () => {},
  });

  assert.ok(arms);
  assert.equal(arms.control?.candidate, "fake-fail");
  assert.equal(arms.control?.totals.failure, 1);
  assert.equal(arms.proposed?.totals.success, 1);
  assert.deepEqual(arms.proposed?.assignment, { draft: "fake-pass", review: "fake-pass" });
  assert.equal(arms.validation?.verdict, "adopt-combination");
  assert.equal(arms.validation?.deltas?.paired?.proposed_only, 1);

  const written = JSON.parse(await fs.readFile(path.join(root, "e2e-validation.json"), "utf-8"));
  assert.equal(written.verdict, "adopt-combination");
  await fs.access(path.join(root, "e2e-control.json"));
  await fs.access(path.join(root, "e2e-proposed", "e2e-proposed.json"));
  await fs.rm(root, { recursive: true, force: true });
});
