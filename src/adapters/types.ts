/**
 * Candidate adapter contract (protocol §5). The runner talks only to this
 * surface; model APIs, codegen prompts, and CLI agents are interchangeable.
 */

import type { AgentCliConfig, CandidateAdapterId, CandidateDef, CostSource } from "../canon/types.js";
import type { LlmTrace } from "../llm.js";
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
}

export interface ExecutionContext {
  workDir: string;
  /**
   * Task directory a declared script path resolves against. A task owns its
   * agent; without this an `agent-cli` candidate resolves against whatever
   * the harness happens to call its own root, which stops being meaningful
   * the moment the task lives somewhere else.
   */
  taskRoot?: string;
  emit?: LlmTrace;
  traceContext?: Record<string, unknown>;
}

export interface CandidateResult {
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

  constructor(message: string, fields: { kind: AdapterErrorKind; ms: number }) {
    super(message);
    this.name = "AdapterError";
    this.kind = fields.kind;
    this.ms = fields.ms;
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
