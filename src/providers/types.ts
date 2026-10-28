/**
 * Provider wire formats. A provider only builds the HTTP request and reads
 * the reply into one shape; timeouts, retries, cost and trace stay in
 * llm.ts so every route is measured the same way.
 */

import type { ModelPrice } from "../pricing.js";

/** Routes agenteval can call itself. A command candidate's route is only a label. */
export const MODEL_ROUTES = ["openrouter", "anthropic", "openai", "openai-compatible"] as const;
export type ModelRoute = (typeof MODEL_ROUTES)[number];

export const DEFAULT_ROUTE: ModelRoute = "openrouter";

export function isModelRoute(value: string | undefined): value is ModelRoute {
  return value !== undefined && (MODEL_ROUTES as readonly string[]).includes(value);
}

/** Where a model is called and how its tokens are priced. */
export interface ModelEndpoint {
  route: ModelRoute;
  /** API base, e.g. https://api.deepseek.com/v1. Required for openai-compatible. */
  baseUrl?: string;
  /** Env var holding the key; each route has a default. */
  apiKeyEnv?: string;
  /** USD per million tokens; required on direct routes, which report no cost. */
  price?: ModelPrice;
}

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Generation settings beyond model and prompt; a field left out is not sent. */
export interface SamplingOptions {
  system?: string;
  temperature: number;
  /** The candidate declared its temperature (direct routes send only a declared one). */
  temperatureDeclared?: boolean;
  topP?: number;
  seed?: number;
  stop?: readonly string[];
  reasoningEffort?: ReasoningEffort;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface ProviderRequest extends SamplingOptions {
  model: string;
  prompt: string;
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Tokens split the way they are billed. `input` excludes cache reads and writes. */
export interface BilledTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ProviderReply {
  text: string;
  tokens: BilledTokens;
  /** Whether the reply carried a usage block at all. */
  usageReported: boolean;
  /** Cache reads exactly as reported; absent when the provider reported none. */
  cachedTokens?: number;
  /** Only OpenRouter reports what a call cost. */
  reportedCostUsd?: number;
  /** Who served the call: OpenRouter's upstream, or the model id a direct API answered with. */
  provider?: string;
  finishReason?: string;
  refusal?: string;
}

export interface Provider {
  /** Names the provider in error messages ("OpenRouter 429: …"). */
  label: string;
  defaultKeyEnv?: string;
  build(req: ProviderRequest, endpoint: ModelEndpoint, apiKey: string | undefined): HttpRequest;
  parse(json: unknown): ProviderReply;
}
