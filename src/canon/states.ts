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
    kind: "http" | "timeout" | "network" | "empty" | "unknown" | "cancelled" | "spawn";
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

/** A command candidate's non-zero exit, as the agent-cli adapter records it ("exit 1"). */
const NONZERO_EXIT = /^exit ([1-9]\d*)$/;

/** Why a finish reason means the command did not complete, or null when it does not. */
export function nonZeroExitReason(finishReason: string | undefined): string | null {
  const exit = NONZERO_EXIT.exec(finishReason ?? "");
  return exit ? `candidate command exited with code ${exit[1]}` : null;
}

export function classifyCompletion(signal: CompletionSignal): CompletionVerdict {
  const err = signal.error;
  if (err) {
    if (err.kind === "timeout") {
      return { state: "timeout", truncated: false, reason: "call aborted at timeout" };
    }
    if (err.kind === "cancelled") {
      return { state: "cancelled", truncated: false, reason: "candidate execution was cancelled" };
    }
    if (err.kind === "http" || err.kind === "network" || err.kind === "spawn") {
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

  // A command that exits non-zero says it did not finish — a crash after
  // writing a file is still a crash. Classified before the files are looked
  // at, so leftover output cannot make it read as completed.
  const exited = nonZeroExitReason(signal.finishReason);
  if (exited) {
    return { state: "malformed", truncated: false, reason: exited };
  }

  if (signal.parsedUnits !== undefined && signal.parsedUnits === 0) {
    return { state: "malformed", truncated: false, reason: "output contained no parseable units" };
  }

  if ((signal.refusal && signal.refusal.trim() !== "") || REFUSAL_FINISH.has(signal.finishReason ?? "")) {
    return { state: "refusal", truncated: false, reason: "provider reported a refusal" };
  }

  const truncated = signal.finishReason === "length";
  if (truncated && signal.parsedUnits === undefined) {
    // Cut at the token cap with nothing to verify against: the tail is missing
    // and no parser said the rest is usable. Calling that a success lets a
    // half-written answer into the ranking.
    return {
      state: "malformed",
      truncated: true,
      reason: "stopped on max tokens; no parsed units to confirm the output is usable",
    };
  }
  return {
    state: "success",
    truncated,
    reason: truncated ? "stopped on max tokens; output still parsed" : "completed",
  };
}
