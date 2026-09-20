/**
 * End-to-end workflow contracts (protocol §8).
 *
 * Independent per-step evaluation stays as-is. This module answers the two
 * questions §8 asks after selection:
 *   - control:    one candidate runs the chained steps from beginning to end;
 *   - validation: does the proposed per-step assignment beat that control by
 *                 at least the predeclared minimum meaningful difference?
 *
 * Pure. Never calls a model; re-running on the same arms is idempotent.
 */

import { FIRM_MIN_INPUTS, percentile, rate, type Rate } from "./rates.js";
import type { EvaluationResult, EvaluationState, OperatingMode, TaskOutcome } from "./types.js";

export const VALIDATE_RULE_VERSION = "e2e-validate-v1" as const;

/**
 * §8 step 3 also asks for every single-configuration workflow and the current
 * production workflow. This implementation runs the proposed combination and
 * the declared single-model control only; the rest are named, never implied.
 */
export const ARMS_NOT_RUN: readonly string[] = [
  "single-configuration workflows other than the declared control",
  "the current production workflow",
];

export interface ChainStep {
  id: string;
  inputFrom?: string;
}

/** Linear chain following `input_from`, or null when the spec has no handoff. */
export function orderControlChain(steps: readonly ChainStep[]): string[] | null {
  const childOf = new Map<string, string>();
  for (const s of steps) {
    if (!s.inputFrom) continue;
    if (childOf.has(s.inputFrom)) return null;
    childOf.set(s.inputFrom, s.id);
  }
  if (childOf.size === 0) return null;

  const isChild = new Set(childOf.values());
  const roots = steps.filter((s) => childOf.has(s.id) && !isChild.has(s.id));
  if (roots.length !== 1) return null;

  const ordered = [roots[0].id];
  let cur = roots[0].id;
  while (childOf.has(cur)) {
    cur = childOf.get(cur)!;
    ordered.push(cur);
    if (ordered.length > steps.length) return null;
  }

  const onPath = new Set(ordered);
  for (const s of steps) {
    if (s.inputFrom && (!onPath.has(s.id) || !onPath.has(s.inputFrom))) return null;
  }
  return ordered;
}

/** Workflow outcome: any step failure fails the case; any undetermined stays undetermined. */
export function decideE2eOutcome(outcomes: readonly TaskOutcome[]): TaskOutcome {
  if (outcomes.length === 0) return "undetermined";
  if (outcomes.some((o) => o === "failure")) return "failure";
  if (outcomes.some((o) => o === "undetermined")) return "undetermined";
  return "success";
}

export interface E2eStepResult {
  id: string;
  /** The candidate that ran this step in this arm. */
  candidate: string;
  completion_state: import("./types.js").CompletionState;
  task_outcome: TaskOutcome;
  outcome_reasons: string[];
  cost_usd: number;
  ms: number;
  input_sha: string;
  output_sha: string;
  checks: EvaluationResult[];
}

export interface E2eCase {
  input: string;
  trial: number;
  steps: E2eStepResult[];
  outcome: TaskOutcome;
  aborted: boolean;
}

/** One workflow-level assignment measured over the same cases as every other arm. */
export interface ArmRates {
  cases: number;
  success: number;
  failure: number;
  undetermined: number;
  task_success_rate: Rate;
  reliability: Rate;
  required_check_pass_rate: Rate;
  total_cost_usd: number;
  /** Whole-workflow cost divided by successful workflows; null when none succeeded. */
  cost_per_success: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
}

export function armRates(cases: readonly E2eCase[]): ArmRates {
  const success = cases.filter((c) => c.outcome === "success").length;
  const failure = cases.filter((c) => c.outcome === "failure").length;
  const undetermined = cases.length - success - failure;

  const checks = cases.flatMap((c) => c.steps.flatMap((s) => s.checks));
  const counted = (state: EvaluationState): number =>
    checks.filter((c) => c.state === state).length;

  const totalCost = cases.reduce((sum, c) => sum + c.steps.reduce((s, x) => s + x.cost_usd, 0), 0);
  const durations = cases
    .map((c) => c.steps.reduce((s, x) => s + x.ms, 0))
    .sort((a, b) => a - b);

  return {
    cases: cases.length,
    success,
    failure,
    undetermined,
    task_success_rate: rate(success, success + failure),
    reliability: rate(success, cases.length),
    required_check_pass_rate: rate(counted("pass"), counted("pass") + counted("fail")),
    total_cost_usd: totalCost,
    cost_per_success: success > 0 ? totalCost / success : null,
    p50_ms: percentile(durations, 0.5),
    p95_ms: percentile(durations, 0.95),
  };
}

export type StepAssignment = Record<string, string>;

/**
 * The combination §8 step 2 proposes: each chained step's chosen candidate.
 * A step with no chosen candidate blocks validation instead of being guessed.
 */
export function proposedAssignment(
  chain: readonly string[],
  chosenByStep: Readonly<Record<string, string | null>>,
): { assignment: StepAssignment } | { reason: string } {
  const assignment: StepAssignment = {};
  for (const id of chain) {
    const chosen = chosenByStep[id] ?? null;
    if (chosen === null) {
      return { reason: `step ${id} has no chosen candidate, so no combination can be validated` };
    }
    assignment[id] = chosen;
  }
  return { assignment };
}

export function sameAssignment(a: StepAssignment, b: StepAssignment): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

export interface ValidationArm {
  arm_id: string;
  kind: "proposed" | "control";
  assignment: StepAssignment;
  cases: number;
  rates: ArmRates;
}

export interface PairedCounts {
  compared: number;
  both_success: number;
  proposed_only: number;
  control_only: number;
  neither: number;
}

/** Same input and trial index in both arms; unmatched cases are not compared. */
export function pairCases(
  proposed: readonly E2eCase[],
  control: readonly E2eCase[],
): PairedCounts {
  const key = (c: E2eCase): string => `${c.input}#${c.trial}`;
  const byKey = new Map(control.map((c) => [key(c), c]));
  const counts: PairedCounts = {
    compared: 0,
    both_success: 0,
    proposed_only: 0,
    control_only: 0,
    neither: 0,
  };
  for (const p of proposed) {
    const c = byKey.get(key(p));
    if (!c) continue;
    counts.compared += 1;
    const pOk = p.outcome === "success";
    const cOk = c.outcome === "success";
    if (pOk && cOk) counts.both_success += 1;
    else if (pOk) counts.proposed_only += 1;
    else if (cOk) counts.control_only += 1;
    else counts.neither += 1;
  }
  return counts;
}

export interface ValidationThresholds {
  minimum_reliability: number | null;
  minimum_required_check_pass_rate: number | null;
}

export type ValidationVerdict = "adopt-combination" | "keep-control" | "not-validated";
export type ValidationFirmness = "firm" | "directional" | "needs-review";

export interface ValidationDeltas {
  metric: "cost_per_success" | "p50_ms" | "reliability";
  proposed: number | null;
  control: number | null;
  /** Positive means the combination is better on this metric. */
  improvement: number | null;
  mmd: number | null;
  paired: PairedCounts | null;
}

export interface E2eValidation {
  rule_version: typeof VALIDATE_RULE_VERSION;
  verdict: ValidationVerdict;
  firmness: ValidationFirmness;
  operating_mode: string | null;
  thresholds: ValidationThresholds;
  assignment: StepAssignment | null;
  control_assignment: StepAssignment | null;
  deltas: ValidationDeltas | null;
  /** Comparisons the protocol asks for that this run did not execute. */
  not_compared: readonly string[];
  reasons: string[];
}

export interface DecideValidationInput {
  mode: OperatingMode | string | null;
  mmd: number | null;
  thresholds: ValidationThresholds;
  /** Root test-set size; fewer than ten inputs can only support a directional claim. */
  inputs: number;
  control: ValidationArm | null;
  proposed: ValidationArm | null;
  pairs?: PairedCounts;
  /** The proposed arm was not run because it is the control (verdict: keep-control). */
  blockedReason?: string;
  /** No combination could be formed or compared (verdict: not-validated). */
  notValidatedReason?: string;
}

const MODES: readonly OperatingMode[] = [
  "lowest-cost",
  "fastest-within-cost-ceiling",
  "highest-assurance",
];

function asMode(raw: string | null): OperatingMode | null {
  return MODES.find((m) => m === raw) ?? null;
}

function gateFailures(rates: ArmRates, t: ValidationThresholds): string[] {
  const out: string[] = [];
  if (t.minimum_reliability !== null) {
    const v = rates.reliability.value;
    if (v === null || v < t.minimum_reliability) {
      out.push(`reliability ${v ?? "undefined"} < ${t.minimum_reliability}`);
    }
  }
  if (t.minimum_required_check_pass_rate !== null) {
    const v = rates.required_check_pass_rate.value;
    if (v === null || v < t.minimum_required_check_pass_rate) {
      out.push(`required-check pass rate ${v ?? "undefined"} < ${t.minimum_required_check_pass_rate}`);
    }
  }
  return out;
}

function metricFor(mode: OperatingMode): ValidationDeltas["metric"] {
  if (mode === "lowest-cost") return "cost_per_success";
  if (mode === "fastest-within-cost-ceiling") return "p50_ms";
  return "reliability";
}

function readMetric(rates: ArmRates, metric: ValidationDeltas["metric"]): number | null {
  if (metric === "cost_per_success") return rates.cost_per_success;
  if (metric === "p50_ms") return rates.p50_ms;
  return rates.reliability.value;
}

function shell(input: DecideValidationInput, mode: OperatingMode | null): Omit<E2eValidation, "verdict" | "firmness" | "deltas" | "reasons"> {
  return {
    rule_version: VALIDATE_RULE_VERSION,
    not_compared: ARMS_NOT_RUN,
    operating_mode: mode ?? (typeof input.mode === "string" ? input.mode : null),
    thresholds: input.thresholds,
    assignment: input.proposed?.assignment ?? null,
    control_assignment: input.control?.assignment ?? null,
  };
}

/**
 * Protocol §8: a combination is superior only when the end-to-end evidence
 * shows an improvement at least as large as the predeclared minimum meaningful
 * difference. Anything weaker keeps the control.
 */
export function decideValidation(input: DecideValidationInput): E2eValidation {
  const mode = asMode(typeof input.mode === "string" ? input.mode : null);
  const base = shell(input, mode);
  const stop = (
    verdict: ValidationVerdict,
    firmness: ValidationFirmness,
    reason: string,
    deltas: ValidationDeltas | null = null,
  ): E2eValidation => ({ ...base, verdict, firmness, deltas, reasons: [reason] });

  if (input.notValidatedReason) return stop("not-validated", "needs-review", input.notValidatedReason);
  if (input.blockedReason) return stop("keep-control", "directional", input.blockedReason);
  if (!input.control) return stop("not-validated", "needs-review", "no single-model control arm was run");
  if (!input.proposed) return stop("not-validated", "needs-review", "no proposed combination arm was run");
  if (!mode) {
    return stop(
      "not-validated",
      "needs-review",
      input.mode ? `unknown operating_mode "${input.mode}"` : "no operating_mode declared for the chained steps",
    );
  }

  const reasons: string[] = [];
  const proposedFails = gateFailures(input.proposed.rates, input.thresholds);
  const controlFails = gateFailures(input.control.rates, input.thresholds);

  const metric = metricFor(mode);
  const p = readMetric(input.proposed.rates, metric);
  const c = readMetric(input.control.rates, metric);
  const improvement =
    p === null || c === null ? null : metric === "reliability" ? p - c : c - p;
  const paired = input.pairs ?? null;
  const deltas: ValidationDeltas = { metric, proposed: p, control: c, improvement, mmd: input.mmd, paired };

  const directional = input.inputs < FIRM_MIN_INPUTS || input.mmd === null;
  const firmness: ValidationFirmness = directional ? "directional" : "firm";

  if (proposedFails.length > 0 && controlFails.length > 0) {
    reasons.push(`neither arm passes the workflow eligibility gates (proposed: ${proposedFails.join("; ")}; control: ${controlFails.join("; ")})`);
    return { ...base, verdict: "not-validated", firmness: "needs-review", deltas, reasons };
  }
  if (proposedFails.length > 0) {
    reasons.push(`the proposed combination fails the workflow eligibility gates: ${proposedFails.join("; ")}`);
    return { ...base, verdict: "keep-control", firmness, deltas, reasons };
  }
  if (controlFails.length > 0) {
    reasons.push(`the single-model control fails the workflow eligibility gates (${controlFails.join("; ")}) while the proposed combination passes them`);
    return { ...base, verdict: "adopt-combination", firmness, deltas, reasons };
  }

  if (improvement === null) {
    reasons.push(`${metric} is undefined for the proposed combination or the control`);
    return { ...base, verdict: "not-validated", firmness: "needs-review", deltas, reasons };
  }

  if (metric === "reliability") {
    // Mirrors select.ts: highest-assurance ranks on reliability and does not apply the MMD.
    if (improvement > 0) {
      reasons.push(`the combination reaches reliability ${p} versus ${c} for the control`);
      return { ...base, verdict: "adopt-combination", firmness, deltas, reasons };
    }
    reasons.push(`the combination does not exceed the control on reliability (${p} versus ${c})`);
    return { ...base, verdict: "keep-control", firmness, deltas, reasons };
  }

  if (input.mmd === null) {
    reasons.push(
      `the combination ${improvement > 0 ? "improves" : "does not improve"} ${metric} by ${improvement}, but no minimum meaningful difference was predeclared, so superiority cannot be concluded`,
    );
    return { ...base, verdict: "keep-control", firmness: "directional", deltas, reasons };
  }
  if (improvement < input.mmd) {
    reasons.push(
      `the improvement in ${metric} versus the control is ${improvement}, below the declared minimum meaningful difference ${input.mmd}`,
    );
    return { ...base, verdict: "keep-control", firmness, deltas, reasons };
  }
  reasons.push(
    `the combination improves ${metric} by ${improvement} versus the control, at or above the declared minimum meaningful difference ${input.mmd}`,
  );
  return { ...base, verdict: "adopt-combination", firmness, deltas, reasons };
}
