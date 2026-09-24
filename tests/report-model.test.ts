import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fixturesDir } from "../src/paths.js";
import { loadBundle, renderRunReport } from "../src/report-v2.js";
import {
  buildStepReport, buildWorkflowReport, dimensionPreference, gapLines, loadReportModel,
} from "../src/report-model.js";
import { fmtPct, fmtUsd, heatTint } from "../src/report-format.js";
import { buildWorkflowRecord } from "../src/canon/workflow.js";
import { createDemoServer, listenDemo } from "../src/demo/server.js";
import type { EvaluationRow } from "../src/canon/rows.js";
import { parseRoute, hashFor } from "../src/demo/client/app/routes.js";
import { workflowStepFixture } from "./helpers/workflow-fixture.js";

const FIXTURE = path.join(fixturesDir(), "codegen-w38");

test("every number the model derives is the number report.html prints", async () => {
  // The two renderers read one model; this is what keeps them from drifting.
  const bundle = await loadBundle(FIXTURE);
  const model = buildStepReport(bundle);
  const page = renderRunReport(bundle);

  assert.ok(page.includes(model.verdict.text), "verdict sentence");
  assert.ok(page.includes(fmtUsd(model.ledger.total)), "ledger total");
  for (const c of model.candidates) {
    assert.ok(page.includes(`${fmtPct(c.winRate)}<span class="sub">${c.comparisons} 场</span>`), `win rate of ${c.id}`);
    assert.ok(page.includes(fmtUsd(c.costPerSuccess)), `cost per success of ${c.id}`);
  }
  for (const f of model.facts) assert.ok(page.includes(f.value.split(" · ")[0]), `fact ${f.label}`);
});

test("the verdict names the recommendation and marks everyone else it gated", async () => {
  const model = buildStepReport(await loadBundle(FIXTURE));
  assert.equal(model.verdict.chosen, "sonnet-5");
  assert.match(model.verdict.text, /sonnet-5 每次成功的生成成本最低/);
  assert.doesNotMatch(model.verdict.text, /[a-z]{4,} [a-z]{4,}/, "no English clause spliced into the sentence");
  for (const c of model.candidates) assert.equal(c.gated, !model.eligible.includes(c.id), c.id);
  assert.equal(model.candidates.filter((c) => c.chosen).length, 1);
});

test("a step with no eligible candidate says so, rather than naming nobody quietly", async () => {
  const bundle = await loadBundle(FIXTURE);
  const empty = { ...bundle, recommendation: { ...bundle.recommendation, eligible: [], chosen: null } };
  const model = buildStepReport(empty);

  assert.equal(model.verdict.chosen, null);
  assert.match(model.verdict.text, /没有候选通过全部门槛，所以这一步不给推荐/);
  assert.ok(model.candidates.every((c) => c.gated && !c.chosen));
  // The offline page says the same sentence from the same model.
  assert.ok(renderRunReport(empty).includes(model.verdict.text));
});

test("the model is plain data: it survives a JSON round trip unchanged", async () => {
  const model = buildStepReport(await loadBundle(FIXTURE));
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
});

test("dimension preference counts a tie as half and leaves an unmet pair empty", () => {
  const duel = (a: string, b: string, dims: Record<string, "a" | "b" | "tie">): EvaluationRow =>
    ({ evaluator: "pairwise-swap", state: "pass", subject: { kind: "pair", a, b, input: "i" }, dimensions: dims }) as unknown as EvaluationRow;

  const table = dimensionPreference([
    duel("x", "y", { style: "a", logic: "tie" }),
    duel("x", "z", { style: "a" }),
  ]);

  assert.ok(table);
  assert.deepEqual(table.dims, ["style", "logic"]);
  assert.equal(table.rows[0].candidate, "x"); // best first
  assert.deepEqual(table.rows[0].cells, [100, 50]);
  const z = table.rows.find((r) => r.candidate === "z");
  assert.deepEqual(z?.cells, [0, null]); // z never met anyone on logic
  assert.equal(dimensionPreference([]), null);
});

test("GAPS.md headings are kept only where the page shows sections", () => {
  const md = "# title\n## plan\n- `ttft_ms`: none.\nprose\n- cache: n/a\n";
  assert.deepEqual(gapLines(md, false), [
    { kind: "item", text: "`ttft_ms`: none." },
    { kind: "item", text: "cache: n/a" },
  ]);
  assert.equal(gapLines(md, true)[0].kind, "heading");
});

test("independent workflow steps get the no-verdict wording and a neutral tone", () => {
  const record = buildWorkflowRecord({
    protocolVersion: "0.4", runId: "r", runName: "r",
    steps: [workflowStepFixture(), workflowStepFixture({ id: "code", dir: "code" })],
    control: null, proposed: null, validation: null,
  });
  const model = buildWorkflowReport(record, "- nothing compared\n");

  assert.equal(model.kind, "workflow");
  assert.equal(model.tone, "");
  assert.match(model.verdictLine, /相互独立/);
});

test("loadReportModel picks the step report for a step directory", async () => {
  const model = await loadReportModel(FIXTURE);
  assert.equal(model.kind, "step");
});

test("heatTint is green above the midpoint and red below it", () => {
  assert.match(heatTint(5, 1, 5), /34,197,94/);
  assert.match(heatTint(1, 1, 5), /239,68,68/);
  assert.equal(heatTint(null, 1, 5), "");
});

test("a report route survives the address bar", () => {
  const route = { view: "report", runId: "r-1", dir: "run/r-1/plan" } as const;
  assert.deepEqual(parseRoute(hashFor(route)), route);
  // A run link without a report stays a run link.
  assert.deepEqual(parseRoute("#run=r-1"), { view: "run", runId: "r-1" });
});

test("the report API serves a model, 404s a non-run, and refuses to leave the run", async () => {
  const server: http.Server = createDemoServer();
  const origin = await listenDemo(server, 0);
  const get = async (p: string) => {
    const res = await fetch(origin + p);
    return { status: res.status, body: (await res.json()) as { kind?: string; error?: string } };
  };
  try {
    const ok = await get("/api/report/fixture/codegen-w38");
    assert.equal(ok.status, 200);
    assert.equal(ok.body.kind, "step");

    assert.equal((await get("/api/report/task/codegen-w38")).status, 404);
    assert.equal((await get("/api/report/task/" + encodeURIComponent("../../src"))).status, 403);
    assert.equal((await get("/api/report/run/" + encodeURIComponent("../package.json"))).status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
