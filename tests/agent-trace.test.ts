/**
 * A command candidate's trace is read into turns and tool calls, honestly:
 * what the format does not record stays null, and a file that cannot be
 * read is an error on the row, not a silent zero.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { activityOf, TraceError } from "../src/canon/agent-trace.js";
import { parseAtif } from "../src/traces/atif.js";
import { TRACE_FILES } from "../src/traces/index.js";

const FIXTURES = path.resolve("tests/fixtures/agent-traces");

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(path.join(FIXTURES, name), "utf-8"));
}

test("ATIF: a Harbor terminus run reads as turns, tool calls and per-turn tokens", async () => {
  // Arrange - terminus-2 on Terminal-Bench fix-git, ATIF-v1.8, 11 steps.
  const raw = await fixture("atif-terminus-fix-git.json");

  // Act
  const trace = parseAtif(raw);
  const activity = activityOf(trace);

  // Assert - 10 agent steps, 23 tool calls (21 bash_command, 2 mark_task_complete); costs add up.
  assert.equal(trace.format, "atif");
  assert.equal(trace.turns, 10);
  assert.equal(trace.tool_calls.length, 23);
  assert.ok(trace.tool_calls.every((c) => c.failed === null), "ATIF observations carry no verdict");
  assert.ok(trace.tool_calls.some((c) => c.ms !== null && c.ms > 0), "timestamps give a duration");
  assert.deepEqual(trace.models, ["anthropic/claude-sonnet-5"]);
  assert.equal(trace.turn_tokens?.length, 10);
  assert.equal(trace.turn_tokens?.[0].prompt, 1045);
  assert.equal(trace.turn_tokens?.[1].cached, 1044);
  assert.ok(Math.abs((trace.cost_usd ?? 0) - 0.066391) < 1e-6, `cost ${trace.cost_usd}`);
  // What ATIF has no notion of.
  assert.equal(trace.retries, null);
  assert.equal(trace.denials, null);
  assert.equal(trace.compactions, null);
  assert.equal(trace.ended, null);

  assert.equal(activity.turns, 10);
  assert.equal(activity.tool_calls, trace.tool_calls.length);
  assert.deepEqual(activity.tools, { bash_command: 21, mark_task_complete: 2 });
});

test("ATIF: a trace with no step metrics has null turn tokens and cost, not zeros", () => {
  const trace = parseAtif({
    schema_version: "ATIF-v1.3",
    agent: { name: "x" },
    steps: [
      { step_id: 1, source: "user", message: "go" },
      { step_id: 2, source: "agent", message: "ok", tool_calls: [{ tool_call_id: "a", function_name: "ls", arguments: {} }] },
    ],
  });
  assert.equal(trace.turns, 1);
  assert.equal(trace.turn_tokens, null);
  assert.equal(trace.cost_usd, null);
  assert.deepEqual(trace.models, []);
  assert.deepEqual(trace.tool_calls, [{ name: "ls", ms: null, failed: null }]);
});

test("ATIF: a file that is not a trajectory is a TraceError", () => {
  for (const bad of [null, "x", {}, { schema_version: "ATIF-v1.8" }, { schema_version: "other", steps: [] }, { schema_version: "ATIF-v1.8", steps: "no" }]) {
    assert.throws(() => parseAtif(bad), TraceError, JSON.stringify(bad));
  }
});

test("each format has a fixed file name the command writes", () => {
  assert.deepEqual(TRACE_FILES, { atif: ".eval-trace.json" });
});
