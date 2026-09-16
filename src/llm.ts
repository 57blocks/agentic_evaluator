/**
 * Minimal, self-contained OpenRouter client.
 *
 * One fetch call, no fallback (evaluation needs single-model attribution).
 * Reads only OPENROUTER_API_KEY. Prefers provider-reported exact cost
 * (`usage.cost` via `usage:{include:true}`); falls back to a small private
 * pricing table and LABELS the result `estimated` — estimated and reported
 * costs are never mixed silently (protocol §3, cost accounting).
 *
 * Every call can emit trace events (request, response or error) through an
 * optional callback so the run's trace.jsonl sees judge and scorer calls too.
 * Failures throw `LlmError`, which carries whatever usage the provider already
 * billed — a paid-then-empty completion still costs money.
 */

import { sha256 } from "./canon/hash.js";
import type { CostSource } from "./canon/types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 120_000;

/** Private pricing fallback ($/1M tokens). Used only when usage.cost is missing. */
const PRICING: Record<string, { input: number; output: number }> = {
  "openai/gpt-5.4": { input: 2.5, output: 15 },
  "openai/gpt-5.5": { input: 5, output: 30 },
  "anthropic/claude-sonnet-5": { input: 2, output: 10 },
  "anthropic/claude-opus-4.8": { input: 5, output: 25 },
  "deepseek/deepseek-v4-pro": { input: 1.6, output: 3.2 },
  "moonshotai/kimi-k3": { input: 2.65, output: 13.28 },
  "google/gemini-3.1-pro-preview": { input: 2, output: 12 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10 },
};

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  costUsd: number;
  costSource: CostSource;
}

export interface LlmResult extends LlmUsage {
  text: string;
  ms: number;
  /** Upstream provider that served the request, as reported by OpenRouter. */
  provider?: string;
  finishReason?: string;
  /** Provider-supplied refusal text, when the model declined. */
  refusal?: string;
}

export type LlmErrorKind = "http" | "timeout" | "network" | "empty";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly httpStatus?: number;
  readonly ms: number;
  /** Billed usage, when the provider returned any before the failure. */
  readonly usage?: LlmUsage;
  readonly provider?: string;
  readonly finishReason?: string;
  readonly refusal?: string;

  constructor(
    message: string,
    fields: {
      kind: LlmErrorKind;
      ms: number;
      httpStatus?: number;
      usage?: LlmUsage;
      provider?: string;
      finishReason?: string;
      refusal?: string;
    },
  ) {
    super(message);
    this.name = "LlmError";
    this.kind = fields.kind;
    this.httpStatus = fields.httpStatus;
    this.ms = fields.ms;
    this.usage = fields.usage;
    this.provider = fields.provider;
    this.finishReason = fields.finishReason;
    this.refusal = fields.refusal;
  }
}

/** One trace event per request and per response/error. Never carries prompt text. */
export interface LlmCallEvent {
  type: "model.request" | "model.response" | "model.error";
  model: string;
  promptSha: string;
  promptChars: number;
  ms?: number;
  usage?: LlmUsage;
  provider?: string;
  finishReason?: string;
  error?: { kind: LlmErrorKind; httpStatus?: number; message: string };
  /** Caller-supplied labels (phase, candidate, input, trial, pair, attempt). */
  context?: Record<string, unknown>;
}

export type LlmTrace = (event: LlmCallEvent) => void;

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

interface CompletionResponse {
  provider?: string;
  choices?: Array<{
    finish_reason?: string;
    native_finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: RawUsage;
}

function normaliseUsage(model: string, usage: RawUsage | undefined): LlmUsage {
  const promptTokens = usage?.prompt_tokens ?? 0;
  const completionTokens = usage?.completion_tokens ?? 0;
  const cachedTokens = usage?.prompt_tokens_details?.cached_tokens;
  if (usage && typeof usage.cost === "number" && usage.cost > 0) {
    return { promptTokens, completionTokens, cachedTokens, costUsd: usage.cost, costSource: "provider-reported" };
  }
  const price = PRICING[model];
  if (usage && price) {
    const costUsd = (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output;
    return { promptTokens, completionTokens, cachedTokens, costUsd, costSource: "estimated" };
  }
  return { promptTokens, completionTokens, cachedTokens, costUsd: 0, costSource: "none" };
}

export interface CompleteParams {
  model: string;
  prompt: string;
  temperature: number;
  timeoutMs?: number;
  /** Cap the completion so long structured replies aren't truncated mid-JSON. */
  maxTokens?: number;
  /** Ask the provider for a strict JSON object (used by the judge and scorer). */
  jsonMode?: boolean;
  trace?: LlmTrace;
  traceContext?: Record<string, unknown>;
}

export async function complete(params: CompleteParams): Promise<LlmResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set (put it in .env.local)");
  }

  const promptSha = sha256(params.prompt);
  const base = { model: params.model, promptSha, promptChars: params.prompt.length, context: params.traceContext };
  params.trace?.({ type: "model.request", ...base });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const start = Date.now();
  const elapsed = (): number => Date.now() - start;

  const fail = (err: LlmError): never => {
    params.trace?.({
      type: "model.error",
      ...base,
      ms: err.ms,
      usage: err.usage,
      provider: err.provider,
      finishReason: err.finishReason,
      error: { kind: err.kind, httpStatus: err.httpStatus, message: err.message },
    });
    throw err;
  };

  try {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://57blocks.com/agentic-evaluator",
          "X-OpenRouter-Title": "Agentic Evaluator",
        },
        body: JSON.stringify({
          model: params.model,
          messages: [{ role: "user", content: params.prompt }],
          temperature: params.temperature,
          ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
          ...(params.jsonMode ? { response_format: { type: "json_object" } } : {}),
          usage: { include: true },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      return fail(
        new LlmError(isAbort ? `timeout after ${elapsed()}ms` : `network error: ${err instanceof Error ? err.message : String(err)}`, {
          kind: isAbort ? "timeout" : "network",
          ms: elapsed(),
        }),
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return fail(
        new LlmError(`OpenRouter ${res.status}: ${body.slice(0, 300)}`, {
          kind: "http",
          httpStatus: res.status,
          ms: elapsed(),
        }),
      );
    }

    // Reading the body is also governed by the abort signal: a slow judge that
    // starts replying but does not finish before the timeout aborts HERE, not
    // in fetch(). Classify it as a timeout too, never as an unknown error.
    let json: CompletionResponse;
    try {
      json = (await res.json()) as CompletionResponse;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      return fail(
        new LlmError(
          isAbort ? `timeout after ${elapsed()}ms while reading the response` : `unreadable response body: ${err instanceof Error ? err.message : String(err)}`,
          { kind: isAbort ? "timeout" : "network", ms: elapsed() },
        ),
      );
    }
    const choice = json.choices?.[0];
    const text = choice?.message?.content ?? "";
    const usage = normaliseUsage(params.model, json.usage);
    const provider = json.provider;
    const finishReason = choice?.finish_reason ?? choice?.native_finish_reason;
    const refusal = choice?.message?.refusal ?? undefined;
    const ms = elapsed();

    if (!text.trim()) {
      return fail(
        new LlmError("empty completion", { kind: "empty", ms, usage, provider, finishReason, refusal }),
      );
    }

    params.trace?.({ type: "model.response", ...base, ms, usage, provider, finishReason });
    return { text, ms, provider, finishReason, refusal, ...usage };
  } finally {
    clearTimeout(timeout);
  }
}
