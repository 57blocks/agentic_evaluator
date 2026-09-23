/**
 * Reusing a prior generation must not change what a run concludes.
 *
 * `EVAL_REUSE` exists to skip a call that would produce the same text, not to
 * produce a different answer for free. The failure it guards against is
 * silent by construction: the run still completes, still writes every file,
 * and simply recommends somebody else.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INSTALL_ROOT } from "../src/paths.js";
import { runSuite } from "../src/core/execute.js";
import type { RunEvent } from "../src/core/events.js";

async function workspaceWithSmoke(): Promise<{ ws: string; spec: string }> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "eval-reuse-"));
  const dest = path.join(ws, "tasks", "smoke-local");
  await fs.cp(path.join(INSTALL_ROOT, "tasks", "smoke-local"), dest, {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });
  return { ws, spec: path.join(dest, "spec.yaml") };
}

function stepDone(events: readonly RunEvent[]): Extract<RunEvent, { type: "step.done" }> {
  const done = events.find((e) => e.type === "step.done");
  assert.ok(done, "no step.done event");
  return done as Extract<RunEvent, { type: "step.done" }>;
}

test("a reused generation reaches the same recommendation as the run it came from", async () => {
  // Arrange - one honest run to reuse from.
  const { ws, spec } = await workspaceWithSmoke();
  const first: RunEvent[] = [];
  await runSuite(spec, false, { yes: true, onEvent: (e) => first.push(e) });

  // Act - the same spec again, with reuse on.
  process.env.EVAL_REUSE = "1";
  const second: RunEvent[] = [];
  try {
    await runSuite(spec, false, { yes: true, onEvent: (e) => second.push(e) });
  } finally {
    delete process.env.EVAL_REUSE;
  }

  // Assert - every trial was reused, and nothing was regenerated.
  const reused = second.filter((e): e is Extract<RunEvent, { type: "trial" }> => e.type === "trial");
  assert.equal(reused.length, 2);
  assert.ok(reused.every((t) => t.reusedFrom), `not reused: ${JSON.stringify(reused)}`);

  // Assert - and the conclusion is the same one. A reuse that loses the
  // required check's verdict still finishes, and recommends nobody.
  assert.equal(stepDone(second).chosen, stepDone(first).chosen);
  assert.equal(stepDone(second).chosen, "fake-pass");

  await fs.rm(ws, { recursive: true, force: true });
});

test("a reused trial still records how the artifact was produced, not null", async () => {
  // Arrange - one run to reuse from.
  const { ws, spec } = await workspaceWithSmoke();
  await runSuite(spec, false, { yes: true });

  // Act
  process.env.EVAL_REUSE = "1";
  try {
    await runSuite(spec, false, { yes: true });
  } finally {
    delete process.env.EVAL_REUSE;
  }

  // Assert - `isolation` says whether the candidate ran in a container or on
  // this machine, and the spec's image is part of the trial hash, so a reuse
  // hit is the same isolation by construction. Writing null would report
  // "not observed" for something recorded one directory over — and "ran on
  // the host" is exactly what a reader of the evidence is entitled to see.
  const runsRoot = path.join(ws, "tasks", "smoke-local", "runs");
  const [, second] = (await fs.readdir(runsRoot)).sort();
  const rows = (await fs.readFile(path.join(runsRoot, second, "scores.jsonl"), "utf-8"))
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { reused_from: string | null; isolation: string | null });

  assert.ok(rows.every((r) => r.reused_from), "expected every row to be a reuse");
  assert.deepEqual([...new Set(rows.map((r) => r.isolation))], ["none"]);

  await fs.rm(ws, { recursive: true, force: true });
});

test("reuse matches on the step recorded in the rows, not on the run directory's name", async () => {
  // Arrange - smoke-local's run_name is "smoke-local" and its step is
  // "codegen". The old filter looked for directories starting with the step
  // id, so reuse here silently did nothing while reporting reuse ON.
  const { ws, spec } = await workspaceWithSmoke();
  await runSuite(spec, false, { yes: true });

  // Act
  process.env.EVAL_REUSE = "1";
  const events: RunEvent[] = [];
  try {
    await runSuite(spec, false, { yes: true, onEvent: (e) => events.push(e) });
  } finally {
    delete process.env.EVAL_REUSE;
  }

  // Assert
  const trials = events.filter((e): e is Extract<RunEvent, { type: "trial" }> => e.type === "trial");
  assert.ok(trials.length > 0 && trials.every((t) => t.reusedFrom), "run_name differs from step id, and reuse still found it");

  await fs.rm(ws, { recursive: true, force: true });
});
