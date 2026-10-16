/** `agenteval dash --export`: the dashboard written out as files that open from disk, read-only. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { exportDashboard } from "../src/demo/export.js";
import { workspaceAt } from "../src/core/workspace.js";

const STATIC_BUILD = path.resolve("dist/demo-static/index.html");
const needsBuild = existsSync(STATIC_BUILD) ? false : "needs the static dashboard build: pnpm build:demo";

type Win = { __AGENTEVAL_SNAPSHOT__?: Record<string, { status: number; body: string }> };
const g = globalThis as unknown as { window?: Win };

test("client: with a snapshot, reads come from it and writes are refused", async () => {
  g.window = { __AGENTEVAL_SNAPSHOT__: { "/api/catalog": { status: 200, body: '{"tasks":[]}' }, "/artifact/run/x/GAPS.md": { status: 200, body: "# gaps" } } };
  try {
    const api = await import("../src/demo/client/lib/api.js");
    assert.deepEqual(await api.getJson("/api/catalog"), { tasks: [] });
    assert.equal(await api.getTextOrNull("/artifact/run/x/GAPS.md"), "# gaps");
    assert.equal(await api.getTextOrNull("/artifact/run/x/missing.md"), null, "a file the export did not record reads as absent");
    await assert.rejects(api.getText("/artifact/task/t/spec.yaml"), /not in this export/);
    await assert.rejects(api.postJson("/api/runs", {}), /read-only export/);
    const { exportedHref } = await import("../src/demo/client/lib/snapshot.js");
    assert.equal(exportedHref("/artifact/run/x/report.html"), "./artifact/run/x/report.html");
  } finally {
    delete g.window;
  }
});

test("export: index.html carries the app inline, data scripts hold every page's reads, report pages sit beside it", { skip: needsBuild }, async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "dash-export-"));
  const r = await exportDashboard(workspaceAt(path.resolve("datasets")), out);

  const html = await fs.readFile(path.join(out, "index.html"), "utf-8");
  assert.doesNotMatch(html, /<script type="module"[^>]*src=/, "no module script loaded from a file: it would not run from disk");
  assert.doesNotMatch(html, /<link rel="stylesheet"/, "styles are inline");
  assert.match(html, /<script src="data\/snapshot-1\.js"><\/script>/);

  const data = (await fs.readdir(path.join(out, "data"))).sort();
  // Run the data scripts as the page would, in a sandbox with only a `window`.
  const sandbox = vm.createContext({ window: {} as { __AGENTEVAL_SNAPSHOT__?: Record<string, { status: number; body: string }> } });
  for (const f of data) vm.runInContext(await fs.readFile(path.join(out, "data", f), "utf-8"), sandbox);
  const snapshot = (sandbox.window as { __AGENTEVAL_SNAPSHOT__: Record<string, { status: number; body: string }> }).__AGENTEVAL_SNAPSHOT__;

  assert.equal(Object.keys(snapshot).length, r.responses);
  assert.equal(snapshot["/api/catalog"].status, 200);
  const catalog = JSON.parse(snapshot["/api/catalog"].body) as { tasks: Array<{ name: string; runs: Array<{ dir: string }> }> };
  const claim = catalog.tasks.find((t) => t.name === "claim-denials-snf-v2")!;
  const runDir = claim.runs[0].dir;
  assert.equal(snapshot[`/api/report/${runDir.split("/").map(encodeURIComponent).join("/")}`].status, 200, "the run's report model");
  assert.equal(snapshot[`/artifact/${runDir}/scores.jsonl`].status, 200, "the run's evidence");
  assert.ok(Object.keys(snapshot).some((u) => u.startsWith("/artifact/task/claim-denials-snf-v2/")), "the task's definition files");
  assert.ok(existsSync(path.join(out, "artifact", runDir, "report.html")), "the run's own report.html, linked from its page");
});
