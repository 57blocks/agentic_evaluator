import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRawOutputs, renderDuels, renderOutputs, renderTrials } from "../src/report-evidence.js";
import type { EvaluationRow, TrialRow } from "../src/canon/rows.js";

const duel: EvaluationRow = {
  run: "r",
  step: "s",
  evaluator: "pairwise-swap",
  version: "judge+rubric+tpl",
  state: "pass",
  subject: { kind: "pair", a: "alpha", b: "beta", input: "case-1" },
  dimensions: { granularity: "b", dependencies: "tie" },
  dimension_detail: {
    granularity: { forward: "b", reverse: "b", resolved: "b", reason: "B splits FR-7 and FR-8 into T-4 and T-5; A merges them." },
    dependencies: { forward: "a", reverse: "b", resolved: "tie" },
  },
  overall: "b",
  evidence: "B is better because its T-4 cites AC-18 explicitly.",
  cost: { usd: 0.04, retry_usd: 0, source: "provider-reported", calls: 3 },
  ms: 1000,
};

function trial(over: Partial<TrialRow> = {}): TrialRow {
  return {
    run: "r",
    step: "s",
    candidate: "alpha",
    model_ref: "vendor/model",
    deployment_ref: null,
    input: "case-1",
    trial: 0,
    trial_hash: "h",
    completion_state: "success",
    truncated: false,
    task_outcome: "undetermined",
    outcome_reasons: [],
    rule_version: "success-v1",
    checks: {},
    judge: { pairwise: [{ vs: "beta", resolved: "loss" }], absolute_overall: 4, absolute_dimensions: { granularity: 4 } },
    cost: { generation: 0.12, source: "provider-reported" },
    tokens: { prompt: 10, completion: 20, cached: null },
    ms: 2000,
    finish_reason: "stop",
    isolation: null,
    ...over,
  } as TrialRow;
}

test("a duel card shows the cited rationale and both rounds when they disagree", () => {
  const html = renderDuels([duel]);
  assert.match(html, /B splits FR-7 and FR-8 into T-4 and T-5/);
  assert.match(html, /正反不一致/, "an order-swap disagreement was rendered as a plain tie");
  assert.match(html, /3 次调用（含重试）/);
});

test("a duel without per-dimension detail says so instead of inventing one", () => {
  const { dimension_detail: _dropped, ...legacy } = duel;
  const html = renderDuels([legacy as EvaluationRow]);
  assert.match(html, /未记录逐维度理由/);
  assert.doesNotMatch(html, /正反不一致/);
});

test("the trial table flags a truncated completion", () => {
  const html = renderTrials([trial(), trial({ trial: 1, truncated: true, finish_reason: "length" })]);
  assert.match(html, /截断/);
  assert.match(html, /loss vs beta/);
});

test("candidate output is escaped, not executed", () => {
  const html = renderOutputs([
    { candidate: "alpha", input: "case-1", trial: 0, text: "<script>alert(1)</script>", totalChars: 25 },
  ]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("a display-truncated output says how much was cut", () => {
  const html = renderOutputs([
    { candidate: "alpha", input: "case-1", trial: 0, text: "abc", totalChars: 90_000 },
  ]);
  assert.match(html, /90,000/);
});

test("loadRawOutputs reports a missing raw file instead of throwing", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-raw-"));
  await fs.mkdir(path.join(dir, "raw"), { recursive: true });
  await fs.writeFile(path.join(dir, "raw", "alpha__case-1__t0.txt"), "hello", "utf-8");
  const outputs = await loadRawOutputs(dir, [trial(), trial({ candidate: "beta" })]);
  assert.equal(outputs[0].text, "hello");
  assert.equal(outputs[1].text, null);
  assert.match(renderOutputs(outputs), /raw\/ 里没有这个文件/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("candidate ids with a slash map to the sanitised raw filename", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-raw-"));
  await fs.mkdir(path.join(dir, "raw"), { recursive: true });
  await fs.writeFile(path.join(dir, "raw", "vendor_model__case-1__t0.txt"), "legacy", "utf-8");
  const outputs = await loadRawOutputs(dir, [trial({ candidate: "vendor/model" })]);
  assert.equal(outputs[0].text, "legacy");
  await fs.rm(dir, { recursive: true, force: true });
});
