/**
 * Standalone model-eval harness — types.
 *
 * Fully self-contained: imports nothing from `src/`. The pipeline is treated
 * as a black box — we only read frozen upstream inputs (text) and score model
 * outputs.
 */

import type {
  CandidateDef,
  CompletionState,
  CostSource,
  EligibilityDecl,
  EvaluationState,
  SuccessCriteria,
} from "./canon/types.js";

/** Project tier passed to the real doc agents (PM / TRD). */
export type EvalTier = "S" | "M" | "L";

/**
 * How a suite turns an input into a candidate output.
 * - "prompt"  — hand-copied template + thin `llm.ts` client (original MVP mode).
 * - "agent"   — the pipeline's REAL agent (PMAgent / TRDAgent), model swapped
 *               per candidate. Requires `USE_OPENROUTER=1` before importing.
 * - "codegen" — standalone code generation via `llm.ts`, then an objective
 *               `tsc --noEmit` gate on the parsed files (see `check`).
 */
export type ProducerKind = "prompt" | "agent" | "codegen";

/** Objective check config (codegen only). */
export interface CheckConfig {
  /** Repo-relative dir holding a `tsconfig.json` copied into each work dir. */
  scaffoldDir: string;
  /** Reserved override for the check command. Unused today (always tsc). */
  command?: string;
}

/** One eval suite = one pipeline step, several candidates, a few fixed inputs. */
export interface Suite {
  suiteId: string;
  /** Step name, free text (e.g. "prd"). Purely a label. */
  step: string;
  /**
   * How outputs are produced. Defaults to "prompt" for backward compatibility
   * with the original single-file suite (which had no `producer` field).
   */
  producer?: ProducerKind;
  /**
   * Project tier for "agent" producers (PM / TRD). Ignored by other producers.
   */
  tier?: EvalTier;
  /**
   * Path (repo-relative) to the prompt template; `{{input}}` is substituted.
   * Required only for the "prompt" producer — "agent" builds its own prompt and
   * "codegen" uses the input as the task spec, so both leave this unset.
   */
  promptFile?: string;
  /** Path to the judge rubric markdown. */
  rubricFile: string;
  /** OpenRouter model IDs under test. */
  candidates: string[];
  /** Judge model ID — MUST differ in family from the candidates. */
  judge: string;
  /** Input case slugs; each maps to `eval/inputs/<slug>.txt`. */
  inputs: string[];
  /** Repeats per (candidate, input) to average cost/latency. Default 2. */
  trials?: number;
  /** Sampling temperature for candidates. Default 0.3. */
  temperature?: number;
  /** Per-call timeout in ms. Default 120000. Raise for slow reasoning models. */
  timeoutMs?: number;
  /** Objective `tsc` gate config. Present only on the "codegen" producer. */
  check?: CheckConfig;
  /**
   * Rubric dimension keys the judge scores each pair on (one verdict per key,
   * plus an overall). Keys must match the rubric's numbered items. When absent
   * or empty the judge only produces the overall verdict.
   */
  dimensions?: string[];

  // ── Canonical (protocol v0.4) fields, populated by the YAML spec loader. ──
  // All optional so a legacy suites/*.json still loads; `loadLegacySuite`
  // synthesizes `candidateDefs` with id = model.

  /** Candidate definitions keyed by id. `candidates` holds the ids. */
  candidateDefs?: Record<string, CandidateDef>;
  protocolVersion?: string;
  runName?: string;
  budgetUsd?: number;
  stepId?: string;
  stepVersion?: string;
  testSetId?: string;
  /** Required-check ids for the step (e.g. ["tsc-noemit"]). Empty → no gates. */
  requiredChecks?: string[];
  successCriteria?: SuccessCriteria;
  operatingMode?: string;
  /** Declared eligibility gates; resolved and frozen into the run manifest. */
  eligibility?: EligibilityDecl;
  /** Predeclared minimum meaningful difference; null/undefined → directional only. */
  mmd?: number | null;
  controlCandidate?: string;
  benchmarkMode?: "capability-neutral" | "production-realistic";
  cacheMode?: "cold" | "warm" | "both";
  concurrency?: number;
  /** Prior step id for the single-model e2e control handoff. Independent eval ignores this. */
  inputFrom?: string;
  /** sha256 of the spec file as loaded, and its repo-relative path. */
  specSha?: string;
  specPath?: string;
}

/** One candidate run against one input, one trial. */
export interface RunRecord {
  candidate: string;
  inputSlug: string;
  trial: number;
  text: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  ms: number;
  status: "ok" | "error";
  error?: string;
  /** Objective check result. codegen → `tsc --noEmit` passed; taskbreakdown →
   *  the parsed tasks covered every PRD requirement id. Undefined for producers
   *  with no objective check (prd/trd). */
  checkPassed?: boolean;
  /** Objective check detail (codegen → tsc output; taskbreakdown → coverage
   *  summary), truncated. */
  checkOutput?: string;

  // ── Canonical (protocol v0.4) fields. `candidate` above holds the candidate
  // id (which equals the model id for legacy suites). ──
  modelRef?: string;
  /** Provider route + upstream provider, e.g. "openrouter/anthropic". */
  deploymentRef?: string;
  trialHash?: string;
  completionState?: CompletionState;
  truncated?: boolean;
  costSource?: CostSource;
  cachedTokens?: number;
  finishReason?: string;
  checkState?: EvaluationState;
  checkVersion?: string;
  /** runId this record's output was reused from (EVAL_REUSE), if any. */
  reusedFrom?: string;
}

/** Which side of a pairwise comparison won, in candidate (a/b) space. */
export type Winner = "a" | "b" | "tie";

/**
 * One de-biased verdict for a single axis (a rubric dimension, or the overall).
 * `forward` and `reverse` are the two order-swapped rounds already mapped into
 * a/b space; `resolved` is a win only when both rounds agree, else "tie".
 */
export interface DimensionVerdict {
  forward: Winner;
  reverse: Winner;
  resolved: Winner;
  reason?: string;
}

/**
 * One pairwise judgement (already de-biased via order swap), scored on every
 * rubric dimension plus an overall. `overall` drives ranking; `dimensions` is
 * keyed by the rubric dimension key.
 */
export interface Judgement {
  inputSlug: string;
  a: string;
  b: string;
  /** Per-rubric-dimension verdict, keyed by dimension. Empty when the suite
   *  declared no dimensions. */
  dimensions: Record<string, DimensionVerdict>;
  /** Overall verdict — the ranking driver (same rule as the old `resolved`). */
  overall: DimensionVerdict;
}

/**
 * One output's ABSOLUTE (reference-free) grade, keyed back to its run cell.
 * Complements the pairwise `Judgement`: instead of "who won", it records "how
 * good is THIS output, 1–5", so second place reads as ~4 rather than "0 wins".
 */
export interface ScoreRecord {
  candidate: string;
  inputSlug: string;
  trial: number;
  /** 1–5 per rubric dimension — only the keys the scorer actually returned. */
  dimensions: Record<string, number>;
  /** 1–5 overall. */
  overall: number;
}

/** Aggregated per-candidate result. */
export interface Scorecard {
  candidate: string;
  /** Overall pairwise win rate → 0..100. Null when the candidate has no
   *  comparisons (e.g. produced no output). Drives ranking. */
  winRate: number | null;
  /** Per-dimension win rate → 0..100, keyed by rubric dimension. A dimension
   *  with no comparisons for this candidate is null. */
  dimensionWinRates: Record<string, number | null>;
  avgCostUsd: number;
  avgMs: number;
  /** Successful runs / total runs. */
  okRate: number;
  trials: number;
  /**
   * Fraction (0..1) of OK runs whose objective check passed (codegen → files
   * compiled with `tsc --noEmit`; taskbreakdown → tasks covered every PRD
   * requirement id). Null for producers with no objective check (prd/trd — the
   * report hides the column) and when there were no OK runs to measure.
   */
  objectivePassRate?: number | null;
  /**
   * Mean ABSOLUTE overall score (1–5) across this candidate's OK outputs, or
   * null when none were scored. Unlike winRate (relative), this carries
   * MAGNITUDE — a strong second place lands near the leader instead of at 0.
   */
  absoluteScore?: number | null;
  /** Mean absolute score (1–5) per rubric dimension; null per dimension when
   *  unscored. */
  dimensionScores?: Record<string, number | null>;
}

export interface Report {
  suiteId: string;
  step: string;
  judge: string;
  generatedAt: string; // ISO 8601
  candidates: string[];
  inputs: string[];
  scorecards: Scorecard[];
  judgements: Judgement[];
  /** Absolute per-output grades (1–5). Optional — present only once a suite has
   *  been scored (or re-scored via rescore.ts); older reports omit it. */
  scores?: ScoreRecord[];
}
