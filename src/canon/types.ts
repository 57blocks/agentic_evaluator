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

/** One testable option: model + route + settings, or a CLI agent. */
export type CandidateAdapterId = "model-api" | "codegen" | "agent-cli";

export interface AgentCliConfig {
  argv: string[];
  /**
   * Environment for the command. In a container only these keys cross the
   * boundary, and an empty value means "take it from the host" — so a spec
   * names every secret the candidate is trusted with, in writing.
   */
  env?: Record<string, string>;
  /**
   * Container image to run the command in. Declared, the candidate runs
   * under `docker run` with only the work dir mounted; omitted, it runs as
   * this process, with this process's user and its whole filesystem.
   *
   * Which one happened is recorded on every trial rather than assumed:
   * running an unreviewed agent on the host is a choice a reader of the
   * evidence is entitled to see.
   */
  image?: string;
  /** Container network. Defaults to "none"; an agent that calls an API needs "bridge". */
  network?: "none" | "bridge";
  /** Memory ceiling, e.g. "2g". Defaults to 2g. */
  memory?: string;
  /** CPU ceiling, e.g. "2". Defaults to 2. */
  cpus?: string;
}

/** How a candidate's command was executed — recorded, never inferred. */
export type Isolation = "docker" | "none";

export interface CandidateDef {
  id: string;
  /** Defaults from the spec producer: codegen → "codegen", else "model-api". */
  adapter?: CandidateAdapterId;
  model?: string;
  provider_route?: string;
  generation_settings?: GenerationSettings;
  cli?: AgentCliConfig;
}

export interface SuccessCriteria {
  mandatory_checks: "all";
}

/**
 * Operating mode (protocol §4). Applied only after eligibility filters.
 *
 * `judge-preference` is outside the protocol's three: it ranks on a judge
 * model's verdicts for steps that have no deterministic check. It can never
 * yield a firm recommendation, and the reason string always says so.
 */
export type OperatingMode =
  | "lowest-cost"
  | "fastest-within-cost-ceiling"
  | "highest-assurance"
  | "judge-preference";

/**
 * Declared aggregate gates (protocol §3 candidate eligibility).
 * `null` means the rule is not applied. Omitted spec fields are resolved to
 * defaults by `resolveEligibility` before they are frozen into the manifest.
 */
export interface EligibilityThresholds {
  minimum_reliability: number | null;
  minimum_required_check_pass_rate: number | null;
  maximum_p95_ms: number | null;
  cost_ceiling_per_success_usd: number | null;
}

/** Spec-side subset; missing keys take protocol defaults at freeze time. */
export type EligibilityDecl = {
  [K in keyof EligibilityThresholds]?: number;
};

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
