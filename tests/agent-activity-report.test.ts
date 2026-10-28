/**
 * The report and GAPS say what the traces showed, and only that: a count the
 * format has no notion of stays "—", and candidates without a trace are
 * named rather than shown as zero activity.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { agentActivityRows } from "../src/report-model.js";
import { agentActivityGap } from "../src/canon/write.js";
import type { AgentActivity } from "../src/canon/agent-trace.js";
import type { TrialRow } from "../src/canon/rows.js";

function row(candidate: string, input: string, agent: AgentActivity | null, agent_error?: string): TrialRow {
  return {
    run: "r", step: "s", candidate, model_ref: candidate, deployment_ref: null,
    input, trial: 0, trial_hash: `${candidate}-${input}`,
    completion_state: "success", truncated: false, task_outcome: "success", outcome_reasons: [], rule_version: "success-v1",
    checks: {}, judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0, source: "estimated" }, tokens: { prompt: 1, completion: 1, cached: null },
    ms: 1, ttft_ms: null, cache: null, finish_reason: "stop", isolation: "none", error: null,
    legacy_status: "ok", legacy_check_passed: null, reused_from: null,
    agent, ...(agent_error !== undefined ? { agent_error } : {}),
  };
}

const atif = (turns: number, tools: Record<string, number>, ended: AgentActivity["ended"] = null): AgentActivity => ({
  format: "atif", turns, tool_calls: Object.values(tools).reduce((a, b) => a + b, 0), tools, retries: null, denials: null, compactions: null, ended,
});

test("activity rows: p50 over traced trials (nearest rank, as p50_ms), tools ranked, null counts stay null", () => {
  const trials = [
    row("term", "a", atif(7, { bash: 17, done: 2 })),
    row("term", "b", atif(11, { bash: 30, done: 2 }, "killed")),
    row("term", "c", null, ".eval-trace.json unreadable as atif: steps is not an array"),
    row("oracle", "a", null),
  ];
  const [term, ...rest] = agentActivityRows(trials, ["term", "oracle"]);
  assert.deepEqual(rest, [], "a candidate with no trace has no row");
  assert.equal(term.traced, 2);
  assert.equal(term.trials, 3);
  assert.equal(term.unreadable, 1);
  assert.equal(term.turnsP50, 7);
  assert.equal(term.toolCallsP50, 19);
  assert.deepEqual(term.topTools, [["bash", 47], ["done", 4]]);
  assert.equal(term.retries, null);
  assert.equal(term.denials, null);
  assert.deepEqual(term.ended, [["—", 1], ["killed", 1]]);
});

test("activity rows: a count one trace records is summed, not nulled by the others", () => {
  const traced: AgentActivity = { ...atif(3, { read: 1 }), retries: 2, denials: 0 };
  const [r] = agentActivityRows([row("c", "a", traced), row("c", "b", atif(2, { read: 1 }))], ["c"]);
  assert.equal(r.retries, 2);
  assert.equal(r.denials, 0);
});

test("GAPS names who was traced, who was not, and what could not be read", () => {
  assert.match(agentActivityGap([row("a", "x", null)]), /not observed; no candidate declared `cli.trace`/);
  assert.match(agentActivityGap([row("a", "x", null)], ["a"]), /a declare `cli.trace` but no trial left a trace/);
  assert.match(agentActivityGap([row("a", "x", atif(1, {}))]), /observed for every trial/);
  const partial = agentActivityGap([row("a", "x", atif(1, {})), row("b", "x", null), row("a", "y", null, "unreadable")]);
  assert.match(partial, /observed for a \(not b, a: no `cli.trace`, or none left\)/);
  assert.match(partial, /1 trace\(s\) were left but could not be read/);
});
