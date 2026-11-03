/**
 * Declarative rules over the trace a command candidate left: `trace:` on a
 * required check. They grade the path where the check grades the result —
 * that the tests were actually run, that no tool off limits was used, that
 * the agent did not loop on one failing call — without a script.
 *
 * Pure: a rule set and a canonical trace in, a verdict and one line of
 * evidence out. Who the rules apply to (a candidate that declared
 * `cli.trace`) is decided by the caller, which also knows when a promised
 * trace did not arrive.
 *
 * `not_evaluated` is for a rule the trace cannot answer: ATIF records an
 * observation for each call but no verdict on it, so `failed` is null and a
 * rule about failures has nothing to count.
 */

import type { AgentTrace } from "./agent-trace.js";
import type { EvaluationState } from "./types.js";

export interface TraceRules {
  /** Each tool must be called at least `min` and at most `max` times; `max: 0` forbids it. */
  tool_used?: ReadonlyArray<{ name: string; min?: number; max?: number }>;
  /** The first call of `first` precedes the first call of `then`. */
  tool_order?: ReadonlyArray<{ first: string; then: string }>;
  max_tool_calls?: number;
  max_turns?: number;
  /** No tool fails more than this many times in a row. */
  max_repeated_failures?: number;
}

export type TraceVerdict = Extract<EvaluationState, "pass" | "fail" | "not_evaluated">;

export interface TraceRulesResult {
  verdict: TraceVerdict;
  /** One line: what failed, or what was seen when everything passed. */
  evidence: string;
}

interface RuleOutcome {
  verdict: TraceVerdict;
  text: string;
}

const times = (n: number): string => `${n} time${n === 1 ? "" : "s"}`;

function toolUsed(rule: { name: string; min?: number; max?: number }, trace: AgentTrace): RuleOutcome {
  const n = trace.tool_calls.filter((c) => c.name === rule.name).length;
  if (rule.min !== undefined && n < rule.min) return { verdict: "fail", text: `${rule.name} called ${times(n)}, min ${rule.min}` };
  if (rule.max !== undefined && n > rule.max) return { verdict: "fail", text: `${rule.name} called ${times(n)}, max ${rule.max}` };
  const bound = rule.min !== undefined ? `min ${rule.min}` : `max ${rule.max}`;
  return { verdict: "pass", text: `${rule.name} called ${times(n)} (${bound})` };
}

function toolOrder(rule: { first: string; then: string }, trace: AgentTrace): RuleOutcome {
  const a = trace.tool_calls.findIndex((c) => c.name === rule.first);
  const b = trace.tool_calls.findIndex((c) => c.name === rule.then);
  if (a === -1) return { verdict: "fail", text: `${rule.first} never called, required before ${rule.then}` };
  if (b === -1) return { verdict: "fail", text: `${rule.then} never called, required after ${rule.first}` };
  if (a > b) return { verdict: "fail", text: `${rule.first} first called after ${rule.then} (call ${a + 1} vs ${b + 1}), required before` };
  return { verdict: "pass", text: `${rule.first} (call ${a + 1}) before ${rule.then} (call ${b + 1})` };
}

function maxToolCalls(max: number, trace: AgentTrace): RuleOutcome {
  const n = trace.tool_calls.length;
  return n > max ? { verdict: "fail", text: `${n} tool calls, max ${max}` } : { verdict: "pass", text: `${n} tool calls (max ${max})` };
}

function maxTurns(max: number, trace: AgentTrace): RuleOutcome {
  return trace.turns > max ? { verdict: "fail", text: `${trace.turns} turns, max ${max}` } : { verdict: "pass", text: `${trace.turns} turns (max ${max})` };
}

/** The longest run of consecutive failed calls to one tool, and which tool. */
function longestFailureRun(trace: AgentTrace): { name: string; run: number } {
  return trace.tool_calls.reduce(
    (acc, c, i) => {
      const prev = trace.tool_calls[i - 1];
      const run = c.failed === true ? (prev && prev.name === c.name && prev.failed === true ? acc.current + 1 : 1) : 0;
      const best = run > acc.run ? { name: c.name, run } : { name: acc.name, run: acc.run };
      return { ...best, current: run };
    },
    { name: "", run: 0, current: 0 },
  );
}

function maxRepeatedFailures(max: number, trace: AgentTrace): RuleOutcome {
  if (trace.tool_calls.length > 0 && trace.tool_calls.every((c) => c.failed === null)) {
    return { verdict: "not_evaluated", text: `${trace.format} trace records no verdict on tool calls, so repeated failures cannot be counted` };
  }
  const worst = longestFailureRun(trace);
  if (worst.run > max) return { verdict: "fail", text: `${worst.name} failed ${times(worst.run)} in a row, max ${max}` };
  return { verdict: "pass", text: worst.run === 0 ? `no failed tool call (max ${max} in a row)` : `${worst.name} failed ${times(worst.run)} in a row at most (max ${max})` };
}

function outcomesOf(rules: TraceRules, trace: AgentTrace): RuleOutcome[] {
  return [
    ...(rules.tool_used ?? []).map((r) => toolUsed(r, trace)),
    ...(rules.tool_order ?? []).map((r) => toolOrder(r, trace)),
    ...(rules.max_tool_calls !== undefined ? [maxToolCalls(rules.max_tool_calls, trace)] : []),
    ...(rules.max_turns !== undefined ? [maxTurns(rules.max_turns, trace)] : []),
    ...(rules.max_repeated_failures !== undefined ? [maxRepeatedFailures(rules.max_repeated_failures, trace)] : []),
  ];
}

/**
 * Every rule is judged; the verdict is `fail` if any failed, else
 * `not_evaluated` if any could not be judged, else `pass`. The evidence
 * lists the failures (or the unanswerable rules), or everything seen.
 */
export function evaluateTraceRules(rules: TraceRules, trace: AgentTrace): TraceRulesResult {
  const outcomes = outcomesOf(rules, trace);
  const failed = outcomes.filter((o) => o.verdict === "fail");
  if (failed.length > 0) return { verdict: "fail", evidence: failed.map((o) => o.text).join("; ") };
  const unknown = outcomes.filter((o) => o.verdict === "not_evaluated");
  if (unknown.length > 0) return { verdict: "not_evaluated", evidence: unknown.map((o) => o.text).join("; ") };
  return { verdict: "pass", evidence: outcomes.map((o) => o.text).join("; ") };
}

/** The rules in words, for the plan and the report. */
export function describeTraceRules(rules: TraceRules): string {
  const parts = [
    ...(rules.tool_used ?? []).map((r) => `${r.name} called ${r.min !== undefined ? `≥${r.min}` : ""}${r.min !== undefined && r.max !== undefined ? " " : ""}${r.max !== undefined ? `≤${r.max}` : ""}`),
    ...(rules.tool_order ?? []).map((r) => `${r.first} before ${r.then}`),
    ...(rules.max_tool_calls !== undefined ? [`≤${rules.max_tool_calls} tool calls`] : []),
    ...(rules.max_turns !== undefined ? [`≤${rules.max_turns} turns`] : []),
    ...(rules.max_repeated_failures !== undefined ? [`no tool failing >${rules.max_repeated_failures} times in a row`] : []),
  ];
  return `trace: ${parts.join("; ")}`;
}

/** True when the rule set says anything at all. */
export function hasTraceRules(rules: TraceRules | undefined): rules is TraceRules {
  return rules !== undefined && outcomesOf(rules, { tool_calls: [], turns: 0 } as unknown as AgentTrace).length > 0;
}
