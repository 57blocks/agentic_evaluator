/**
 * What a workspace actually spent. A combined run (`agenteval combine`, or a
 * re-decision under another operating mode) is assembled from other runs'
 * trials: nothing was generated or judged for it, so its ledger repeats money
 * already counted under the runs it came from. Summing it again is how one
 * task showed $1035 spent over seven runs when $216 had been. Pure, so the
 * client and the server count the same way.
 */
import type { RunView } from "./catalog.js";

/** A run built from other runs' trials, which spent nothing of its own. */
export function isCombined(run: Pick<RunView, "combinedFrom">): boolean {
  return Array.isArray(run.combinedFrom) && run.combinedFrom.length > 0;
}

/** New spend over these runs: combined runs left out. Null when no run that spent reported a ledger. */
export function spendOf(runs: readonly Pick<RunView, "totalUsd" | "combinedFrom">[]): number | null {
  return runs.reduce<number | null>(
    (acc, r) => (isCombined(r) || r.totalUsd === null ? acc : (acc ?? 0) + r.totalUsd),
    null,
  );
}
