/**
 * The samples other people learn the tool on keep working.
 *
 * Only the free ones run here; `compare-models`, `compare-agents`,
 * `compare-agent-models` and `compare-setups` are billed, so they are checked for what can be checked without spending: they
 * load, and their plans are the size their header comments promise.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INSTALL_ROOT } from "../src/paths.js";
import { EXIT } from "../src/cli/exit-codes.js";
import { bufferIo } from "../src/cli/io.js";
import { main } from "../src/cli/index.js";
import { planWorkflow } from "../src/core/plan.js";
import { loadWorkflow } from "../src/spec/load-spec.js";
import { dockerAvailable } from "../src/adapters/docker.js";

const EXAMPLES = path.join(INSTALL_ROOT, "examples", "tasks");

/** Copy a sample into a fresh workspace, so a test run never writes into the checkout. */
async function workspaceWith(task: string): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "eval-examples-"));
  await fs.cp(path.join(EXAMPLES, task), path.join(ws, "tasks", task), {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });
  return ws;
}

async function runJson(task: string): Promise<Array<Record<string, unknown>>> {
  const ws = await workspaceWith(task);
  const io = bufferIo();
  const code = await main(["run", task, "--yes", "--json", "--workspace", ws], io);
  assert.equal(code, EXIT.ok, io.stderr);
  return io.stdout.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
}

test("every free sample declares no judging, so it cannot bill", async () => {
  for (const task of ["custom-check", "chain-offline", "docker-sandbox"]) {
    // Act
    const plan = planWorkflow(await loadWorkflow(path.join(EXAMPLES, task, "spec.yaml")));

    // Assert
    for (const step of plan.steps) {
      assert.equal(step.judgeCalls, 0, `${task}/${step.step} would call the judge`);
      assert.equal(step.scoreCalls, 0, `${task}/${step.step} would call the scorer`);
    }
  }
});

test("custom-check: the check passes the careful agent and gates the sloppy one", async () => {
  // Act
  const events = await runJson("custom-check");

  // Assert
  const done = events.find((e) => e.type === "step.done") as { chosen: string; gated: Array<{ candidate: string }> };
  assert.equal(done.chosen, "careful");
  assert.deepEqual(done.gated.map((g) => g.candidate), ["sloppy"]);
});

test("custom-check: a check's reason is kept with the trial, beside its evidence", async () => {
  // Arrange
  const ws = await workspaceWith("custom-check");

  // Act
  await main(["run", "custom-check", "--yes", "--workspace", ws], bufferIo());

  // Assert - the sloppy candidate's failed check says why, as the check printed it.
  const runsRoot = path.join(ws, "tasks", "custom-check", "runs");
  const runDir = path.join(runsRoot, (await fs.readdir(runsRoot))[0]);
  const rows = (await fs.readFile(path.join(runDir, "scores.jsonl"), "utf-8"))
    .trim().split("\n").map((l) => JSON.parse(l) as { candidate: string; checks: Record<string, { reason?: string; evidence?: string }> });
  const sloppy = rows.find((r) => r.candidate === "sloppy")!;
  const cell = Object.values(sloppy.checks)[0];
  assert.match(cell.evidence ?? "", /PRs cited/);
  assert.match(cell.reason ?? "", /not cited|missing/);

  await fs.rm(ws, { recursive: true, force: true });
});

test("chain-offline: both arms run and the combination beats the broken control", async () => {
  // Act
  const events = await runJson("chain-offline");

  // Assert
  const arms = events.filter((e) => e.type === "e2e.arm.done").map((e) => e.armId);
  assert.deepEqual(arms, ["e2e-control", "e2e-proposed"]);
  const verdict = events.find((e) => e.type === "e2e.validated") as { verdict: string };
  assert.equal(verdict.verdict, "adopt-combination");
});

test("docker-sandbox: the same agent runs in a container and on the host, and each row says which", { timeout: 300_000 }, async (t) => {
  if (!(await dockerAvailable())) return t.skip("docker not available");

  // Arrange
  const ws = await workspaceWith("docker-sandbox");

  // Act
  const code = await main(["run", "docker-sandbox", "--yes", "--workspace", ws], bufferIo());

  // Assert - both pass the check; the evidence records where each one ran.
  assert.equal(code, EXIT.ok);
  const runsRoot = path.join(ws, "tasks", "docker-sandbox", "runs");
  const runDir = path.join(runsRoot, (await fs.readdir(runsRoot))[0]);
  const rows = (await fs.readFile(path.join(runDir, "scores.jsonl"), "utf-8"))
    .trim().split("\n").map((l) => JSON.parse(l) as { candidate: string; isolation: string; task_outcome: string });
  const byCandidate = Object.fromEntries(rows.map((r) => [r.candidate, r]));
  assert.equal(byCandidate.contained.isolation, "docker");
  assert.equal(byCandidate["on-host"].isolation, "none");
  assert.deepEqual(rows.map((r) => r.task_outcome), ["success", "success"]);
  const evidence = await fs.readFile(path.join(runDir, "evaluations.jsonl"), "utf-8");
  assert.match(evidence, /ran in a container, without access to checks\//);

  await fs.rm(ws, { recursive: true, force: true });
});

test("compare-models: loads, and plans 2 generations and 2 judge calls under a $0.50 ceiling", async () => {
  // Act
  const plan = planWorkflow(await loadWorkflow(path.join(EXAMPLES, "compare-models", "spec.yaml")));

  // Assert
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].generations, 2);
  assert.equal(plan.steps[0].judgeCalls, 2);
  assert.equal(plan.steps[0].scoreCalls, 0);
  assert.equal(plan.steps[0].budgetUsd, 0.5);
});

test("compare-agents: three agents, two trials each, 6 judge calls, graded on behaviour", async () => {
  // Act
  const suites = await loadWorkflow(path.join(EXAMPLES, "compare-agents", "spec.yaml"));
  const plan = planWorkflow(suites);

  // Assert - 3 agents x 2 trials; 3 agents -> 3 pairs, each judged in both orders.
  assert.equal(plan.steps[0].generations, 6);
  assert.equal(plan.steps[0].pairs, 3);
  assert.equal(plan.steps[0].judgeCalls, 6);
  assert.equal(plan.steps[0].budgetUsd, 1);
  assert.equal(suites[0].check?.kind, "command", "graded by spec.test.ts, not by compiling");
});

test("compare-agent-models: one agent, three models, only --model differs", async () => {
  // Act
  const suites = await loadWorkflow(path.join(EXAMPLES, "compare-agent-models", "spec.yaml"));
  const plan = planWorkflow(suites);

  // Assert
  assert.equal(plan.steps[0].generations, 6);
  assert.equal(plan.steps[0].judgeCalls, 6);
  const spec = await fs.readFile(path.join(EXAMPLES, "compare-agent-models", "spec.yaml"), "utf-8");
  const argvs = [...spec.matchAll(/argv: \[opencode, (.*)\]/g)].map((m) => m[1].replace(/--model, \S+,/, "--model, M,"));
  assert.equal(argvs.length, 3);
  assert.equal(new Set(argvs).size, 1, "the candidates differ in anything but the model");
});

test("compare-setups: three agent + model setups, graded like compare-agents", async () => {
  // Act
  const suites = await loadWorkflow(path.join(EXAMPLES, "compare-setups", "spec.yaml"));
  const plan = planWorkflow(suites);

  // Assert
  assert.equal(plan.steps[0].generations, 6);
  assert.equal(plan.steps[0].judgeCalls, 6);
  assert.equal(suites[0].check?.kind, "command");
});
