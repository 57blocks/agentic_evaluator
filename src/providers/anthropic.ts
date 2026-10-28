/**
 * Anthropic's Messages API, called over plain HTTP like the other routes so
 * timeouts, retries and usage are handled in one place (llm.ts).
 *
 * API version 2026-10-21 rejects temperature, top_p and top_k on every
 * model, so no sampling field is sent; preflight warns when a candidate
 * declares one. Depth is set with `output_config.effort`. There is no JSON
 * mode: the judge's prompt asks for JSON and its parser retries a bad reply.
 */

import type { HttpRequest, ModelEndpoint, Provider, ProviderReply, ProviderRequest } from "./types.js";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_VERSION = "2026-10-21";
/** Messages requires max_tokens; used when the caller sets none. */
const DEFAULT_MAX_TOKENS = 16_000;

interface MessagesResponse {
  model?: string;
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

function refusalOf(r: MessagesResponse): string | undefined {
  if (r.stop_reason !== "refusal") return undefined;
  return r.stop_details?.explanation ?? (r.stop_details?.category ? `refused (${r.stop_details.category})` : "refused");
}

export const anthropicProvider: Provider = {
  label: "Anthropic",
  defaultKeyEnv: "ANTHROPIC_API_KEY",
  build(req: ProviderRequest, endpoint: ModelEndpoint, apiKey: string | undefined): HttpRequest {
    return {
      url: `${(endpoint.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/+$/, "")}/messages`,
      headers: {
        ...(apiKey ? { "x-api-key": apiKey } : {}),
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: {
        model: req.model,
        max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.prompt }],
        ...(req.stop?.length ? { stop_sequences: [...req.stop] } : {}),
        ...(req.reasoningEffort ? { output_config: { effort: req.reasoningEffort } } : {}),
      },
    };
  },
  parse(json: unknown): ProviderReply {
    const r = json as MessagesResponse;
    const text = (r.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return {
      text,
      tokens: {
        input: r.usage?.input_tokens ?? 0,
        output: r.usage?.output_tokens ?? 0,
        cacheRead: r.usage?.cache_read_input_tokens ?? 0,
        cacheWrite: r.usage?.cache_creation_input_tokens ?? 0,
      },
      usageReported: r.usage !== undefined,
      cachedTokens: r.usage?.cache_read_input_tokens,
      provider: r.model,
      finishReason: r.stop_reason,
      refusal: refusalOf(r),
    };
  },
};
