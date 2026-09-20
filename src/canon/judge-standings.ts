/**
 * Per-candidate judge standings, derived from the trial rows.
 *
 * Kept apart from `rates.ts` on purpose: rates describe what the CANDIDATE did
 * (did it finish, did it pass the checks), standings describe what a JUDGE
 * thought of it. Only `judge-preference` selection is allowed to read these —
 * a judge opinion must never be laundered into a success rate.
 */

import type { TrialRow } from "./rows.js";

export interface JudgeStanding {
  candidate: string;
  wins: number;
  losses: number;
  ties: number;
  comparisons: number;
  /** wins / comparisons; null when the candidate was never compared. */
  win_rate: number | null;
  /** Mean absolute overall score (1–5); null when never scored. */
  absolute_mean: number | null;
  absolute_scored: number;
}

/** One standing per candidate present in `trials`, in first-seen order. */
export function judgeStandings(trials: readonly TrialRow[]): JudgeStanding[] {
  const order: string[] = [];
  const byCandidate = new Map<string, TrialRow[]>();
  for (const t of trials) {
    if (!byCandidate.has(t.candidate)) {
      byCandidate.set(t.candidate, []);
      order.push(t.candidate);
    }
    byCandidate.get(t.candidate)!.push(t);
  }

  return order.map((candidate) => {
    const rows = byCandidate.get(candidate) ?? [];
    const duels = rows.flatMap((r) => r.judge.pairwise ?? []);
    const wins = duels.filter((d) => d.resolved === "win").length;
    const losses = duels.filter((d) => d.resolved === "loss").length;
    const ties = duels.filter((d) => d.resolved === "tie").length;
    const scores = rows
      .map((r) => r.judge.absolute_overall)
      .filter((s): s is number => s !== null && s !== undefined);
    return {
      candidate,
      wins,
      losses,
      ties,
      comparisons: duels.length,
      win_rate: duels.length > 0 ? wins / duels.length : null,
      absolute_mean:
        scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      absolute_scored: scores.length,
    };
  });
}
