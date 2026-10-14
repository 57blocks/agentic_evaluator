/**
 * What a model's tokens cost, so agenteval prices a command candidate's run
 * rather than trusting the command's own figure (docs/design/agb-flow-gaps.md
 * B1). An agent tool's own cost estimate assumes its own vendor's prices:
 * claude prices any model it does not know at Opus rates (measured: kimi-k3
 * reported $0.41 for $0.07 of tokens).
 *
 * Prices are USD per million tokens. They come from the candidate's `price`
 * in the spec when given, else from the OpenRouter catalog under its `model`.
 * A catalog price's time-of-day and long-context overrides are not applied:
 * the base price is used, the higher of the two for every model listed today.
 */

const MILLION = 1_000_000;
const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const CATALOG_TIMEOUT_MS = 15_000;

export interface ModelPrice {
  input: number;
  output: number;
  /** Cache reads; input price when the provider lists none. */
  cacheRead?: number;
  /** Cache writes; input price when the provider lists none. */
  cacheWrite?: number;
}

/** Tokens a command reports for one trial. */
export interface TokenUsage {
  /** Input not served from or written to a cache. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function costOf(usage: TokenUsage, price: ModelPrice): number {
  return (
    usage.input * price.input +
    usage.cacheRead * (price.cacheRead ?? price.input) +
    usage.cacheWrite * (price.cacheWrite ?? price.input) +
    usage.output * price.output
  ) / MILLION;
}

interface CatalogEntry {
  id: string;
  pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string };
}

let catalog: Promise<Map<string, ModelPrice>> | null = null;

const perMillion = (v: string | undefined): number | undefined => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n * MILLION : undefined;
};

async function fetchCatalog(): Promise<Map<string, ModelPrice>> {
  const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenRouter catalog: HTTP ${res.status}`);
  const json = (await res.json()) as { data?: CatalogEntry[] };
  const prices = new Map<string, ModelPrice>();
  for (const m of json.data ?? []) {
    const input = perMillion(m.pricing?.prompt);
    const output = perMillion(m.pricing?.completion);
    if (input === undefined || output === undefined) continue;
    const cacheRead = perMillion(m.pricing?.input_cache_read);
    const cacheWrite = perMillion(m.pricing?.input_cache_write);
    prices.set(m.id, {
      input,
      output,
      ...(cacheRead !== undefined ? { cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWrite } : {}),
    });
  }
  return prices;
}

/** The catalog's price for a model, or null (unknown model, or the catalog unreachable). */
export async function catalogPrice(model: string): Promise<ModelPrice | null> {
  catalog ??= fetchCatalog().catch((err: unknown) => {
    catalog = null; // try again next time rather than remember the failure
    throw err;
  });
  try {
    return (await catalog).get(model) ?? null;
  } catch {
    return null;
  }
}

/** For tests: forget the fetched catalog. */
export function resetCatalog(prices?: Map<string, ModelPrice>): void {
  catalog = prices ? Promise.resolve(prices) : null;
}

/** A spec's `price` block (snake_case) as a ModelPrice. */
export function priceFromSpec(p: { input: number; output: number; cache_read?: number; cache_write?: number }): ModelPrice {
  return {
    input: p.input,
    output: p.output,
    ...(p.cache_read !== undefined ? { cacheRead: p.cache_read } : {}),
    ...(p.cache_write !== undefined ? { cacheWrite: p.cache_write } : {}),
  };
}
