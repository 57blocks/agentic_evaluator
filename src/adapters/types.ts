/**
 * Candidate adapter contract (protocol §5). The runner talks only to this
 * surface; model APIs, codegen prompts, and CLI agents are interchangeable.
 */

import type { AgentCliConfig, CandidateAdapterId, CandidateDef, CostSource, Isolation } from "../canon/types.js";
import type { AgentTrace } from "../canon/agent-trace.js";
import type { LlmTrace } from "../llm.js";
import type { ModelPrice } from "../pricing.js";
import type { ProducerKind } from "../types.js";

export type { CandidateAdapterId };

export interface ArtifactFile {
  path: string;
  content: string;
}

export interface CandidateRequest {
  stepId: string;
  candidateId: string;
  inputId: string;
  inputText: string;
  /** Prompt template with `{{input}}`; used by model-api. */
  promptTemplate: string;
  temperature: number;
  timeoutMs: number;
  model?: string;
  maxTokens?: number;
  /** Required when the adapter is agent-cli. */
  cli?: AgentCliConfig;
  /** agent-cli: a directory copied into the work dir before the command starts (`fixture_dir`). */
  fixtureDir?: string;
  /** agent-cli: files written into the work dir before it starts — a chained step's handoff. */
  seedFiles?: readonly ArtifactFile[];
  /** agent-cli with `reports_usage: tokens`: the price to use instead of `model`'s catalog price. */
  price?: ModelPrice;
  /** agent-cli: the step's spend cap per trial (`max_cost_per_trial_usd`). */
  maxCostUsd?: number;
}

export interface ExecutionContext {
  workDir: string;
  /**
   * Task directory a declared script path resolves against. A task owns its
   * agent; without this an `agent-cli` candidate resolves against whatever
   * the harness happens to call its own root, which stops being meaningful
   * the moment the task lives somewhere else.
   */
  taskRoot: string;
  emit?: LlmTrace;
  traceContext?: Record<string, unknown>;
}

export interface CandidateResult {
  /**
   * agent-cli: what the command printed (stdout, then stderr; tails). Its
   * answer is the files it left, so without this the agent's own account of
   * a failure ("blocked on a permission", "budget spent") is lost.
   */
  log?: string;
  /**
   * How the command was executed. Recorded rather than inferred: whether an
   * agent ran sandboxed or on the harness's own machine is part of what a
   * reader needs to weigh the result.
   */
  isolation?: Isolation;
  text: string;
  artifacts: ArtifactFile[];
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  costUsd: number;
  costSource: CostSource;
  ms: number;
  provider?: string;
  finishReason?: string;
  refusal?: string;
  /** agent-cli with `cli.trace`: the trace the command left, read (src/traces/). */
  trace?: AgentTrace;
  /** agent-cli with `cli.trace`: the trace was there but could not be read. */
  traceError?: string;
}

/** What a stopped command had already written: read after the kill, never lost with it. */
export interface PartialResult {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  costUsd: number;
  costSource: CostSource;
  trace?: AgentTrace;
  traceError?: string;
}

export interface CandidateAdapter {
  readonly id: CandidateAdapterId;
  execute(request: CandidateRequest, context: ExecutionContext): Promise<CandidateResult>;
}

export type AdapterErrorKind = "timeout" | "cancelled" | "spawn" | "unknown";

/** Failures of the adapter/runtime, not of the candidate's task. */
export class AdapterError extends Error {
  readonly kind: AdapterErrorKind;
  readonly ms: number;
  /** What the command printed before it was stopped (a timeout), when there was a command. */
  readonly log?: string;
  /** What it had reported and traced before it was stopped. */
  readonly partial?: PartialResult;

  constructor(message: string, fields: { kind: AdapterErrorKind; ms: number; log?: string; partial?: PartialResult }) {
    super(message);
    this.name = "AdapterError";
    this.kind = fields.kind;
    this.ms = fields.ms;
    if (fields.log !== undefined) this.log = fields.log;
    if (fields.partial !== undefined) this.partial = fields.partial;
  }
}

/** Spec producer default: codegen → codegen, agent → agent-cli, else model-api. */
export function adapterIdOf(def: Pick<CandidateDef, "adapter">, producer: ProducerKind): CandidateAdapterId {
  if (def.adapter) return def.adapter;
  if (producer === "codegen") return "codegen";
  if (producer === "agent") return "agent-cli";
  return "model-api";
}

/** Records always store a string; CLI candidates have no OpenRouter model id. */
export function modelRefOf(def: CandidateDef): string {
  return def.model ?? (def.cli?.argv[0] ? `cli:${def.cli.argv[0]}` : def.id);
}

export function requireModel(request: CandidateRequest, adapterId: CandidateAdapterId): string {
  if (!request.model) throw new Error(`${adapterId} candidate "${request.candidateId}" has no model`);
  return request.model;
}

export function toCandidateResult(
  r: Omit<CandidateResult, "artifacts">,
  artifacts: ArtifactFile[] = [],
): CandidateResult {
  return { ...r, artifacts };
}
