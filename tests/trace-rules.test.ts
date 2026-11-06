/**
 * Declarative rules over a command candidate's trace (`trace:` on a required
 * check): each rule, each outcome, and the field a format does not record.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTraceRules, evaluateTraceRules, type TraceRules } from "../src/canon/trace-rules.js";
import type { AgentTrace, ToolCallRecord } from "../src/canon/agent-trace.js";

const call = (name: string, failed: boolean | null = false): ToolCallRecord => ({ name, ms: 10, failed });

function trace(tool_calls: ToolCallRecord[], over: Partial<AgentTrace> = {}): AgentTrace {
  return {
    format: "claude-code",
    turns: 4,
    tool_calls,
    retries: 0,
    denials: 0,
    compactions: null,
    turn_tokens: null,
    models: ["m"],
    cost_usd: null,
    ended: "finished",
    ...over,
  };
}

const EDIT_THEN_TEST = trace([call("Read"), call("Edit"), call("Bash"), call("Bash")]);

test("tool_used: a tool must be called at least min and at most max times", () => {
  const ok = evaluateTraceRules({ tool_used: [{ name: "Bash", min: 1 }] }, EDIT_THEN_TEST);
  assert.equal(ok.verdict, "pass");
  assert.match(ok.evidence, /Bash called 2/);

  const none = evaluateTraceRules({ tool_used: [{ name: "WebFetch", min: 1 }] }, EDIT_THEN_TEST);
  assert.equal(none.verdict, "fail");
  assert.equal(none.evidence, "WebFetch called 0 times, min 1");

  const forbidden = evaluateTraceRules({ tool_used: [{ name: "Edit", max: 0 }] }, EDIT_THEN_TEST);
  assert.equal(forbidden.verdict, "fail");
  assert.equal(forbidden.evidence, "Edit called 1 time, max 0");
});

test("tool_order: the first call of one tool precedes the first call of another", () => {
  assert.equal(evaluateTraceRules({ tool_order: [{ first: "Edit", then: "Bash" }] }, EDIT_THEN_TEST).verdict, "pass");

  const wrong = evaluateTraceRules({ tool_order: [{ first: "Bash", then: "Edit" }] }, EDIT_THEN_TEST);
  assert.equal(wrong.verdict, "fail");
  assert.equal(wrong.evidence, "Bash first called after Edit (call 3 vs 2), required before");

  const never = evaluateTraceRules({ tool_order: [{ first: "Edit", then: "Test" }] }, EDIT_THEN_TEST);
  assert.equal(never.verdict, "fail");
  assert.equal(never.evidence, "Test never called, required after Edit");
});

test("max_tool_calls and max_turns bound the agent's effort", () => {
  assert.equal(evaluateTraceRules({ max_tool_calls: 4, max_turns: 4 }, EDIT_THEN_TEST).verdict, "pass");

  const calls = evaluateTraceRules({ max_tool_calls: 3 }, EDIT_THEN_TEST);
  assert.equal(calls.verdict, "fail");
  assert.equal(calls.evidence, "4 tool calls, max 3");

  const turns = evaluateTraceRules({ max_turns: 2 }, EDIT_THEN_TEST);
  assert.equal(turns.verdict, "fail");
  assert.equal(turns.evidence, "4 turns, max 2");
});

test("max_repeated_failures: the same tool failing in a row, counted only where the format records failures", () => {
  const looping = trace([call("Bash", true), call("Bash", true), call("Bash", true), call("Edit")]);
  assert.equal(evaluateTraceRules({ max_repeated_failures: 3 }, looping).verdict, "pass");

  const over = evaluateTraceRules({ max_repeated_failures: 2 }, looping);
  assert.equal(over.verdict, "fail");
  assert.equal(over.evidence, "Bash failed 3 times in a row, max 2");

  // ATIF records observations but no verdict on them: the rule cannot be judged.
  const atif = trace([call("bash_command", null), call("bash_command", null)], { format: "atif" });
  const unknowable = evaluateTraceRules({ max_repeated_failures: 2 }, atif);
  assert.equal(unknowable.verdict, "not_evaluated");
  assert.match(unknowable.evidence, /atif .*records no verdict/);
});

test("every rule is checked and every failure named; a pass says what was seen", () => {
  const r = evaluateTraceRules(
    { tool_used: [{ name: "Bash", min: 1 }, { name: "WebFetch", max: 0 }], tool_order: [{ first: "Edit", then: "Bash" }], max_tool_calls: 10 },
    EDIT_THEN_TEST,
  );
  assert.equal(r.verdict, "pass");
  assert.equal(r.evidence, "Bash called 2 times (min 1); WebFetch called 0 times (max 0); Edit (call 2) before Bash (call 3); 4 tool calls (max 10)");

  const two = evaluateTraceRules({ tool_used: [{ name: "WebFetch", min: 1 }], max_turns: 1 }, EDIT_THEN_TEST);
  assert.equal(two.verdict, "fail");
  assert.equal(two.evidence, "WebFetch called 0 times, min 1; 4 turns, max 1");
});

test("the rules describe themselves for the plan and the report", () => {
  const rules: TraceRules = { tool_used: [{ name: "Bash", min: 1 }, { name: "Edit", max: 0 }], tool_order: [{ first: "Edit", then: "Bash" }], max_tool_calls: 60, max_turns: 40, max_repeated_failures: 3 };
  assert.equal(
    describeTraceRules(rules),
    "trace: Bash called ≥1; Edit called ≤0; Edit before Bash; ≤60 tool calls; ≤40 turns; no tool failing >3 times in a row",
  );
});
