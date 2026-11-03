/**
 * Where a check's `trace:` rules meet a trial: after the check itself has
 * graded the deliverable, the rules grade the path — for the candidates
 * they apply to.
 *
 * Three cases (protocol §5: undetermined is never the candidate's failure):
 *   - the candidate declared no `cli.trace` (a model, or a command that
 *     leaves none): the rules do not apply; the check's verdict stands and
 *     the evidence says so;
 *   - it declared one and the trace was read: a failed rule fails a passing
 *     check, and its evidence names the rule; a check that already failed
 *     stays failed;
 *   - it declared one and no trace arrived (or it could not be read): a
 *     passing check becomes `not_evaluated` — a promised trace that is
 *     missing leaves the path unjudged, not failed.
 *
 * The rules are part of the check's version either way, so editing them is
 * a changed check: regraded on `--reuse`, visible in the manifest.
 */

import type { AgentTrace } from "../canon/agent-trace.js";
import { evaluateTraceRules, hasTraceRules, type TraceRules } from "../canon/trace-rules.js";
import type { EvaluationState } from "../canon/types.js";
import { withTraceRules } from "../check.js";

/** What a check produced, as generate.ts records it on the trial. */
export interface GradedCheck {
  state: EvaluationState;
  passed: boolean;
  output: string;
  version: string;
  reason?: string;
}

export interface TraceSubject {
  /** The candidate declared `cli.trace`. */
  declaredTrace: boolean;
  trace?: AgentTrace;
  /** Why a declared trace could not be read, when it could not. */
  traceError?: string;
}

const join = (evidence: string, note: string): string => (evidence ? `${evidence}; ${note}` : note);

export function applyTraceRules(graded: GradedCheck, rules: TraceRules | undefined, who: TraceSubject): GradedCheck {
  if (!hasTraceRules(rules)) return graded;
  const version = withTraceRules(graded.version, rules);
  if (!who.declaredTrace) {
    return { ...graded, version, output: join(graded.output, "trace rules not applied (no cli.trace)") };
  }
  if (!who.trace) {
    const why = who.traceError ?? "the command left no trace";
    if (graded.state !== "pass") return { ...graded, version, output: join(graded.output, `trace rules not applied: ${why}`) };
    return { ...graded, version, state: "not_evaluated", passed: false, output: join(graded.output, `trace rules not applied: ${why}`), reason: `trace rules could not be applied: ${why}` };
  }
  const r = evaluateTraceRules(rules, who.trace);
  const output = join(graded.output, `trace: ${r.evidence}`);
  if (graded.state !== "pass" || r.verdict === "pass") return { ...graded, version, output };
  const reason = r.verdict === "fail" ? `trace rule: ${r.evidence}` : `trace rule not judgeable: ${r.evidence}`;
  return { ...graded, version, state: r.verdict, passed: false, output, reason };
}
