/**
 * The dashboard's run comparison: the route, the endpoint (the same diff the
 * CLI prints, run ids only), the "previous run" both the run page and the
 * export use, and the export recording that pair.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createDemoServer, listenDemo } from "../src/demo/server.js";
import { workspaceAt } from "../src/core/workspace.js";
import { exportDashboard } from "../src/demo/export.js";
import { hashFor, parseRoute } from "../src/demo/client/app/routes.js";
import { diffUrl } from "../src/demo/client/lib/api.js";
import { previousRun } from "../src/demo/client/lib/runs.js";
import type { RunView } from "../src/demo/catalog.js";
import type { RunDirDiff } from "../src/core/run-diff-pairs.js";

const SIXTY = "contract-terms-long-2026-11-05T07-46-34-295Z";
const HUNDRED = "contract-terms-long-2026-11-05T10-10-04-083Z";

test("a diff route survives the address bar, and a run link stays a run link", () => {
  const route = { view: "diff", before: "r-1", after: "r 2" } as const;
  assert.deepEqual(parseRoute(hashFor(route)), route);
  assert.deepEqual(parseRoute("#run=r-1"), { view: "run", runId: "r-1" });
});

function run(id: string, startedAt: string | null, over: Partial<RunView> = {}): RunView {
  return {
    id,
    dir: `run/${id}`,
    task: "t",
    kind: "single",
    runName: "t",
    startedAt,
    handoff: false,
    sample: false,
    synthetic: false,
    totalUsd: null,
    steps: [{ id: "s", dir: `run/${id}`, chosen: null, firmness: "directional", eligible: [], gated: [], operatingMode: null, ledgerTotal: null, reportHref: null }],
    ...over,
  };
}

test("the previous run is the latest earlier run of the same task that shares a step", () => {
  const runs = [run("c", "2026-11-03"), run("b", "2026-11-02"), run("a", "2026-11-01"), run("other", "2026-11-02T12", { task: "u" })];
  assert.equal(previousRun(runs, runs[0]!)?.id, "b");
  assert.equal(previousRun(runs, runs[2]!), null, "the first run has none");
  const noShared = run("d", "2026-11-04", { steps: [{ ...runs[0]!.steps[0]!, id: "other-step" }] });
  assert.equal(previousRun([...runs, noShared], noShared), null);
});

test("the diff API answers the CLI's diff by run id, 404s an unknown id, and takes no path", async () => {
  // Arrange: the committed datasets/ folder is a workspace; read only.
  const server: http.Server = createDemoServer(workspaceAt("datasets"));
  const origin = await listenDemo(server, 0);
  const get = async (p: string) => {
    const res = await fetch(origin + p);
    return { status: res.status, body: (await res.json().catch(() => ({}))) as RunDirDiff & { error?: string } };
  };
  try {
    // Act
    const ok = await get(diffUrl(SIXTY, HUNDRED));
    const unknown = await get(diffUrl(SIXTY, "no-such-run"));
    const escape = await get(`/api/diff/${encodeURIComponent("../../etc")}/${HUNDRED}`);

    // Assert
    assert.equal(ok.status, 200);
    assert.equal(ok.body.diffs.length, 1);
    assert.deepEqual(ok.body.diffs[0]?.recommendation.b, { chosen: "sonnet-5", firmness: "directional" });
    assert.equal(ok.body.diffs[0]?.recommendation.changed, true);
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.error ?? "", /no-such-run/);
    assert.equal(escape.status, 404, "an id that is a path is just an unknown id");
  } finally {
    server.close();
  }
});

/** A run with just what a diff and the catalog read. */
async function tinyRun(task: string, id: string, startedAt: string, chosen: string): Promise<void> {
  const dir = path.join(task, "runs", id);
  await fs.mkdir(dir, { recursive: true });
  const write = (name: string, value: unknown) => fs.writeFile(path.join(dir, name), JSON.stringify(value, null, 2));
  await write("manifest.json", { run_id: id, run_name: "demo", step: { id: "s" }, test_set: { inputs: { a: "h" } }, candidates: { m1: {}, m2: {} }, started_at: startedAt });
  await write("recommendation.json", { rule_version: "select-v4", chosen, firmness: "directional", eligible: [chosen], filters: [], tradeoffs: [], reasons: [] });
  const rate = { value: 1, numerator: 1, denominator: 1 };
  await write("summary.json", { run: id, step: "s", candidates: ["m1", "m2"].map((c) => ({ candidate: c, task_success_rate: rate })) });
  const row = (c: string) => ({ run: id, step: "s", candidate: c, input: "a", trial: 0, trial_hash: "x", completion_state: "success", task_outcome: "success", checks: {}, judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null }, cost: { generation: 0, source: "none" }, tokens: { prompt: 0, completion: 0, cached: null }, ms: 1, reused_from: null });
  await fs.writeFile(path.join(dir, "scores.jsonl"), ["m1", "m2"].map((c) => JSON.stringify(row(c))).join("\n") + "\n");
}

const STATIC_BUILD = path.resolve("dist/demo-static/index.html");

test("an export records each run's comparison with the run before it", { skip: existsSync(STATIC_BUILD) ? false : "needs pnpm build:demo" }, async () => {
  // Arrange
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dash-diff-ws-"));
  const task = path.join(root, "tasks", "demo");
  await fs.mkdir(task, { recursive: true });
  await fs.cp("tasks/smoke-local/spec.yaml", path.join(task, "spec.yaml"));
  await tinyRun(task, "demo-2026-11-01T00-00-00-000Z", "2026-11-01T00:00:00.000Z", "m1");
  await tinyRun(task, "demo-2026-11-02T00-00-00-000Z", "2026-11-02T00:00:00.000Z", "m2");
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "dash-diff-out-"));

  // Act
  await exportDashboard(workspaceAt(root), out);

  // Assert
  const sandbox = { window: {} as { __AGENTEVAL_SNAPSHOT__?: Record<string, { status: number; body: string }> } };
  for (const f of await fs.readdir(path.join(out, "data"))) vm.runInNewContext(await fs.readFile(path.join(out, "data", f), "utf-8"), sandbox);
  const snapshot = sandbox.window.__AGENTEVAL_SNAPSHOT__ ?? {};
  const entry = snapshot[diffUrl("demo-2026-11-01T00-00-00-000Z", "demo-2026-11-02T00-00-00-000Z")];
  assert.equal(entry?.status, 200);
  const recorded = JSON.parse(entry!.body) as RunDirDiff;
  assert.deepEqual(recorded.diffs[0]?.recommendation, { a: { chosen: "m1", firmness: "directional" }, b: { chosen: "m2", firmness: "directional" }, changed: true });
  assert.equal(snapshot[diffUrl("demo-2026-11-02T00-00-00-000Z", "demo-2026-11-01T00-00-00-000Z")], undefined, "only earlier → later");
});
