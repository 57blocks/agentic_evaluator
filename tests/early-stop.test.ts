/**
 * Early stop must save trials without changing who is eligible or chosen.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { INSTALL_ROOT } from "../src/paths.js";
import { runSuite } from "../src/core/execute.js";
import type { RunEvent } from "../src/core/events.js";
import { unreachableGate } from "../src/canon/early-stop.js";
import { resolveEligibility } from "../src/canon/select.js";
import type { TrialRow } from "../src/canon/rows.js";
import type { TaskOutcome } from "../src/canon/types.js";

function row(input: string, trial: number, outcome: TaskOutcome): TrialRow {
  const pass = outcome === "success";
  return {
    run: "r", step: "s", candidate: "a", model_ref: "a", deployment_ref: null,
    input, trial, trial_hash: `${input}-${trial}`,
    completion_state: "success", truncated: false, task_outcome: outcome, outcome_reasons: [], rule_version: "success-v1",
    checks: { check: { state: pass ? "pass" : "fail", version: "v" } },
    judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0.01, source: "provider-reported" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms: 1000, ttft_ms: null, cache: null, finish_reason: "stop", isolation: null, error: null,
    legacy_status: "ok", legacy_check_passed: pass, reused_from: null,
  };
}

const gates = (g: number) => resolveEligibility(["check"], { minimum_reliability: g, minimum_required_check_pass_rate: g });

test("a gate of 0.9 over 100 trials stays reachable until the 11th failure", () => {
  // Arrange
  const plan = { trials: 100, inputs: 100 };
  const tenFailed = Array.from({ length: 10 }, (_, i) => row(`in-${i}`, 0, "failure"));
  const elevenFailed = [...tenFailed, row("in-10", 0, "failure")];

  // Act / Assert
  assert.equal(unreachableGate(tenFailed, plan, gates(0.9)), null);
  assert.match(unreachableGate(elevenFailed, plan, gates(0.9))!, /at most 0\.890 \(11 failed\), below the gate 0\.9/);
});

test("a gate of 1.0 is out of reach at the first failure", () => {
  const plan = { trials: 50, inputs: 50 };
  assert.equal(unreachableGate([row("in-0", 0, "success")], plan, gates(1)), null);
  assert.ok(unreachableGate([row("in-0", 0, "success"), row("in-1", 0, "failure")], plan, gates(1)));
});

test("pass^k is out of reach once too many inputs have a failed trial", () => {
  const e = { ...resolveEligibility([]), minimum_all_trials_pass_rate: 0.8 };
  const plan = { trials: 20, inputs: 10 };
  const two = [row("in-0", 1, "failure"), row("in-1", 0, "failure")];
  const three = [...two, row("in-2", 1, "failure")];
  assert.equal(unreachableGate(two, plan, e), null);
  assert.match(unreachableGate(three, plan, e)!, /pass\^k can reach at most 0\.700/);
});

test("no gate declared, nothing to stop for", () => {
  const e = resolveEligibility([], {});
  assert.equal(unreachableGate([row("in-0", 0, "failure")], { trials: 2, inputs: 2 }, e), null);
});

async function smokeWithEarlyStop(): Promise<{ ws: string; spec: string }> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "eval-early-stop-"));
  const dest = path.join(ws, "tasks", "smoke-local");
  await fs.cp(path.join(INSTALL_ROOT, "tasks", "smoke-local"), dest, {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });
  const inputs = ["code-utils", "code-utils-2", "code-utils-3"];
  const text = await fs.readFile(path.join(dest, "inputs", "code-utils.txt"), "utf-8");
  for (const slug of inputs.slice(1)) await fs.writeFile(path.join(dest, "inputs", `${slug}.txt`), text, "utf-8");
  const specPath = path.join(dest, "spec.yaml");
  const spec = YAML.parse(await fs.readFile(specPath, "utf-8"));
  spec.workflow.steps[0].test_set.inputs = inputs;
  spec.execution = { ...spec.execution, trials_per_case: 2, concurrency: 1, early_stop: true };
  await fs.writeFile(specPath, YAML.stringify(spec), "utf-8");
  return { ws, spec: specPath };
}

test("a run with early stop skips the failing candidate's rest and picks the same candidate", async () => {
  // Arrange: 3 inputs × 2 trials; fake-fail fails its first trial against a 1.0 gate
  const { ws, spec } = await smokeWithEarlyStop();
  const events: RunEvent[] = [];

  // Act
  await runSuite(spec, false, { yes: true, onEvent: (e) => events.push(e) });

  // Assert: one stop, five trials never run, fake-pass ran all six
  const stops = events.filter((e) => e.type === "candidate.stopped");
  assert.equal(stops.length, 1);
  const done = events.find((e): e is Extract<RunEvent, { type: "step.done" }> => e.type === "step.done")!;
  assert.equal(done.chosen, "fake-pass");
  assert.equal(done.rows.filter((r) => r.candidate === "fake-pass").length, 6);
  assert.equal(done.rows.filter((r) => r.candidate === "fake-fail").length, 1);
  assert.deepEqual(done.earlyStopped?.map((s) => [s.candidate, s.after_trials, s.skipped]), [["fake-fail", 1, 5]]);

  // Assert: the record says so
  const runs = path.join(path.dirname(spec), "runs");
  const [run] = await fs.readdir(runs);
  const gaps = await fs.readFile(path.join(runs, run, "GAPS.md"), "utf-8");
  const manifest = JSON.parse(await fs.readFile(path.join(runs, run, "manifest.json"), "utf-8"));
  assert.match(gaps, /\*\*early stop\*\*: fake-fail after 1 trial\(s\), 5 not run/);
  assert.equal(manifest.execution.early_stop, true);

  await fs.rm(ws, { recursive: true, force: true });
});
