/**
 * The Chat Completions wire format, shared by OpenRouter, OpenAI and any
 * OpenAI-compatible server (DeepSeek, Moonshot, vLLM). The three differ in
 * URL, key, which sampling fields they accept, and what usage they report.
 */

import type { BilledTokens, HttpRequest, ModelEndpoint, Provider, ProviderReply, ProviderRequest } from "./types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENAI_BASE_URL = "https://api.openai.com/v1";

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
}

interface CompletionResponse {
  provider?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    native_finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: RawUsage;
}

function messagesOf(req: ProviderRequest): Array<{ role: string; content: string }> {
  return [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: req.prompt }];
}

/** Optional fields, each only when set, so an unchanged request body stays byte-identical. */
function optionalFields(req: ProviderRequest): Record<string, unknown> {
  return {
    ...(req.topP !== undefined ? { top_p: req.topP } : {}),
    ...(req.seed !== undefined ? { seed: req.seed } : {}),
    ...(req.stop?.length ? { stop: [...req.stop] } : {}),
    ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };
}

function tokensOf(usage: RawUsage | undefined): BilledTokens {
  const prompt = usage?.prompt_tokens ?? 0;
  const cacheRead = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
  return {
    input: Math.max(0, prompt - cacheRead - cacheWrite),
    output: usage?.completion_tokens ?? 0,
    cacheRead,
    cacheWrite,
  };
}

function parseCompletion(json: unknown, servedBy: (r: CompletionResponse) => string | undefined): ProviderReply {
  const r = json as CompletionResponse;
  const choice = r.choices?.[0];
  return {
    text: choice?.message?.content ?? "",
    tokens: tokensOf(r.usage),
    usageReported: r.usage !== undefined,
    cachedTokens: r.usage?.prompt_tokens_details?.cached_tokens,
    ...(typeof r.usage?.cost === "number" ? { reportedCostUsd: r.usage.cost } : {}),
    provider: servedBy(r),
    finishReason: choice?.finish_reason ?? choice?.native_finish_reason,
    refusal: choice?.message?.refusal ?? undefined,
  };
}

const bearer = (apiKey: string | undefined): Record<string, string> => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {});

function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

export const openRouterProvider: Provider = {
  label: "OpenRouter",
  defaultKeyEnv: "OPENROUTER_API_KEY",
  build(req: ProviderRequest, _endpoint: ModelEndpoint, apiKey: string | undefined): HttpRequest {
    return {
      url: OPENROUTER_URL,
      headers: {
        ...bearer(apiKey),
        "Content-Type": "application/json",
        "HTTP-Referer": "https://57blocks.com/agentic-evaluator",
        "X-OpenRouter-Title": "Agentic Evaluator",
      },
      body: {
        model: req.model,
        messages: messagesOf(req),
        temperature: req.temperature,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...optionalFields(req),
        ...(req.reasoningEffort ? { reasoning: { effort: req.reasoningEffort } } : {}),
        usage: { include: true },
      },
    };
  },
  parse: (json) => parseCompletion(json, (r) => r.provider),
};

/**
 * OpenAI's own API. Reasoning models reject a temperature, so only one the
 * candidate declared is sent; `max_tokens` is deprecated there in favour of
 * `max_completion_tokens`.
 */
export const openAiProvider: Provider = {
  label: "OpenAI",
  defaultKeyEnv: "OPENAI_API_KEY",
  build(req: ProviderRequest, endpoint: ModelEndpoint, apiKey: string | undefined): HttpRequest {
    return {
      url: chatUrl(endpoint.baseUrl ?? OPENAI_BASE_URL),
      headers: { ...bearer(apiKey), "Content-Type": "application/json" },
      body: {
        model: req.model,
        messages: messagesOf(req),
        ...(req.temperatureDeclared ? { temperature: req.temperature } : {}),
        ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}),
        ...optionalFields(req),
        ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
      },
    };
  },
  parse: (json) => parseCompletion(json, (r) => r.model),
};

/** Any server speaking Chat Completions at `base_url`; sends what OpenRouter sends. */
export const openAiCompatibleProvider: Provider = {
  label: "OpenAI-compatible",
  build(req: ProviderRequest, endpoint: ModelEndpoint, apiKey: string | undefined): HttpRequest {
    if (!endpoint.baseUrl) throw new Error("route openai-compatible needs base_url");
    return {
      url: chatUrl(endpoint.baseUrl),
      headers: { ...bearer(apiKey), "Content-Type": "application/json" },
      body: {
        model: req.model,
        messages: messagesOf(req),
        temperature: req.temperature,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        ...optionalFields(req),
        ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
      },
    };
  },
  parse: (json) => parseCompletion(json, (r) => r.model),
};
