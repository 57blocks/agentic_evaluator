/**
 * `agenteval diff` on committed runs: the contract-terms-long set grown from
 * 60 to 100 packets (2026-11-05). What it prints is the answer to "did the
 * conclusion change", so the assertions are the lines a reader acts on.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { EXIT } from "../src/cli/exit-codes.js";
import { UsageError } from "../src/cli/args.js";
import { bufferIo } from "../src/cli/io.js";
import { main } from "../src/cli/index.js";
import type { RunDiff } from "../src/canon/run-diff.js";

const RUNS = "datasets/tasks/contract-terms-long/runs";
const SIXTY = path.join(RUNS, "contract-terms-long-2026-11-05T07-46-34-295Z");
const HUNDRED = path.join(RUNS, "contract-terms-long-2026-11-05T10-10-04-083Z");
const WORKFLOW = "datasets/tasks/agb-flow/runs/agb-flow-combined-2026-10-15T01-52-24-987Z";

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const io = bufferIo();
  const code = await main(argv, io);
  return { code, out: io.stdout, err: io.stderr };
}

test("diff says the pick changed, who left the gates, and how each rate moved", async () => {
  const r = await run(["diff", SIXTY, HUNDRED]);

  assert.equal(r.code, EXIT.ok, r.err);
  assert.match(r.out, /recommendation CHANGED: deepseek-v4\.1-flash \(directional\) → sonnet-5 \(directional\)/);
  assert.match(r.out, /60 shared, \+40 new/);
  for (const c of ["kimi-k3", "deepseek-v4.1-flash", "deepseek-v4-pro"]) assert.match(r.out, new RegExp(`LEFT\\s+${c.replace(/\./g, "\\.")}\\s`));
  for (const c of ["glm-5.3", "qwen3.8-max"]) assert.match(r.out, new RegExp(`stayed out\\s+${c.replace(/\./g, "\\.")}\\s`));
  assert.match(r.out, /sonnet-5\s+57\/60 0\.95 \[0\.86–0\.98\]\s+92\/100 0\.92 \[0\.85–0\.96\]\s+57\/60 → 57\/60\s+35\/40/);
  assert.match(r.out, /none: every shared input kept its outcome/);
});

test("diff --json splits every recorded rate exactly into shared and new inputs", async () => {
  const r = await run(["diff", SIXTY, HUNDRED, "--json"]);
  const [d, ...rest] = JSON.parse(r.out) as RunDiff[];
  assert.equal(rest.length, 0);
  assert.ok(d);

  assert.equal(r.code, EXIT.ok);
  for (const rate of d.rates) {
    for (const [recorded, shared, only] of [
      [rate.a, rate.shared.a, rate.onlyA],
      [rate.b, rate.shared.b, rate.onlyB],
    ] as const) {
      if (recorded === null) continue;
      assert.equal(shared.numerator + (only?.numerator ?? 0), recorded.numerator, `${rate.candidate} numerator`);
      assert.equal(shared.denominator + (only?.denominator ?? 0), recorded.denominator, `${rate.candidate} denominator`);
    }
  }
});

test("diff writes nothing into either run", async () => {
  const before = await fs.readdir(HUNDRED);
  await run(["diff", SIXTY, HUNDRED]);
  assert.deepEqual(await fs.readdir(HUNDRED), before);
});

test("diff needs two runs, and a step to compare a workflow run with a step run", async () => {
  await assert.rejects(run(["diff", SIXTY]), UsageError);
  await assert.rejects(run(["diff", WORKFLOW, SIXTY]), (err: unknown) => err instanceof UsageError && /--step/.test(err.message));
  await assert.rejects(run(["diff", WORKFLOW, WORKFLOW, "--step", "nope"]), (err: unknown) => err instanceof UsageError && /no step nope/.test(err.message));
});

test("a workflow run diffs step by step", async () => {
  const r = await run(["diff", WORKFLOW, WORKFLOW]);
  assert.equal(r.code, EXIT.ok, r.err);
  assert.equal((r.out.match(/^diff /gm) ?? []).length, 3);
  assert.match(r.out, /recommendation unchanged/);
});

test("diff --why prints what the check said before and after on each flipped input", async () => {
  const claims = "datasets/tasks/claim-denials-snf-v2/runs";
  const r = await run(["diff", `${claims}/claim-denials-snf-v2-2026-10-20T07-42-08-589Z`, `${claims}/claim-denials-snf-v2-2026-10-30T01-21-18-738Z`, "--why"]);

  assert.equal(r.code, EXIT.ok, r.err);
  assert.match(r.out, /^ {6}cd2-\d+ t\d+: before (pass|fail|timeout)[^\n]* \| after (pass|fail|timeout)/m);
});
