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

test("reuse finds the task's own runs when an unrelated tasks/ sits above it", async () => {
  // Arrange - a task outside any workspace's tasks/, under a directory whose
  // ancestor holds some other tasks/. The workspace resolves to that
  // ancestor, whose scan never reached the runs written beside this task.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eval-reuse-"));
  await fs.mkdir(path.join(root, "tasks"));
  const dest = path.join(root, "other", "smoke-local");
  await fs.cp(path.join(INSTALL_ROOT, "tasks", "smoke-local"), dest, {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });
  const spec = path.join(dest, "spec.yaml");
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
  assert.ok(trials.length > 0 && trials.every((t) => t.reusedFrom), `not reused: ${JSON.stringify(trials)}`);

  await fs.rm(root, { recursive: true, force: true });
});

/** Rewrite one finished run's rows, as if those trials had failed the way `fail` says. */
async function failRows(ws: string, fail: (row: Record<string, unknown>, i: number) => Record<string, unknown> | null): Promise<void> {
  const runs = path.join(ws, "tasks", "smoke-local", "runs");
  const [run] = await fs.readdir(runs);
  const file = path.join(runs, run, "scores.jsonl");
  const rows = (await fs.readFile(file, "utf-8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const failed = rows.map((r, i) => {
    const f = fail(r, i);
    return f ? { ...r, ...f, legacy_status: "error", checks: {}, legacy_check_passed: null } : r;
  });
  await fs.writeFile(file, failed.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  // The run's journal still says these trials succeeded; a real failed run's agrees with its rows.
  await fs.rm(path.join(runs, run, "trials.partial.jsonl"), { force: true });
}

async function rerunWithReuse(spec: string): Promise<Array<Extract<RunEvent, { type: "trial" }>>> {
  const events: RunEvent[] = [];
  process.env.EVAL_REUSE = "1";
  try {
    await runSuite(spec, false, { yes: true, onEvent: (e) => events.push(e) });
  } finally {
    delete process.env.EVAL_REUSE;
  }
  return events.filter((e): e is Extract<RunEvent, { type: "trial" }> => e.type === "trial");
}

test("a timeout that had the full time limit is reused as a timeout; a provider error is generated again", async () => {
  // Arrange - one trial timed out after more than any limit, the other hit a provider error.
  const { ws, spec } = await workspaceWithSmoke();
  await runSuite(spec, false, { yes: true });
  await failRows(ws, (_, i) => (i === 0 ? { completion_state: "timeout", ms: 1e9, error: "timed out" } : { completion_state: "provider_error", error: "502" }));

  // Act
  const trials = await rerunWithReuse(spec);

  // Assert - asking again under the same limit would be a second chance, not a
  // regrade; the provider error says nothing about the candidate.
  const timedOut = trials.find((t) => t.reusedFrom);
  assert.equal(trials.filter((t) => t.reusedFrom).length, 1, JSON.stringify(trials));
  assert.equal(timedOut?.state, "timeout");
  assert.ok(trials.some((t) => !t.reusedFrom && t.state === "success"), "the provider error was not generated again");

  await fs.rm(ws, { recursive: true, force: true });
});

test("a timeout under a shorter limit than today's is generated again", async () => {
  // Arrange - both trials timed out after 1 ms: cut off long before this run's limit.
  const { ws, spec } = await workspaceWithSmoke();
  await runSuite(spec, false, { yes: true });
  await failRows(ws, () => ({ completion_state: "timeout", ms: 1, error: "timed out" }));

  // Act
  const trials = await rerunWithReuse(spec);

  // Assert
  assert.equal(trials.filter((t) => t.reusedFrom).length, 0, JSON.stringify(trials));
  assert.ok(trials.every((t) => t.state === "success"));

  await fs.rm(ws, { recursive: true, force: true });
});

test("which failed attempts are the candidate's own: a full-length timeout, a malformed answer from a model that was reached", async () => {
  const { isCandidatesOwnFailure } = await import("../src/core/generate.js");
  const attempt = (state: string, ms: number, promptTokens = 0, costUsd = 0) => ({ state, ms, promptTokens, costUsd });
  assert.equal(isCandidatesOwnFailure(attempt("timeout", 299_999), 300_000), true, "a 300 s timeout is recorded as 299,999 ms");
  assert.equal(isCandidatesOwnFailure(attempt("timeout", 120_000), 300_000), false, "cut off under a shorter limit");
  assert.equal(isCandidatesOwnFailure(attempt("provider_error", 300_000), 300_000), false);
  assert.equal(isCandidatesOwnFailure(attempt("malformed", 900, 2_100, 0.002), 300_000), true);
  assert.equal(isCandidatesOwnFailure(attempt("malformed", 3), 300_000), false, "a missing API key is recorded as malformed, and never reached the model");
});
