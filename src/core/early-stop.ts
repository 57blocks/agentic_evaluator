/**
 * The running side of early stop: a tally per candidate, consulted before each
 * trial is dispatched. The rule itself is canon/early-stop.ts.
 *
 * Trials still in flight count as remaining — assumed to succeed — so a
 * concurrent run never stops a candidate the finished rows would not.
 */

import { unreachableGate, type EarlyStopRecord, type StoppedCandidate } from "../canon/early-stop.js";
import type { TrialRow } from "../canon/rows.js";
import type { EligibilityThresholds } from "../canon/types.js";
import type { RunRecord } from "../types.js";

export interface EarlyStop {
  isStopped(candidate: string): boolean;
  /** A trial of a stopped candidate was not dispatched. */
  skip(candidate: string): void;
  /**
   * Count a finished trial. Returns the stop when this trial made a gate
   * unreachable, once per candidate; null otherwise.
   */
  record(record: RunRecord): Omit<StoppedCandidate, "skipped"> | null;
  result(): EarlyStopRecord;
}

export function earlyStop(params: {
  /** Planned trials per candidate. */
  trialsPerCandidate: number;
  inputs: number;
  eligibility: EligibilityThresholds;
  /** The same classification the final rows get (canon/adapt.ts). */
  classify: (record: RunRecord) => TrialRow;
}): EarlyStop {
  const rows = new Map<string, TrialRow[]>();
  const stopped = new Map<string, Omit<StoppedCandidate, "skipped">>();
  const skipped = new Map<string, number>();
  const plan = { trials: params.trialsPerCandidate, inputs: params.inputs };

  return {
    isStopped: (candidate) => stopped.has(candidate),
    skip: (candidate) => void skipped.set(candidate, (skipped.get(candidate) ?? 0) + 1),
    record(record) {
      if (stopped.has(record.candidate)) return null;
      const own = [...(rows.get(record.candidate) ?? []), params.classify(record)];
      rows.set(record.candidate, own);
      const reason = unreachableGate(own, plan, params.eligibility);
      if (reason === null) return null;
      const stop = { candidate: record.candidate, after_trials: own.length, reason };
      stopped.set(record.candidate, stop);
      return stop;
    },
    result: () => ({
      enabled: true,
      stopped: [...stopped.values()].map((s) => ({ ...s, skipped: skipped.get(s.candidate) ?? 0 })),
    }),
  };
}
