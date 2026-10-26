import { anthropicProvider } from "./anthropic.js";
import { openAiCompatibleProvider, openAiProvider, openRouterProvider } from "./chat-completions.js";
import { priceFromSpec } from "../pricing.js";
import { DEFAULT_ROUTE, isModelRoute, MODEL_ROUTES, type ModelEndpoint, type ModelRoute, type Provider } from "./types.js";

export * from "./types.js";

const PROVIDERS: Record<ModelRoute, Provider> = {
  openrouter: openRouterProvider,
  anthropic: anthropicProvider,
  openai: openAiProvider,
  "openai-compatible": openAiCompatibleProvider,
};

export function providerFor(route: ModelRoute): Provider {
  return PROVIDERS[route];
}

/** The env var a route's key is read from; undefined when it needs none (a local server). */
export function apiKeyEnvOf(endpoint: ModelEndpoint): string | undefined {
  return endpoint.apiKeyEnv ?? providerFor(endpoint.route).defaultKeyEnv;
}

/** How a spec declares an endpoint, on a candidate or on the judge. */
export interface EndpointDecl {
  provider_route?: string;
  base_url?: string;
  api_key_env?: string;
  price?: { input: number; output: number; cache_read?: number; cache_write?: number };
}

/** The endpoint a validated declaration names; an unknown route is the loader's to reject. */
export function endpointOf(decl: EndpointDecl): ModelEndpoint {
  return {
    route: isModelRoute(decl.provider_route) ? decl.provider_route : DEFAULT_ROUTE,
    ...(decl.base_url ? { baseUrl: decl.base_url } : {}),
    ...(decl.api_key_env ? { apiKeyEnv: decl.api_key_env } : {}),
    ...(decl.price ? { price: priceFromSpec(decl.price) } : {}),
  };
}

/** Why a declaration cannot be called, or null when it can. */
export function endpointProblem(decl: EndpointDecl): string | null {
  const route = decl.provider_route ?? DEFAULT_ROUTE;
  if (!isModelRoute(route)) return `provider_route "${route}" is not one of ${MODEL_ROUTES.join(", ")}`;
  if (route === "openai-compatible" && !decl.base_url) return "provider_route openai-compatible needs base_url";
  // A vendor's default key goes only to that vendor: pointing anthropic or
  // openai at another host must name the key it sends there.
  if (decl.base_url && (route === "anthropic" || route === "openai") && !decl.api_key_env) {
    return `provider_route ${route} with base_url needs api_key_env, so ${providerFor(route).defaultKeyEnv} is not sent to another host by default`;
  }
  const sendsKey = decl.api_key_env !== undefined || providerFor(route).defaultKeyEnv !== undefined;
  if (decl.base_url && sendsKey && !isSecureOrLocal(decl.base_url)) {
    return `base_url ${decl.base_url} must use https to be sent a key, unless it is a loopback host`;
  }
  // A direct API reports no cost: without a price every trial would read as free.
  if (route !== "openrouter" && !decl.price) return `provider_route ${route} needs a price (USD per million tokens), since ${route} reports no cost`;
  return null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https anywhere, plain http only to this machine: a key never crosses the network in the clear. */
function isSecureOrLocal(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname));
  } catch {
    return false;
  }
}
