/**
 * A task is self-contained: copy the directory anywhere and it still runs.
 *
 * This is the property that lets the harness be installed and pointed at a
 * task the user owns, instead of only at tasks vendored into its own
 * checkout. `tasks/smoke-local` is the vehicle — two local command
 * candidates, no declared judging method, so the whole pipeline runs with
 * zero network calls and a fixed expected recommendation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INSTALL_ROOT } from "../src/paths.js";
import { runSuite } from "../src/run.js";

const SMOKE = path.join(INSTALL_ROOT, "tasks", "smoke-local");

async function copyTaskOutside(): Promise<{ workspace: string; spec: string }> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "eval-ws-"));
  const dest = path.join(workspace, "tasks", "smoke-local");
  await fs.cp(SMOKE, dest, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  return { workspace, spec: path.join(dest, "spec.yaml") };
}

test("a task copied outside the harness runs, and writes its runs beside itself", async () => {
  // Arrange
  const { workspace, spec } = await copyTaskOutside();

  // Act
  const report = await runSuite(spec, false, { yes: true });

  // Assert - the run landed in the copied task, not back in the harness.
  assert.ok(report, "runSuite returned no report");
  const runsRoot = path.join(workspace, "tasks", "smoke-local", "runs");
  const runs = await fs.readdir(runsRoot);
  assert.equal(runs.length, 1, `expected one run under ${runsRoot}, got ${runs.join(", ")}`);

  // Assert - the pipeline actually graded: fake-pass compiles, fake-fail does not.
  const runDir = path.join(runsRoot, runs[0]);
  const recommendation = JSON.parse(await fs.readFile(path.join(runDir, "recommendation.json"), "utf-8")) as {
    chosen: string | null;
  };
  assert.equal(recommendation.chosen, "fake-pass");

  // Assert - nothing was billed: no judging method was declared.
  const ledger = JSON.parse(await fs.readFile(path.join(runDir, "ledger.json"), "utf-8")) as { total: number };
  assert.equal(ledger.total, 0);

  await fs.rm(workspace, { recursive: true, force: true });
});
