/**
 * Which provider serves a candidate's model, and what its tokens cost.
 *
 *   claude-opus-5-5                     Anthropic, as the local claude is logged in
 *   deepseek:deepseek-v4-pro            DeepSeek's Anthropic-compatible API (DEEPSEEK_API_KEY)
 *   openrouter:moonshotai/kimi-k2       OpenRouter's Anthropic skin (OPENROUTER_API_KEY)
 *
 * claude (and agb, which runs claude) talks to the provider through
 * ANTHROPIC_BASE_URL. Every model alias claude might reach for on its own —
 * the background "small fast" model, subagents, opus/sonnet/haiku — is pinned
 * to the same model, so nothing quietly falls back to a Claude model billed
 * elsewhere.
 *
 * claude prices every token at Anthropic's rates, which is wrong for anyone
 * else. For another provider the cost is recomputed from claude's token counts
 * and that provider's price list (an estimate either way; see costOf).
 *
 *   DeepSeek   https://api-docs.deepseek.com/guides/anthropic_api
 *   OpenRouter https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration
 *              (it only guarantees the Anthropic provider: tool use through other
 *              models may break in ways that are the bridge's, not the model's)
 */

const MILLION = 1_000_000;

// USD per 1M tokens, peak hours (https://api-docs.deepseek.com/quick_start/pricing,
// read 2026-10-14). Off-peak is half: peak prices make the estimate an upper bound.
const DEEPSEEK_PRICES = {
  "deepseek-v4-pro": { input: 1.32, cacheRead: 0.044, output: 3.96 },
  "deepseek-flash": { input: 0.3, cacheRead: 0.006, output: 1.2 },
};

function pinModel(model) {
  return {
    ANTHROPIC_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
  };
}

function requireKey(name) {
  const key = process.env[name];
  if (!key) throw new Error(`${name} is not set (put it in the agentic_evaluator checkout's .env.local)`);
  return key;
}

async function openRouterPrice(model) {
  const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OpenRouter model list: HTTP ${res.status}`);
  const found = (await res.json()).data?.find((m) => m.id === model);
  if (!found) throw new Error(`OpenRouter has no model "${model}"`);
  const per = (v) => (v === undefined || v === null ? null : Number(v) * MILLION);
  const input = per(found.pricing?.prompt);
  const output = per(found.pricing?.completion);
  if (input === null || output === null) throw new Error(`OpenRouter lists no price for "${model}"`);
  return { input, cacheRead: per(found.pricing?.input_cache_read) ?? input, output };
}

/**
 * Resolve "provider:model" (or a bare Claude model).
 * Returns { provider, model, env, price }: env goes to every claude/agb
 * process; price is null when claude's own cost figure is right (Anthropic).
 */
export async function resolveModel(spec) {
  const colon = spec.indexOf(":");
  if (colon === -1) return { provider: "anthropic", model: spec, env: {}, price: null };
  const provider = spec.slice(0, colon);
  const model = spec.slice(colon + 1);
  if (provider === "deepseek") {
    const price = DEEPSEEK_PRICES[model];
    // DeepSeek serves any name it does not know as deepseek-flash.
    if (!price) throw new Error(`unknown DeepSeek model "${model}" (known: ${Object.keys(DEEPSEEK_PRICES).join(", ")})`);
    const env = {
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_API_KEY: requireKey("DEEPSEEK_API_KEY"),
      ANTHROPIC_AUTH_TOKEN: "",
      ...pinModel(model),
    };
    return { provider, model, env, price };
  }
  if (provider === "openrouter") {
    const env = {
      ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
      ANTHROPIC_AUTH_TOKEN: requireKey("OPENROUTER_API_KEY"),
      // Must be empty, not unset, or claude falls back to Anthropic.
      ANTHROPIC_API_KEY: "",
      ...pinModel(model),
    };
    return { provider, model, env, price: await openRouterPrice(model) };
  }
  throw new Error(`unknown provider "${provider}" in "${spec}" (anthropic model, deepseek:<model> or openrouter:<model>)`);
}

// What claude charges a model it does not know, per 1M input tokens: Opus
// rates. Measured 2026-10-14 (claude 2.1.296): kimi-k3 via OpenRouter, 79,002
// input + 16,384 cache-read + 244 output tokens reported as $0.4093 = $5/$0.5/$25.
const CLAUDE_FALLBACK_INPUT = 5;

/**
 * The spend cap to hand claude (--max-budget-usd) or agb (--max-cost) for a
 * real cap of `usd`. Both enforce against claude's own figure, which prices
 * another provider's tokens at Opus rates: left alone, a cheap model would be
 * stopped after a fraction of the work. Scaled by input price, which
 * dominates an agent's spend (99% of the tokens in the measurement above).
 */
export function claudeBudgetFor(usd, price) {
  return price ? Math.round(usd * (CLAUDE_FALLBACK_INPUT / price.input) * 100) / 100 : usd;
}

/**
 * USD for one claude result's usage at `price`. Cache writes are billed as
 * plain input: neither provider charges extra for them.
 */
export function costOf(usage, price) {
  const u = usage ?? {};
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const cached = u.cache_read_input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  return (input * price.input + cached * price.cacheRead + output * price.output) / MILLION;
}
