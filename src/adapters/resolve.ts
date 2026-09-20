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

/** Only agent-cli enters trial identity, so omitted-adapter model trials keep their hash. */
export function trialAdapterFields(
  def: CandidateDef,
  producer: ProducerKind,
): { adapter?: string; adapterConfigSha?: string } {
  if (adapterIdOf(def, producer) !== "agent-cli") return {};
  return { adapter: "agent-cli", adapterConfigSha: sha256(JSON.stringify(def.cli ?? {})) };
}

export { AdapterError, adapterIdOf, modelRefOf } from "./types.js";
export { agentCliAdapter, codegenAdapter, modelApiAdapter };
export type { CandidateAdapter, CandidateRequest, CandidateResult } from "./types.js";
