/**
 * Evaluator call accounting — every judge / scorer attempt costs money, including
 * the ones whose JSON failed to parse and the ones that timed out after billing.
 * The protocol's cost ledger needs them itemized (judging, scoring, retries).
 */

import type { LlmUsage } from "../llm.js";
import type { CostSource } from "./types.js";

export interface AttemptUsage extends LlmUsage {
  ms: number;
  /** True for the attempt whose output was accepted. */
  final: boolean;
}

export interface EvaluatorUsage {
  calls: number;
  /** Cost of accepted attempts. */
  costUsd: number;
  /** Cost of attempts that were retried or abandoned. */
  retryCostUsd: number;
  costSource: CostSource;
  ms: number;
}

export function mergeCostSource(sources: readonly CostSource[]): CostSource {
  if (sources.length === 0) return "none";
  if (sources.some((s) => s === "estimated")) return "estimated";
  if (sources.every((s) => s === "none")) return "none";
  return "provider-reported";
}

export function summarizeAttempts(attempts: readonly AttemptUsage[]): EvaluatorUsage {
  const sum = (pick: (a: AttemptUsage) => number): number =>
    attempts.reduce((acc, a) => acc + pick(a), 0);
  return {
    calls: attempts.length,
    costUsd: sum((a) => (a.final ? a.costUsd : 0)),
    retryCostUsd: sum((a) => (a.final ? 0 : a.costUsd)),
    costSource: mergeCostSource(attempts.map((a) => a.costSource)),
    ms: sum((a) => a.ms),
  };
}

/** Build one attempt record from a successful or failed LLM call. */
export function attemptFrom(
  usage: LlmUsage | undefined,
  ms: number,
  final: boolean,
): AttemptUsage {
  return {
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    cachedTokens: usage?.cachedTokens,
    costUsd: usage?.costUsd ?? 0,
    costSource: usage?.costSource ?? "none",
    ms,
    final,
  };
}

/**
 * Thrown by judge / scorer when every attempt failed. Carries the attempts so the
 * caller can still charge their cost and record an `evaluator_error` result.
 */
export class EvaluatorCallError extends Error {
  readonly attempts: readonly AttemptUsage[];
  readonly cause: unknown;

  constructor(message: string, attempts: readonly AttemptUsage[], cause: unknown) {
    super(message);
    this.name = "EvaluatorCallError";
    this.attempts = attempts;
    this.cause = cause;
  }
}
