/**
 * Cancelling a run stops the billing, not only the generation: once the
 * signal is aborted, no judge pair and no scored output is dispatched, and
 * each one not run is counted as skipped for that reason.
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { judgeAll, scoreAll } from "../src/core/evaluate.js";
import { loadSpec } from "../src/spec/load-spec.js";
import { BudgetGuard } from "../src/canon/budget.js";
import type { RunRecord } from "../src/types.js";
import type { RunEvent } from "../src/core/events.js";

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...savedEnv };
});

function record(candidate: string, inputSlug: string): RunRecord {
  return { candidate, inputSlug, trial: 0, text: `${candidate} on ${inputSlug}`, promptTokens: 1, completionTokens: 1, costUsd: 0, ms: 1, status: "ok" };
}

test("judgeAll and scoreAll dispatch nothing once the signal is aborted, and say why", async () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("no model may be called after cancel");
  }) as typeof fetch;
  const suite = await loadSpec("tasks/codegen-w38/spec.yaml");
  const records = suite.inputs.flatMap((input) => suite.candidates.map((c) => record(c, input)));
  const controller = new AbortController();
  controller.abort();
  const events: RunEvent[] = [];
  const emit = (e: RunEvent): void => {
    events.push(e);
  };

  const judged = await judgeAll(suite, "rubric", records, 2, () => undefined, new BudgetGuard(), emit, undefined, controller.signal);
  const scored: number[] = [];
  const failures: string[] = [];
  await scoreAll(suite, "rubric", records, 2, { emit, onScored: () => scored.push(1), onFailure: (f) => failures.push(f.message), signal: controller.signal }, new BudgetGuard());

  assert.equal(calls, 0);
  assert.equal(judged.judgements.length, 0);
  assert.equal(judged.failures.length, 0);
  assert.ok(judged.skipped.length > 0);
  assert.ok(judged.skipped.every((s) => /cancelled/.test(s.reason)), judged.skipped[0]?.reason);
  assert.deepEqual(scored, []);
  assert.deepEqual(failures, []);
  assert.equal(events.filter((e) => e.type === "judge" || e.type === "score").length, 0, "nothing was announced as started");
});
