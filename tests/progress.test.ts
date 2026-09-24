/**
 * The live view's state is a fold over the same events the line printer reads.
 *
 * These assertions are about what the fold keeps — counts, spend, which
 * lines are permanent — not about how Ink draws it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { initialProgress, reduceProgress, type Progress } from "../src/cli/progress.js";
import type { RunEvent, StepPlan } from "../src/core/events.js";

const PLAN: StepPlan = {
  step: "draft",
  suiteId: "s",
  producer: "model-api",
  candidates: 2,
  inputs: 1,
  trials: 2,
  generations: 4,
  pairs: 1,
  judgeCalls: 2,
  scoreCalls: 4,
  judge: "j",
  concurrency: 2,
  reuse: false,
  budgetUsd: null,
  benchmarkMode: "off",
  cacheMode: "off",
  directional: false,
};

function trial(over: Partial<Extract<RunEvent, { type: "trial" }>> = {}): RunEvent {
  return { type: "trial", step: "draft", candidate: "a", input: "i", trial: 1, state: "success", costUsd: 0.01, ...over };
}

function fold(events: readonly RunEvent[]): Progress {
  return events.reduce(reduceProgress, initialProgress());
}

test("totals come from the step's plan and done counts from its trials", () => {
  // Arrange / Act
  const p = fold([{ type: "step.planned", plan: PLAN }, trial(), trial({ candidate: "b" })]);

  // Assert
  assert.equal(p.active, "draft");
  assert.deepEqual(p.counts.draft.generations, { done: 2, total: 4, failed: 0 });
  assert.equal(p.spentUsd, 0.02);
});

test("a failed or skipped trial is counted and kept as a permanent line", () => {
  // Arrange / Act
  const p = fold([
    { type: "step.planned", plan: PLAN },
    trial({ state: "error", error: "boom" }),
    trial({ state: "skipped" }),
  ]);

  // Assert
  assert.equal(p.counts.draft.generations.failed, 2);
  assert.ok(p.log.some((l) => l.text.includes("boom")));
  assert.ok(p.log.some((l) => l.text.includes("budget limit reached")));
});

test("a successful trial is progress, not a permanent line", () => {
  // Arrange
  const before = fold([{ type: "step.planned", plan: PLAN }]);

  // Act
  const after = reduceProgress(before, trial());

  // Assert
  assert.equal(after.log.length, before.log.length);
});

test("judge and score events count dispatches, and a second event marks a failure", () => {
  // Arrange / Act
  const p = fold([
    { type: "step.planned", plan: PLAN },
    { type: "phase", step: "draft", phase: "judging", declared: true },
    { type: "judge", step: "draft", a: "a", b: "b", input: "i", ok: true },
    { type: "judge", step: "draft", a: "a", b: "b", input: "i", ok: false, error: "x" },
    { type: "score", step: "draft", candidate: "a", input: "i", trial: 1, ok: true },
  ]);

  // Assert
  assert.equal(p.phase, "judging");
  assert.deepEqual(p.counts.draft.judging, { done: 1, total: 1, failed: 1 });
  assert.deepEqual(p.counts.draft.scoring, { done: 1, total: 4, failed: 0 });
});

test("an e2e arm's trials count against the arm, not the step they reuse", () => {
  // Arrange / Act
  const p = fold([
    { type: "step.planned", plan: PLAN },
    { type: "workflow.planned", e2e: { controlCandidate: "a", chain: ["draft"], perArm: 3 } },
    { type: "e2e.arm.start", armId: "e2e-control", assignment: { draft: "a" } },
    trial(),
  ]);

  // Assert
  assert.equal(p.active, "e2e-control");
  assert.deepEqual(p.counts["e2e-control"].generations, { done: 1, total: 3, failed: 0 });
  assert.equal(p.counts.draft, undefined, "the step itself saw no trials");
});

test("a finished step clears the live block and keeps its summary", () => {
  // Arrange / Act
  const p = fold([
    { type: "step.planned", plan: PLAN },
    trial(),
    {
      type: "step.done",
      step: "draft",
      dir: "runs/x",
      trials: 1,
      evaluations: 0,
      traceEvents: 0,
      ledgerTotal: 0,
      ledgerSource: "none",
      chosen: "a",
      firmness: "directional",
      html: false,
      gated: [],
      rows: [],
      candidates: ["a"],
    },
  ]);

  // Assert
  assert.equal(p.active, null);
  assert.ok(p.log.some((l) => l.text.includes("recommend a")));
});

test("reducing never mutates the previous state", () => {
  // Arrange
  const before = fold([{ type: "step.planned", plan: PLAN }]);
  const snapshot = JSON.stringify(before);

  // Act
  reduceProgress(before, trial({ state: "error", error: "boom" }));

  // Assert
  assert.equal(JSON.stringify(before), snapshot);
});
