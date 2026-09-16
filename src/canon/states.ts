/**
 * Completion-state classification — turns what `llm.ts` and the producers
 * actually observed into the protocol's six candidate completion states.
 *
 * Pure function; the rules are the table in the implementation plan. Judge and
 * scorer failures are NOT completion states — they belong to the evaluator axis.
 */

import type { CompletionState } from "./types.js";

/** The subset of `LlmError` this module needs (kept structural to stay pure). */
export interface CompletionSignal {
  /** Set when the call threw. */
  error?: {
    kind: "http" | "timeout" | "network" | "empty" | "unknown";
    httpStatus?: number;
    finishReason?: string;
    refusal?: string;
  };
  /** Set when the call returned text. */
  finishReason?: string;
  refusal?: string;
  /** For producers that parse structured output (codegen): how many files parsed. */
  parsedUnits?: number;
}

export interface CompletionVerdict {
  state: CompletionState;
  /** True when the provider stopped on length but the output was still usable. */
  truncated: boolean;
  reason: string;
}

const REFUSAL_FINISH = new Set(["content_filter", "refusal", "safety"]);

export function classifyCompletion(signal: CompletionSignal): CompletionVerdict {
  const err = signal.error;
  if (err) {
    if (err.kind === "timeout") {
      return { state: "timeout", truncated: false, reason: "call aborted at timeout" };
    }
    if (err.kind === "http" || err.kind === "network") {
      const status = err.httpStatus !== undefined ? ` (HTTP ${err.httpStatus})` : "";
      return { state: "provider_error", truncated: false, reason: `provider or transport failure${status}` };
    }
    if (err.kind === "empty") {
      if ((err.refusal && err.refusal.trim() !== "") || REFUSAL_FINISH.has(err.finishReason ?? "")) {
        return { state: "refusal", truncated: false, reason: "empty content with refusal signal" };
      }
      return { state: "malformed", truncated: false, reason: "empty completion" };
    }
    return { state: "malformed", truncated: false, reason: "unclassified error" };
  }

  if (signal.parsedUnits !== undefined && signal.parsedUnits === 0) {
    return { state: "malformed", truncated: false, reason: "output contained no parseable units" };
  }

  if ((signal.refusal && signal.refusal.trim() !== "") || REFUSAL_FINISH.has(signal.finishReason ?? "")) {
    return { state: "refusal", truncated: false, reason: "provider reported a refusal" };
  }

  const truncated = signal.finishReason === "length";
  return {
    state: "success",
    truncated,
    reason: truncated ? "stopped on max tokens; output still parsed" : "completed",
  };
}
