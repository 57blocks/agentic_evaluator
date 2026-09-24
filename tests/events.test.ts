/**
 * A run is observable while it happens.
 *
 * The driver emits events; a terminal, a dashboard and a test all read the
 * same stream. These assertions are about the stream's shape, not its
 * wording — the wording belongs to `src/cli/print.ts` and is asserted there.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INSTALL_ROOT } from "../src/paths.js";
import { planWorkflow } from "../src/core/plan.js";
import { loadWorkflow } from "../src/spec/load-spec.js";
import { formatEvent } from "../src/cli/print.js";
import type { RunEvent } from "../src/core/events.js";
import { runSuite } from "../src/run.js";

const SMOKE = path.join(INSTALL_ROOT, "tasks", "smoke-local", "spec.yaml");

test("planning a spec counts the calls it would make, and makes none", async () => {
  // Arrange
  const suites = await loadWorkflow(SMOKE);

  // Act
  const plan = planWorkflow(suites);

  // Assert - 2 candidates x 1 input x 1 trial, and no judging was declared.
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].generations, 2);
  assert.equal(plan.steps[0].pairs, 0, "no pairwise method is declared");
  assert.equal(plan.steps[0].judgeCalls, 0);
  assert.equal(plan.steps[0].scoreCalls, 0, "no absolute method is declared");
  assert.equal(plan.totalGenerations, 2);
  assert.equal(plan.e2e, null, "smoke-local declares no handoff");
});

test("a preview emits a plan per step and stops without executing", async () => {
  // Arrange
  const seen: RunEvent[] = [];

  // Act - no --yes.
  const report = await runSuite(SMOKE, false, { onEvent: (e) => seen.push(e) });

  // Assert
  assert.equal(report, null);
  assert.deepEqual(
    seen.map((e) => e.type),
    ["step.planned", "preview.only"],
  );
});

test("an executed run emits a trial per generation and one step.done", async () => {
  // Arrange - a copy, so the assertion is not about this repo's own runs dir.
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "eval-ev-"));
  const dest = path.join(ws, "tasks", "smoke-local");
  await fs.cp(path.dirname(SMOKE), dest, { recursive: true, filter: (s) => !s.includes(`${path.sep}runs`) });
  const seen: RunEvent[] = [];

  // Act
  await runSuite(path.join(dest, "spec.yaml"), false, { yes: true, onEvent: (e) => seen.push(e) });

  // Assert - both generations reported, by name, with their check state.
  const trials = seen.filter((e): e is Extract<RunEvent, { type: "trial" }> => e.type === "trial");
  assert.deepEqual(
    trials.map((t) => `${t.candidate}:${t.check}`).sort(),
    ["fake-fail:fail", "fake-pass:pass"],
  );

  // Assert - both judging methods are reported as off, rather than omitted.
  const phases = seen.filter((e): e is Extract<RunEvent, { type: "phase" }> => e.type === "phase");
  assert.deepEqual(
    phases.map((p) => `${p.phase}:${p.declared}`),
    ["judging:false", "scoring:false"],
  );

  // Assert - the step reports where it landed and what it chose.
  const done = seen.find((e): e is Extract<RunEvent, { type: "step.done" }> => e.type === "step.done");
  assert.ok(done, "no step.done event");
  assert.equal(done.chosen, "fake-pass");
  assert.equal(done.trials, 2);
  assert.equal(done.ledgerTotal, 0);

  await fs.rm(ws, { recursive: true, force: true });
});

test("every event renders to at least one line", async () => {
  // Arrange - one of each variant that a check-only run produces.
  const events: RunEvent[] = [
    { type: "preview.only" },
    { type: "phase", step: "codegen", phase: "judging", declared: false },
    { type: "trial", step: "codegen", candidate: "a", input: "i", trial: 0, state: "success", ms: 1200, costUsd: 0, costSource: "none", check: "pass" },
    { type: "trial", step: "codegen", candidate: "a", input: "i", trial: 0, state: "skipped" },
    { type: "judge", step: "codegen", a: "a", b: "b", input: "i", ok: true },
    { type: "score", step: "codegen", candidate: "a", input: "i", trial: 0, ok: false, error: "boom" },
    { type: "budget.stopped", limitUsd: 1, spentUsd: 0.5, skipped: { generation: 1, judging: 0, scoring: 0 } },
    { type: "integrity.gaps", gaps: 2, thresholdMs: 600_000 },
    { type: "e2e.validated", verdict: "keep-control", firmness: "directional", reason: "no improvement" },
  ];

  // Act + Assert
  for (const e of events) {
    const lines = formatEvent(e);
    assert.ok(lines.length >= 1 && lines.every((l) => typeof l === "string"), `${e.type} rendered nothing`);
  }
});
