/**
 * Minimal, self-contained OpenRouter client.
 *
 * ~1 fetch call. No fallback (eval needs single-model attribution). Reads only
 * OPENROUTER_API_KEY. Prefers provider-reported exact cost (usage.cost via
 * `usage:{include:true}`), falling back to a tiny private pricing table.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Private pricing fallback ($/1M tokens). Used only when usage.cost missing. */
const PRICING: Record<string, { input: number; output: number }> = {
  "openai/gpt-5.4": { input: 2.5, output: 10 },
  "openai/gpt-5.4-mini": { input: 0.3, output: 1.2 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
  "anthropic/claude-sonnet-4": { input: 3, output: 15 },
  "anthropic/claude-sonnet-5": { input: 3, output: 15 },
  "anthropic/claude-opus-4": { input: 15, output: 75 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10 },
};

export interface LlmResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  ms: number;
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: Usage;
}

function estimateCost(model: string, usage: Usage | undefined): number {
  if (!usage) return 0;
  if (typeof usage.cost === "number" && usage.cost > 0) return usage.cost;
  const p = PRICING[model];
  if (!p) return 0;
  return (
    ((usage.prompt_tokens ?? 0) / 1_000_000) * p.input +
    ((usage.completion_tokens ?? 0) / 1_000_000) * p.output
  );
}

export async function complete(params: {
  model: string;
  prompt: string;
  temperature: number;
  timeoutMs?: number;
  /** Cap the completion so long structured replies aren't truncated mid-JSON. */
  maxTokens?: number;
  /** Ask the provider for a strict JSON object (used by the judge). */
  jsonMode?: boolean;
}): Promise<LlmResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set (put it in .env.local)");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    params.timeoutMs ?? 120_000,
  );
  const start = Date.now();

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://agentic-builder.app",
        "X-OpenRouter-Title": "Agentic Builder Eval",
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

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as CompletionResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("empty completion");

    return {
      text,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      costUsd: estimateCost(params.model, json.usage),
      ms: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
  }
}
