import { sha256 } from "../canon/hash.js";
import type { CandidateAdapterId, CandidateDef } from "../canon/types.js";
import type { ProducerKind } from "../types.js";
import { agentCliAdapter } from "./agent-cli.js";
import { codegenAdapter } from "./codegen.js";
import { modelApiAdapter } from "./model-api.js";
import { adapterIdOf, type CandidateAdapter } from "./types.js";

const ADAPTERS: Record<CandidateAdapterId, CandidateAdapter> = {
  "model-api": modelApiAdapter,
  codegen: codegenAdapter,
  "agent-cli": agentCliAdapter,
};

export function adapterFor(def: CandidateDef, producer: ProducerKind): CandidateAdapter {
  return ADAPTERS[adapterIdOf(def, producer)];
}

/**
 * Adapter fields of the trial identity. agent-cli always enters it. A model
 * candidate enters it only when it declares something beyond model,
 * temperature and max_tokens (a direct route, a system prompt, a sampling
 * setting), so a plain OpenRouter candidate keeps the hash its old trials
 * carry and `--reuse` still finds them. Price and key are left out: they
 * change what a trial costs or how it is called, not what it produces.
 */
export function trialAdapterFields(
  def: CandidateDef,
  producer: ProducerKind,
): { adapter?: string; adapterConfigSha?: string } {
  const adapter = adapterIdOf(def, producer);
  if (adapter === "agent-cli") {
    // What the command reports about itself is not what it does: `trace`
    // stays out, so declaring it on a candidate keeps its trials reusable.
    const { trace: _trace, ...identity } = def.cli ?? {};
    return { adapter: "agent-cli", adapterConfigSha: sha256(JSON.stringify(identity)) };
  }
  const g = def.generation_settings ?? {};
  const config = {
    ...(def.provider_route && def.provider_route !== "openrouter" ? { route: def.provider_route } : {}),
    ...(def.base_url ? { base_url: def.base_url } : {}),
    ...(def.system ? { system: def.system } : {}),
    ...(g.top_p !== undefined ? { top_p: g.top_p } : {}),
    ...(g.seed !== undefined ? { seed: g.seed } : {}),
    ...(g.stop?.length ? { stop: g.stop } : {}),
    ...(g.reasoning_effort ? { reasoning_effort: g.reasoning_effort } : {}),
  };
  if (Object.keys(config).length === 0) return {};
  return { adapter, adapterConfigSha: sha256(JSON.stringify(config)) };
}

export { AdapterError, adapterIdOf, modelRefOf } from "./types.js";
export { agentCliAdapter };
export type { CandidateAdapter, CandidateRequest, CandidateResult } from "./types.js";
