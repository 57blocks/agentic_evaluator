/**
 * Canonical record shapes written to a run directory (protocol §12).
 *
 *   scores.jsonl       one TrialRow per (candidate, input, trial)
 *   evaluations.jsonl  one EvaluationRow per evaluator invocation
 *
 * Fields the protocol wants but this harness cannot observe are present and
 * `null` — never defaulted to a number that looks measured.
 */

import type { Winner } from "../types.js";
import type {
  CompletionState,
  CostSource,
  EvaluationState,
  TaskOutcome,
} from "./types.js";

export interface CheckCell {
  state: EvaluationState;
  version: string;
  evidence?: string;
  reason?: string;
}

export interface TrialRow {
  run: string;
  step: string;
  candidate: string;
  model_ref: string;
  /** "openrouter/anthropic" when the provider was observed; null otherwise. */
  deployment_ref: string | null;
  input: string;
  trial: number;
  trial_hash: string;
  completion_state: CompletionState;
  truncated: boolean;
  task_outcome: TaskOutcome;
  outcome_reasons: string[];
  rule_version: string;
  /** Required-check results keyed by evaluator id. */
  checks: Record<string, CheckCell>;
  judge: {
    /** Resolved pairwise verdicts this trial's output took part in (first-ok output only). */
    pairwise: Array<{ vs: string; resolved: "win" | "loss" | "tie" }> | null;
    absolute_overall: number | null;
    absolute_dimensions: Record<string, number> | null;
  };
  cost: { generation: number; source: CostSource };
  tokens: { prompt: number; completion: number; cached: number | null };
  ms: number;
  ttft_ms: null;
  cache: null;
  finish_reason: string | null;
  error: string | null;
  /** Legacy fields kept so the parity test can rebuild the old aggregate. */
  legacy_status: "ok" | "error";
  legacy_check_passed: boolean | null;
  reused_from: string | null;
}

export type EvaluationSubject =
  | { kind: "trial"; candidate: string; input: string; trial: number }
  | { kind: "pair"; a: string; b: string; input: string };

export interface EvaluationRow {
  run: string;
  step: string;
  evaluator: string;
  version: string;
  state: EvaluationState;
  subject: EvaluationSubject;
  score?: number;
  /** Pairwise: per-dimension resolved winner; absolute: per-dimension 1–5. */
  dimensions?: Record<string, Winner | number>;
  overall?: Winner | number;
  evidence?: string;
  reason?: string;
  cost?: { usd: number; retry_usd: number; source: CostSource; calls: number };
  ms?: number;
}
