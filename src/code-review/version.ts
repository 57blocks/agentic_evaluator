/**
 * The findings-match check's version: the matcher's own revision, its
 * options, and — when an LLM fallback is configured — the model, where it is
 * called, and both prompts. Changing any of them is a changed check: shown in
 * the evidence, and regraded on `--reuse` from the files each trial left.
 */

import { sha256, short } from "../canon/hash.js";
import type { CheckConfig } from "../types.js";
import { CLAIM_SYSTEM, LLM_ATTEMPTS, MATCH_ALL_SYSTEM, MATCH_SYSTEM } from "./match.js";

/** Bump when the matching rules change in code. */
export const FINDINGS_MATCH_REVISION = "findings-match-4";

type FindingsMatchConfig = Extract<CheckConfig, { kind: "findings-match" }>;

export function findingsMatchVersion(check: FindingsMatchConfig): string {
  const llm = check.llmFallback;
  // A fixed shape, so the same options always hash alike.
  const options = JSON.stringify({
    line_tolerance: check.lineTolerance,
    require_category: check.requireCategory,
    llm_fallback: llm
      ? {
          model: llm.model,
          route: llm.endpoint.route,
          base_url: llm.endpoint.baseUrl ?? null,
          attempts: LLM_ATTEMPTS,
          match_prompt: sha256(MATCH_SYSTEM),
          claim_prompt: sha256(CLAIM_SYSTEM),
          // Only when set, so the default's version stays what it was.
          ...(llm.judge === "all" ? { judge: "all", match_all_prompt: sha256(MATCH_ALL_SYSTEM) } : {}),
        }
      : null,
  });
  return `${FINDINGS_MATCH_REVISION}+opts-${short(sha256(options))}`;
}
