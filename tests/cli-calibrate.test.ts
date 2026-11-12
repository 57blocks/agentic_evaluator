/**
 * `agenteval calibrate` on the committed 2026-10-22 review labels and the
 * combined runs that review was built from.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EXIT } from "../src/cli/exit-codes.js";
import { UsageError } from "../src/cli/args.js";
import { bufferIo } from "../src/cli/io.js";
import { main } from "../src/cli/index.js";
import type { JudgeCalibration } from "../src/canon/judge-calibration.js";

const LABELS = "datasets/review/2026-10-22/judge-labels";
const CLAIMS = "datasets/tasks/claim-denials-snf-v2/runs/claim-denials-snf-v2-combined-2026-10-21T00-51-44-560Z";
const KYC = "datasets/tasks/kyc-ubo-v2/runs/kyc-ubo-v2-combined-2026-10-21T00-51-45-005Z";
const WORKFLOW = "datasets/tasks/agb-flow/runs/agb-flow-combined-2026-10-15T01-52-24-987Z";

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const io = bufferIo();
  const code = await main(argv, io);
  return { code, out: io.stdout };
}

async function labelsFile(lines: string[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "labels-"));
  const file = path.join(dir, "labels.jsonl");
  await fs.writeFile(file, lines.join("\n") + "\n");
  return file;
}

test("claim-denials: every answer the review called wrong got a 5, so the score does not separate them", async () => {
  const r = await run(["calibrate", CLAIMS, "--labels", path.join(LABELS, "claim-denials.jsonl")]);

  assert.equal(r.code, EXIT.ok);
  assert.match(r.out, /labels: 690 of 690 matched/);
  assert.match(r.out, /they are the check's verdicts/);
  assert.match(r.out, /overall\s+645 · 4\.93\s+45 · 5\.00\s+0\.48 \[[\d.]+–[\d.]+\]\s+45 of 45\s+does not separate/);
});

test("kyc: the correct-basis dimension separates right from wrong, reasoning-clarity does not", async () => {
  const r = await run(["calibrate", KYC, "--labels", path.join(LABELS, "kyc-ubo-v2.jsonl"), "--json"]);
  const c = JSON.parse(r.out) as JudgeCalibration;
  const m = (name: string) => c.measures.find((x) => x.measure === name)!;

  assert.equal(c.matched, 598);
  assert.equal(m("overall").auc?.toFixed(2), "0.62");
  assert.equal(m("correct-basis").verdict, "separates");
  assert.equal(m("reasoning-clarity").verdict, "does-not-separate");
});

test("a malformed or contradictory labels file is refused with its line number", async () => {
  const bad = await labelsFile(['{"candidate":"opus-5.5","input":"ubo2-001","label":"right"}', '{"candidate":"opus-5.5","input":"ubo2-001","label":"maybe"}']);
  await assert.rejects(run(["calibrate", KYC, "--labels", bad]), (e: unknown) => e instanceof UsageError && /line 2/.test(e.message));

  const clash = await labelsFile(['{"candidate":"opus-5.5","input":"ubo2-001","label":"right"}', '{"candidate":"opus-5.5","input":"ubo2-001","label":"wrong"}']);
  await assert.rejects(run(["calibrate", KYC, "--labels", clash]), (e: unknown) => e instanceof UsageError && /line 2.*line 1/.test(e.message));
});

test("calibrate needs a run, a labels file, and a step for a workflow run", async () => {
  await assert.rejects(run(["calibrate", "--labels", "x.jsonl"]), UsageError);
  await assert.rejects(run(["calibrate", KYC]), (e: unknown) => e instanceof UsageError && /--labels/.test(e.message));
  await assert.rejects(run(["calibrate", WORKFLOW, "--labels", path.join(LABELS, "kyc-ubo-v2.jsonl")]), (e: unknown) => e instanceof UsageError && /--step/.test(e.message));
});

test("calibrate writes nothing into the run", async () => {
  const before = await fs.readdir(KYC);
  await run(["calibrate", KYC, "--labels", path.join(LABELS, "kyc-ubo-v2.jsonl")]);
  assert.deepEqual(await fs.readdir(KYC), before);
});
