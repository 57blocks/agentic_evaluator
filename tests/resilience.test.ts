/**
 * Three guards that decide whether a run's numbers mean anything:
 * transport retry, the spending ceiling, and wall-clock integrity.
 *
 * All three come from real runs — a flapping 403 that killed a candidate on
 * every step, a budget that was printed but never enforced, and a 600s
 * timeout that made the harness accuse its own host of suspending.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BudgetGuard, budgetGap } from "../src/canon/budget.js";
import { traceIntegrity } from "../src/canon/trace.js";
import { isTransportFailure, LlmError } from "../src/llm.js";

/* ── transport retry ─────────────────────────────────────────────────────── */

const httpError = (status: number, body = ""): LlmError =>
  new LlmError(`OpenRouter ${status}: ${body}`, { kind: "http", httpStatus: status, ms: 10 });

test("rate limits, gateway errors and network faults are transport failures", () => {
  assert.equal(isTransportFailure(httpError(429)), true);
  assert.equal(isTransportFailure(httpError(503)), true);
  assert.equal(isTransportFailure(new LlmError("network error: socket hang up", { kind: "network", ms: 5 })), true);
});

test("a 403 counts as transport only when the body shows endpoint routing", () => {
  // The flap that killed a real run: the geo gate emptied the endpoint pool.
  const gated = httpError(403, '{"error":{"message":"This model is not available in your region.","metadata":{"routing_funnel":[]}}}');
  assert.equal(isTransportFailure(gated), true);

  // A plain 403 is an access problem; retrying it just wastes attempts.
  assert.equal(isTransportFailure(httpError(403, '{"error":{"message":"No access to this model"}}')), false);
});

test("a timeout is the candidate's result, never a transport retry", () => {
  assert.equal(isTransportFailure(new LlmError("timeout after 600000ms", { kind: "timeout", ms: 600_000 })), false);
});

test("an empty completion is a candidate result too", () => {
  assert.equal(isTransportFailure(new LlmError("empty completion", { kind: "empty", ms: 20 })), false);
});

/* ── budget ──────────────────────────────────────────────────────────────── */

test("a run with no declared limit is never stopped", () => {
  const b = new BudgetGuard();
  b.add(1000);
  assert.equal(b.allows("generation"), true);
  assert.equal(b.stoppedEarly, false);
  assert.equal(budgetGap(b.state()), null);
});

test("units are refused once spend reaches the ceiling, and counted by kind", () => {
  // Arrange
  const b = new BudgetGuard(1);

  // Act — two calls take it over the line.
  assert.equal(b.allows("generation"), true);
  b.add(0.6);
  assert.equal(b.allows("generation"), true);
  b.add(0.5);

  // Assert
  assert.equal(b.allows("generation"), false);
  assert.equal(b.allows("judging"), false);
  const state = b.state();
  assert.equal(state.stopped_early, true);
  assert.equal(state.spent_usd, 1.1);
  assert.deepEqual(state.skipped, { generation: 1, judging: 1, scoring: 0 });
});

test("the gaps file says the run is partial and how much was skipped", () => {
  const b = new BudgetGuard(0.5);
  b.add(0.7);
  b.allows("scoring");

  const line = budgetGap(b.state()) ?? "";
  assert.match(line, /budget limit reached/);
  assert.match(line, /0 generation\(s\), 0 judgement\(s\) and 1 scoring call\(s\)/);
  assert.match(line, /this run is partial/);
});

/* ── wall-clock integrity ────────────────────────────────────────────────── */

async function traceFile(rows: readonly { ts: string; type: string }[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-trace-"));
  const file = path.join(dir, "trace.jsonl");
  await fs.writeFile(file, rows.map((r, i) => JSON.stringify({ seq: i + 1, run: "r", ...r })).join("\n") + "\n", "utf-8");
  return file;
}

const at = (minutes: number): string => new Date(Date.UTC(2026, 8, 21, 0, minutes)).toISOString();

test("a long quiet stretch with a call in flight is a slow call, not a suspension", async () => {
  // Arrange — one request, answered ten minutes later: a 600s timeout.
  const file = await traceFile([
    { ts: at(0), type: "model.request" },
    { ts: at(10), type: "model.error" },
    { ts: at(11), type: "model.request" },
    { ts: at(11), type: "model.response" },
  ]);

  // Act
  const integrity = await traceIntegrity(file);

  // Assert
  assert.equal(integrity.gaps_over_threshold, 0, "the host is not accused");
  assert.equal(integrity.in_flight_gaps, 1);
});

test("a long quiet stretch with nothing in flight still means the host stalled", async () => {
  const file = await traceFile([
    { ts: at(0), type: "model.request" },
    { ts: at(1), type: "model.response" },
    { ts: at(30), type: "model.request" },
    { ts: at(31), type: "model.response" },
  ]);

  const integrity = await traceIntegrity(file);

  assert.equal(integrity.gaps_over_threshold, 1);
  assert.equal(integrity.in_flight_gaps, 0);
  assert.equal(integrity.longest_gap_ms, 29 * 60_000);
});
