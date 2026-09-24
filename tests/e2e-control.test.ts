import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { decideE2eOutcome, orderControlChain } from "../src/canon/e2e.js";
import { handoffPayload, runControlChain, type E2eGeneration } from "../src/e2e-control.js";
import { compileWorkflow, loadWorkflow, parseSpec, SpecError } from "../src/spec/load-spec.js";
import { INSTALL_ROOT } from "../src/paths.js";
import { sha256 } from "../src/canon/hash.js";
import { adapterFor } from "../src/adapters/resolve.js";
import type { Suite } from "../src/types.js";

test("orderControlChain walks a linear input_from path", () => {
  assert.equal(orderControlChain([{ id: "prd" }, { id: "codegen" }]), null);
  assert.deepEqual(
    orderControlChain([
      { id: "prd" },
      { id: "taskbreakdown", inputFrom: "prd" },
      { id: "codegen", inputFrom: "taskbreakdown" },
    ]),
    ["prd", "taskbreakdown", "codegen"],
  );
  assert.equal(
    orderControlChain([
      { id: "prd" },
      { id: "a", inputFrom: "prd" },
      { id: "b", inputFrom: "prd" },
    ]),
    null,
  );
});

test("decideE2eOutcome fails the case on any step failure", () => {
  assert.equal(decideE2eOutcome(["success", "success"]), "success");
  assert.equal(decideE2eOutcome(["success", "failure"]), "failure");
  assert.equal(decideE2eOutcome(["success", "undetermined"]), "undetermined");
  assert.equal(decideE2eOutcome(["failure", "undetermined"]), "failure");
  assert.equal(decideE2eOutcome([]), "undetermined");
});

test("handoffPayload prefers artifacts over stdout", () => {
  assert.equal(handoffPayload({ text: "stdout", artifacts: [] }), "stdout");
  assert.equal(
    handoffPayload({ text: "stdout", artifacts: [{ path: "utils.ts", content: "export {}" }] }),
    "```file:utils.ts\nexport {}\n```",
  );
});

test("smoke-e2e-control compiles a draft → review chain", async () => {
  const suites = await loadWorkflow("tasks/smoke-e2e-control/spec.yaml");
  assert.deepEqual(suites.map((s) => s.step), ["draft", "review"]);
  assert.equal(suites[0].inputFrom, undefined);
  assert.equal(suites[1].inputFrom, "draft");
  assert.equal(suites[0].controlCandidate, "fake-pass");
  assert.deepEqual(orderControlChain(suites.map((s) => ({ id: s.step, inputFrom: s.inputFrom }))), [
    "draft",
    "review",
  ]);
});

test("input_from requires control_candidate and a preceding step", () => {
  const text = `
protocol_version: "0.3"
run_name: broken-e2e
workflow:
  steps:
    - id: draft
      version: "1"
      test_set: { id: t, inputs: [code-utils] }
      candidate_ids: [fake-pass]
    - id: review
      version: "1"
      input_from: draft
      test_set: { id: t, inputs: [code-utils] }
      candidate_ids: [fake-pass]
candidates:
  - id: fake-pass
    adapter: agent-cli
    cli: { argv: [node, scripts/fake-codegen-agent.mjs] }
evaluators:
  judge: { model: google/gemini-3.1-pro-preview, rubric_file: rubrics/codegen.md }
execution:
  trials_per_case: 1
x-harness:
  producer: codegen
`;
  const spec = parseSpec(text, "x.yaml");
  assert.throws(() => compileWorkflow(spec, "x.yaml", sha256(text), path.join(INSTALL_ROOT, "tasks", "smoke-e2e-control")), SpecError);
});

async function stubGen(step: Suite, _slug: string, text: string): Promise<E2eGeneration> {
  const fail = text.includes("STOP");
  return {
    completion_state: fail ? "timeout" : "success",
    text: `from-${step.step}`,
    artifacts: fail ? [] : [{ path: `${step.step}.ts`, content: text }],
    cost_usd: 0.01,
    ms: 5,
    checks: [{ evaluator: "tsc-noemit", version: "t", state: fail ? "fail" : "pass" }],
  };
}

test("runControlChain hands draft output to review and records shas", async () => {
  const suites = await loadWorkflow("tasks/smoke-e2e-control/spec.yaml");
  const report = await runControlChain({
    candidate: "fake-pass",
    chain: suites,
    rootInputs: [{ slug: "code-utils", text: "spec-v1" }],
    trials: 1,
    generate: stubGen,
  });
  assert.equal(report.kind, "single-model-e2e-control");
  assert.deepEqual(report.chain, ["draft", "review"]);
  assert.equal(report.totals.success, 1);
  assert.equal(report.cases[0].aborted, false);
  assert.equal(report.cases[0].steps[0].input_sha, sha256("spec-v1"));
  const expectedHandoff = "```file:draft.ts\nspec-v1\n```";
  assert.equal(report.cases[0].steps[1].input_sha, sha256(expectedHandoff));
});

test("runControlChain aborts the chain when a step does not complete", async () => {
  const suites = await loadWorkflow("tasks/smoke-e2e-control/spec.yaml");
  const report = await runControlChain({
    candidate: "fake-pass",
    chain: suites,
    rootInputs: [{ slug: "code-utils", text: "STOP-now" }],
    trials: 1,
    generate: stubGen,
  });
  assert.equal(report.cases[0].aborted, true);
  assert.equal(report.cases[0].steps.length, 1);
  assert.equal(report.totals.failure, 1);
});

test("runControlChain with the real agent-cli adapter pipes artifacts", async () => {
  const suites = await loadWorkflow("tasks/smoke-e2e-control/spec.yaml");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eval-e2e-"));
  const { runCheck } = await import("../src/check.js");
  const report = await runControlChain({
    candidate: "fake-pass",
    chain: suites,
    rootInputs: [{ slug: "code-utils", text: "parse a query string" }],
    trials: 1,
    generate: async (step, slug, inputText, trial) => {
      const def = step.candidateDefs!["fake-pass"];
      const workDir = path.join(tmp, `${step.step}-${slug}-t${trial}`);
      const result = await adapterFor(def, step.producer ?? "codegen").execute(
        {
          stepId: step.step,
          candidateId: "fake-pass",
          inputId: slug,
          inputText,
          promptTemplate: "",
          temperature: 0,
          timeoutMs: 10_000,
          cli: def.cli,
        },
        // The task owns its agent, so the adapter needs to know which task.
        { workDir, taskRoot: step.taskRoot },
      );
      const check = await runCheck({
        files: result.artifacts,
        scaffoldDir: path.join(INSTALL_ROOT, "tasks", "codegen-trial", "scaffold"),
        workDir,
      });
      return {
        completion_state: "success",
        text: result.text,
        artifacts: result.artifacts,
        cost_usd: result.costUsd,
        ms: result.ms,
        checks: [{ evaluator: "tsc-noemit", version: check.version, state: check.state }],
      };
    },
  });
  assert.equal(report.totals.success, 1);
  assert.equal(report.cases[0].steps[1].input_sha, report.cases[0].steps[0].output_sha);
});
