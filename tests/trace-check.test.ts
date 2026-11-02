/** A check's `trace:` rules applied to a trial: who they apply to, and what they do to the verdict. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTraceRules, type GradedCheck } from "../src/core/trace-check.js";
import type { AgentTrace } from "../src/canon/agent-trace.js";
import type { TraceRules } from "../src/canon/trace-rules.js";

const PASS: GradedCheck = { state: "pass", passed: true, output: "12/12 tests green", version: "cmd-abc+files-def" };
const FAIL: GradedCheck = { state: "fail", passed: false, output: "3 tests red", version: "cmd-abc+files-def", reason: "tests failed" };
const RULES: TraceRules = { tool_used: [{ name: "Bash", min: 1 }] };

const TRACE: AgentTrace = {
  format: "claude-code", turns: 2, tool_calls: [{ name: "Edit", ms: 1, failed: false }], retries: 0, denials: 0,
  compactions: null, turn_tokens: null, models: ["m"], cost_usd: null, ended: "finished",
};

test("no rules: the check's verdict and version are untouched", () => {
  assert.deepEqual(applyTraceRules(PASS, undefined, { declaredTrace: true, trace: TRACE }), PASS);
  assert.deepEqual(applyTraceRules(PASS, {}, { declaredTrace: true, trace: TRACE }), PASS);
});

test("a candidate without cli.trace is graded on the deliverable alone, and the evidence says so", () => {
  const r = applyTraceRules(PASS, RULES, { declaredTrace: false });
  assert.equal(r.state, "pass");
  assert.equal(r.output, "12/12 tests green; trace rules not applied (no cli.trace)");
  assert.match(r.version, /^cmd-abc\+files-def\+trace-[0-9a-f]{8}$/, "the rules are still part of the check's version");
});

test("a failed rule fails a passing check and names itself", () => {
  const r = applyTraceRules(PASS, RULES, { declaredTrace: true, trace: TRACE });
  assert.equal(r.state, "fail");
  assert.equal(r.passed, false);
  assert.equal(r.reason, "trace rule: Bash called 0 times, min 1");
  assert.equal(r.output, "12/12 tests green; trace: Bash called 0 times, min 1");
});

test("a passing rule leaves a pass, with what it saw in the evidence", () => {
  const r = applyTraceRules(PASS, { tool_used: [{ name: "Edit", min: 1 }] }, { declaredTrace: true, trace: TRACE });
  assert.equal(r.state, "pass");
  assert.equal(r.output, "12/12 tests green; trace: Edit called 1 time (min 1)");
});

test("a check that already failed stays failed, whatever the rules say", () => {
  const r = applyTraceRules(FAIL, { tool_used: [{ name: "Edit", min: 1 }] }, { declaredTrace: true, trace: TRACE });
  assert.equal(r.state, "fail");
  assert.equal(r.reason, "tests failed");
  assert.equal(r.output, "3 tests red; trace: Edit called 1 time (min 1)");
});

test("a declared trace that never arrived leaves a passing check undetermined, not failed", () => {
  const r = applyTraceRules(PASS, RULES, { declaredTrace: true, traceError: "no .eval-trace.jsonl in the work dir" });
  assert.equal(r.state, "not_evaluated");
  assert.equal(r.passed, false);
  assert.equal(r.reason, "trace rules could not be applied: no .eval-trace.jsonl in the work dir");

  const failed = applyTraceRules(FAIL, RULES, { declaredTrace: true });
  assert.equal(failed.state, "fail", "a failed check needs no trace to stay failed");
});

test("a rule the format cannot answer leaves a passing check undetermined", () => {
  const atif: AgentTrace = { ...TRACE, format: "atif", tool_calls: [{ name: "bash_command", ms: null, failed: null }] };
  const r = applyTraceRules(PASS, { max_repeated_failures: 2 }, { declaredTrace: true, trace: atif });
  assert.equal(r.state, "not_evaluated");
  assert.match(r.reason ?? "", /not judgeable: atif trace records no verdict/);
});
