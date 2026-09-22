/**
 * The cross-run view — the one thing `dashboard.ts` did that no canonical
 * page could, and half of the legacy renderer's retirement gate.
 *
 * The assertions that matter here are about absence: a task defined and never
 * run, and a step that ran and chose nobody, both have to be reported as
 * themselves rather than left out of a table of results.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INSTALL_ROOT } from "../src/paths.js";
import { workspaceAt } from "../src/core/workspace.js";
import { buildOverview } from "../src/server/overview.js";
import { runSuite } from "../src/core/execute.js";

async function workspaceWith(tasks: readonly string[]): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "eval-ov-"));
  for (const name of tasks) {
    await fs.cp(path.join(INSTALL_ROOT, "tasks", name), path.join(ws, "tasks", name), {
      recursive: true,
      filter: (s) => !s.includes(`${path.sep}runs`),
    });
  }
  return ws;
}

test("a task defined and never run is named, not omitted", async () => {
  // Arrange - two tasks, neither has run.
  const ws = await workspaceWith(["smoke-local", "smoke-agent-cli"]);

  // Act
  const overview = await buildOverview(workspaceAt(ws));

  // Assert - "0 of 2 measured" is the finding; an empty table is not.
  assert.equal(overview.tasks.total, 2);
  assert.equal(overview.tasks.run, 0);
  assert.deepEqual(overview.unobserved.tasksNeverRun.sort(), ["smoke-agent-cli", "smoke-local"]);
  assert.equal(overview.steps.length, 0);
  assert.equal(overview.spend.totalUsd, null, "no run reported a ledger, so the total is unknown — not zero");

  await fs.rm(ws, { recursive: true, force: true });
});

test("after a run, the step's latest standing and its eligibility gate are both reported", async () => {
  // Arrange
  const ws = await workspaceWith(["smoke-local", "smoke-agent-cli"]);
  await runSuite(path.join(ws, "tasks", "smoke-local", "spec.yaml"), false, { yes: true });

  // Act
  const overview = await buildOverview(workspaceAt(ws));

  // Assert - the standing, and who the gate removed. A ranking that shows
  // only the winner hides the reason it won.
  assert.equal(overview.tasks.run, 1);
  assert.equal(overview.steps.length, 1);
  const [standing] = overview.steps;
  assert.equal(standing.step, "codegen");
  assert.equal(standing.task, "smoke-local");
  assert.equal(standing.chosen, "fake-pass");
  assert.deepEqual(standing.eligible, ["fake-pass"]);
  assert.equal(standing.gated.length, 1, "fake-fail was removed by the required check");
  assert.equal(standing.gated[0].candidate, "fake-fail");
  assert.equal(standing.operatingMode, "lowest-cost");
  assert.equal(standing.synthetic, true, "both candidates are scripted stand-ins");

  // Assert - and the task that still has not run is still named.
  assert.deepEqual(overview.unobserved.tasksNeverRun, ["smoke-agent-cli"]);

  await fs.rm(ws, { recursive: true, force: true });
});

test("the newest run wins per step, no matter which task produced it", async () => {
  // Arrange - two runs of the same step id, the second strictly later.
  const ws = await workspaceWith(["smoke-local"]);
  const spec = path.join(ws, "tasks", "smoke-local", "spec.yaml");
  await runSuite(spec, false, { yes: true });
  await new Promise((r) => setTimeout(r, 1100)); // run ids are second-resolution
  await runSuite(spec, false, { yes: true });

  // Act
  const overview = await buildOverview(workspaceAt(ws));

  // Assert - one row, and it is the later run.
  assert.equal(overview.steps.length, 1);
  const runs = (await fs.readdir(path.join(ws, "tasks", "smoke-local", "runs"))).sort();
  assert.equal(runs.length, 2);
  assert.equal(overview.steps[0].runId, runs[1]);
  assert.equal(overview.spend.runs, 2);

  await fs.rm(ws, { recursive: true, force: true });
});
