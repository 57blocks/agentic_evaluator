/**
 * Canonical (protocol v0.4) vocabulary shared by the canon layer.
 *
 * Two axes, never collapsed:
 *   - what happened to the CANDIDATE's attempt  → CompletionState / TaskOutcome
 *   - what happened to the EVALUATOR             → EvaluationState
 * An evaluator error must never be recorded as a candidate failure.
 */

/** Protocol §5 candidate-adapter completion states. */
export type CompletionState =
  | "success"
  | "refusal"
  | "timeout"
  | "malformed"
  | "cancelled"
  | "provider_error";

/** Protocol §3 trial outcome, decided from declared success criteria. */
export type TaskOutcome = "success" | "failure" | "undetermined";

/** Protocol §5 evaluator result state. */
export type EvaluationState = "pass" | "fail" | "not_evaluated" | "evaluator_error";

/** Where a cost figure came from. Estimated costs must never be mixed silently. */
export type CostSource = "provider-reported" | "estimated" | "none";

export interface GenerationSettings {
  temperature?: number;
  max_tokens?: number;
}

/** One testable option: model + route + settings. `id` is what records store. */
export interface CandidateDef {
  id: string;
  model: string;
  provider_route?: string;
  generation_settings?: GenerationSettings;
}

export interface SuccessCriteria {
  mandatory_checks: "all";
}

/** One evaluator's verdict on one trial (or one pair, for comparative evaluators). */
export interface EvaluationResult {
  /** Evaluator id, e.g. "tsc-noemit", "pairwise-swap", "absolute-1-5". */
  evaluator: string;
  /** Implementation version, e.g. "tsc-6.0.2+scaffold-a1f3b2c4". */
  version: string;
  state: EvaluationState;
  score?: number;
  /** Short evidence excerpt (compiler output, judge reason). */
  evidence?: string;
  /** Why the state is not pass/fail. */
  reason?: string;
}

export interface SuccessDecision {
  outcome: TaskOutcome;
  reasons: string[];
  ruleVersion: "success-v1";
}

/** Usage and cost for one LLM call (or the sum over retries). */
export interface CallUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  costUsd: number;
  costSource: CostSource;
  ms: number;
}
