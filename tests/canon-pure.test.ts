import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCompletion } from "../src/canon/states.js";
import { decideTaskOutcome } from "../src/canon/success.js";
import { sha256, trialHash } from "../src/canon/hash.js";
import type { EvaluationResult } from "../src/canon/types.js";

// ── classifyCompletion ────────────────────────────────────────────────────

test("timeout error classifies as timeout", () => {
  const v = classifyCompletion({ error: { kind: "timeout" } });
  assert.equal(v.state, "timeout");
});

test("http 429 and network errors classify as provider_error", () => {
  assert.equal(classifyCompletion({ error: { kind: "http", httpStatus: 429 } }).state, "provider_error");
  assert.equal(classifyCompletion({ error: { kind: "network" } }).state, "provider_error");
});

test("empty completion with content_filter finish reason is a refusal", () => {
  const v = classifyCompletion({ error: { kind: "empty", finishReason: "content_filter" } });
  assert.equal(v.state, "refusal");
});

test("empty completion without refusal signal is malformed", () => {
  assert.equal(classifyCompletion({ error: { kind: "empty" } }).state, "malformed");
});

test("zero parsed files is malformed even though the call succeeded", () => {
  assert.equal(classifyCompletion({ finishReason: "stop", parsedUnits: 0 }).state, "malformed");
});

test("finish_reason length with parseable output is success and truncated", () => {
  const v = classifyCompletion({ finishReason: "length", parsedUnits: 1 });
  assert.equal(v.state, "success");
  assert.equal(v.truncated, true);
});

test("plain stop is success and not truncated", () => {
  const v = classifyCompletion({ finishReason: "stop" });
  assert.equal(v.state, "success");
  assert.equal(v.truncated, false);
});

// ── decideTaskOutcome ─────────────────────────────────────────────────────

const pass: EvaluationResult = { evaluator: "tsc-noemit", version: "v", state: "pass" };
const fail: EvaluationResult = { evaluator: "tsc-noemit", version: "v", state: "fail" };
const evErr: EvaluationResult = { evaluator: "tsc-noemit", version: "v", state: "evaluator_error", reason: "tsc missing" };
const all = { mandatory_checks: "all" as const };

test("all mandatory checks pass → success", () => {
  const d = decideTaskOutcome({ criteria: all, requiredChecks: ["tsc-noemit"], completion: "success", checks: [pass] });
  assert.equal(d.outcome, "success");
  assert.equal(d.ruleVersion, "success-v1");
});

test("a failing mandatory check → failure", () => {
  const d = decideTaskOutcome({ criteria: all, requiredChecks: ["tsc-noemit"], completion: "success", checks: [fail] });
  assert.equal(d.outcome, "failure");
});

test("evaluator error on a mandatory check → undetermined, never failure", () => {
  const d = decideTaskOutcome({ criteria: all, requiredChecks: ["tsc-noemit"], completion: "success", checks: [evErr] });
  assert.equal(d.outcome, "undetermined");
  assert.ok(d.reasons.some((r) => r.includes("evaluator_error")));
});

test("missing check result → undetermined with the check named", () => {
  const d = decideTaskOutcome({ criteria: all, requiredChecks: ["tsc-noemit"], completion: "success", checks: [] });
  assert.equal(d.outcome, "undetermined");
  assert.ok(d.reasons[0].startsWith("tsc-noemit"));
});

test("no required checks declared (prd step) → undetermined with explicit reason", () => {
  const d = decideTaskOutcome({ criteria: undefined, requiredChecks: [], completion: "success", checks: [] });
  assert.equal(d.outcome, "undetermined");
  assert.match(d.reasons[0], /no required checks declared/);
});

test("candidate did not complete → failure regardless of checks", () => {
  const d = decideTaskOutcome({ criteria: all, requiredChecks: ["tsc-noemit"], completion: "timeout", checks: [pass] });
  assert.equal(d.outcome, "failure");
  assert.match(d.reasons[0], /timeout/);
});

// ── hashes ────────────────────────────────────────────────────────────────

test("sha256 is deterministic", () => {
  assert.equal(sha256("abc"), sha256("abc"));
  assert.equal(sha256("abc").length, 64);
});

const base = {
  producer: "codegen",
  producerVersion: "1",
  promptTemplateSha: sha256("preamble"),
  inputSha: sha256("input"),
  model: "anthropic/claude-sonnet-5",
  temperature: 0.2,
  trial: 0,
};

test("trialHash is stable for identical identity", () => {
  assert.equal(trialHash(base), trialHash({ ...base }));
});

test("trialHash changes when the prompt template changes", () => {
  assert.notEqual(trialHash(base), trialHash({ ...base, promptTemplateSha: sha256("preamble v2") }));
});

test("trialHash changes across trials and models", () => {
  assert.notEqual(trialHash(base), trialHash({ ...base, trial: 1 }));
  assert.notEqual(trialHash(base), trialHash({ ...base, model: "deepseek/deepseek-v4-pro" }));
});
