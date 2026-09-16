/**
 * Content hashes — trial identity and provenance.
 *
 * A trial's identity is everything that can materially change its output.
 * Reuse of a prior generation is allowed only on an exact hash match, so a
 * changed prompt template, input, model or sampling setting never silently
 * reuses stale text (the old `EVAL_REUSE` matched on filename alone).
 */

import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

/** First 8 hex chars — enough to disambiguate in filenames and version strings. */
export function short(hash: string): string {
  return hash.slice(0, 8);
}

export interface TrialIdentity {
  producer: string;
  /** Version of the producer implementation (bump when its prompt preamble changes). */
  producerVersion: string;
  /** sha256 of the prompt template / preamble text. */
  promptTemplateSha: string;
  /** sha256 of the frozen input text. */
  inputSha: string;
  model: string;
  temperature: number;
  maxTokens?: number;
  trial: number;
}

/**
 * Stable across key order (fields are serialized in a fixed order) and
 * sensitive to every field. Excludes timeouts, judge, scaffold — those change
 * how the output is evaluated, not the output itself.
 */
export function trialHash(id: TrialIdentity): string {
  const canonical = JSON.stringify({
    v: 1,
    producer: id.producer,
    producerVersion: id.producerVersion,
    promptTemplateSha: id.promptTemplateSha,
    inputSha: id.inputSha,
    model: id.model,
    temperature: id.temperature,
    maxTokens: id.maxTokens ?? null,
    trial: id.trial,
  });
  return sha256(canonical);
}
