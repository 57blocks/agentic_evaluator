import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { listRuns, listSpecs, loadRun, safeId } from "../src/demo/catalog.js";
import { createDemoServer, listenDemo, underRoot } from "../src/demo/server.js";
import { demoPage } from "../src/demo/ui.js";
import { latestLabel, runMeta, spendLabel, taskItem } from "../src/demo/client/render.js";
import type { RunView, TaskView } from "../src/demo/catalog.js";
import { buildWorkflowRecord } from "../src/canon/workflow.js";
import { WORKFLOW_LEDGER_FIXTURE, workflowStepFixture } from "./helpers/workflow-fixture.js";

async function get(url: string): Promise<{ status: number; type: string; body: string }> {
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
}

test("safeId rejects traversal", () => {
  assert.equal(safeId("prd-w38"), true);
  assert.equal(safeId(".."), false);
  assert.equal(safeId("../fixtures"), false);
  assert.equal(safeId("a/b"), false);
  assert.equal(safeId(""), false);
});

test("underRoot stays inside the given directory", () => {
  const root = path.resolve("/tmp/eval-runs");
  assert.equal(underRoot(root, "abc/report.html"), path.join(root, "abc/report.html"));
  assert.equal(underRoot(root, "../package.json"), null);
  assert.equal(underRoot(root, "abc/../../etc/passwd"), null);
});

test("listSpecs surfaces independent workflow steps", async () => {
  const specs = await listSpecs();
  const paths = specs.map((s) => s.path);
  assert.ok(paths.includes("tasks/prd-w38/spec.yaml"));
  assert.ok(paths.includes("tasks/codegen-w38/spec.yaml"));
  const prd = specs.find((s) => s.path === "tasks/prd-w38/spec.yaml");
  assert.deepEqual(prd?.steps.map((s) => s.id), ["prd", "taskbreakdown", "codegen"]);
  assert.equal(prd?.steps[0].producer, "prompt");
  const codegen = specs.find((s) => s.path === "tasks/codegen-w38/spec.yaml");
  assert.deepEqual(codegen?.steps[0].requiredChecks, ["tsc-noemit"]);
});

test("loadRun reads a committed fixture and refuses escapes", async () => {
  assert.equal(await loadRun(".."), null);
  assert.equal(await loadRun("fixture:.."), null);
  assert.equal(await loadRun("fixture:legacy-smoke"), null);
  const view = await loadRun("fixture:prd-w38");
  assert.ok(view);
  assert.equal(view.sample, true);
  assert.equal(view.kind, "single");
  assert.equal(view.runName, "prd-w38");
  assert.equal(view.steps[0].id, "prd");
  assert.equal(view.steps[0].reportHref, "/artifact/fixture/prd-w38/report.html");
  assert.ok(view.steps[0].firmness === "firm" || view.steps[0].firmness === "directional" || view.steps[0].firmness === "needs-review");
});

test("loadRun reads a nested workflow directory", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eval-demo-"));
  await fs.mkdir(path.join(tmp, "wf", "pass-step"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, "wf", "workflow.json"),
    JSON.stringify({
      run_name: "smoke-workflow",
      handoff: false,
      steps: [{ id: "pass-step", dir: "pass-step", chosen: "fake-pass", firmness: "directional" }],
    }),
  );
  const view = await loadRun("wf", { runsRoot: tmp });
  assert.equal(view?.kind, "workflow");
  assert.equal(view?.handoff, false);
  assert.equal(view?.steps[0].id, "pass-step");
  assert.equal(view?.steps[0].chosen, "fake-pass");
});

test("the demo opens a run written with the current workflow record", async () => {
  // Arrange — the record run.ts writes today, not the hand-rolled shape.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eval-demo-record-"));
  await fs.mkdir(path.join(tmp, "wf", "plan"), { recursive: true });
  const record = buildWorkflowRecord({
    protocolVersion: "0.4",
    runId: "wf",
    runName: "chain",
    steps: [workflowStepFixture()],
    control: {
      kind: "control",
      candidate: "cand-a",
      assignment: { plan: "cand-a" },
      chain: ["plan"],
      cases: 2,
      success: 1,
      failure: 1,
      undetermined: 0,
      cost_usd: 0.2,
    },
    proposed: null,
    validation: null,
  });
  await fs.writeFile(path.join(tmp, "wf", "workflow.json"), JSON.stringify(record));

  // Act
  const view = await loadRun("wf", { runsRoot: tmp });

  // Assert — the catalog reads the arm fields its UI renders.
  assert.equal(view?.kind, "workflow");
  assert.equal(view?.handoff, true);
  assert.equal(view?.e2e?.candidate, "cand-a");
  assert.deepEqual(view?.e2e?.chain, ["plan"]);
  assert.equal(view?.steps[0].chosen, "cand-a");
  assert.equal(record.ledger.total, WORKFLOW_LEDGER_FIXTURE.total + 0.2);
});

test("demo page names the four protocol questions", async () => {
  const html = await demoPage();
  assert.match(html, /做对了吗/);
  assert.match(html, /这一步用谁/);
  assert.match(html, /成本还是速度/);
  assert.match(html, /证据能否复现/);
});

test("demo server serves the page, catalog, fixture report, and blocks traversal", async () => {
  const server: http.Server = createDemoServer();
  const origin = await listenDemo(server, 0);
  try {
    const home = await get(origin + "/");
    assert.equal(home.status, 200);
    assert.match(home.type, /text\/html/);
    assert.match(home.body, /这一步该用谁/);

    const catalog = await get(origin + "/api/catalog");
    assert.equal(catalog.status, 200);
    const data = JSON.parse(catalog.body) as { specs: Array<{ path: string }>; runs: Array<{ id: string; sample?: boolean }> };
    assert.ok(data.specs.some((s) => s.path === "tasks/prd-w38/spec.yaml"));
    assert.ok(data.runs.some((r) => r.id === "fixture:prd-w38" && r.sample));

    const report = await get(origin + "/artifact/fixture/prd-w38/report.html");
    assert.equal(report.status, 200);
    assert.match(report.type, /text\/html/);

    const blocked = await get(origin + "/artifact/run/" + encodeURIComponent("../package.json"));
    assert.equal(blocked.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("listRuns leads with the featured fixture, then real runs, then synthetic ones", async () => {
  const runs = await listRuns();

  assert.equal(runs[0].id, "fixture:codegen-w38");
  assert.equal(runs[0].synthetic, false);

  const firstSynthetic = runs.findIndex((r) => r.synthetic);
  const lastReal = runs.map((r) => r.synthetic).lastIndexOf(false);
  if (firstSynthetic >= 0) assert.ok(firstSynthetic > lastReal - 1);
});

test("a run whose every candidate is a fake stand-in is marked synthetic", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "eval-demo-synth-"));
  await fs.mkdir(path.join(tmp, "wf", "pass-step"), { recursive: true });
  await fs.writeFile(
    path.join(tmp, "wf", "workflow.json"),
    JSON.stringify({
      run_name: "smoke-workflow",
      steps: [{ id: "pass-step", dir: "pass-step", chosen: "fake-pass", firmness: "directional" }],
    }),
  );

  const view = await loadRun("wf", { runsRoot: tmp });

  assert.equal(view?.synthetic, true);
});

test("a run with real model candidates is not synthetic and carries its total cost", async () => {
  const view = await loadRun("fixture:codegen-w38");

  assert.equal(view?.synthetic, false);
  assert.ok((view?.totalUsd ?? 0) > 0);
});

test("the nav labels a step with no eligible candidate as needing human review", () => {
  const run = {
    id: "r", task: "t", kind: "single", runName: "r", startedAt: "2026-09-21T00:00:00Z",
    handoff: false, sample: false, synthetic: false, totalUsd: 0.5,
    steps: [{ id: "s", dir: "", chosen: null, firmness: "needs-review", eligible: [],
              gated: [], operatingMode: null, ledgerTotal: null, reportHref: null }],
  } as unknown as RunView;

  assert.match(runMeta(run), /需人工评审/);
});

test("a task row states its spend against budget and calls out an overrun", () => {
  const base = { name: "t", specPath: "tasks/t/spec.yaml", runName: "t", steps: [], files: [], runs: [] };

  assert.match(spendLabel({ ...base, budgetUsd: 3, spentUsd: 3.96 } as TaskView), /超支/);
  assert.doesNotMatch(spendLabel({ ...base, budgetUsd: 3, spentUsd: 1.5 } as TaskView), /超支/);
  assert.equal(spendLabel({ ...base, budgetUsd: 3, spentUsd: null } as TaskView), "");
});

test("a task that has never run says so rather than rendering blank", () => {
  const task = {
    name: "smoke-e2e-control", specPath: "tasks/smoke-e2e-control/spec.yaml",
    runName: "smoke-e2e-control", budgetUsd: 1, spentUsd: null, steps: [], files: [], runs: [],
  } as unknown as TaskView;

  assert.equal(latestLabel(task), "未跑过");
  assert.match(taskItem(task), /smoke-e2e-control/);
});
