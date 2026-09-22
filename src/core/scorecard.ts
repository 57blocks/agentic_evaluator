/**
 * The legacy per-candidate scorecard.
 *
 * Semantics unchanged from the original harness, on purpose: `report.json`
 * and the legacy page are still written, and `tests/parity.test.ts` recomputes
 * every field of this from a pristine copy of the original aggregate. Do not
 * "improve" anything here — a change that moves a number here is a change
 * that silently rewrites what earlier runs said.
 */

import { winRateFor } from "./evaluate.js";
import type { Judgement, RunRecord, Scorecard, ScoreRecord, Suite } from "../types.js";

export function aggregate(suite: Suite, records: readonly RunRecord[], judgements: readonly Judgement[], scores: readonly ScoreRecord[] = []): Scorecard[] {
  const trials = suite.trials ?? 2;
  const dimensions = suite.dimensions ?? [];
  return suite.candidates.map((candidate) => {
    const own = records.filter((r) => r.candidate === candidate);
    const oks = own.filter((r) => r.status === "ok");
    const winRate = winRateFor(candidate, judgements, (jm) => jm.overall.resolved);
    const dimensionWinRates: Record<string, number | null> = {};
    for (const dim of dimensions) {
      dimensionWinRates[dim] = winRateFor(candidate, judgements, (jm) => jm.dimensions[dim]?.resolved);
    }
    const avg = (nums: number[]): number => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0);
    const hasObjective = oks.some((r) => r.checkPassed !== undefined);
    const objectivePassRate = hasObjective && oks.length ? oks.filter((r) => r.checkPassed === true).length / oks.length : null;
    const myScores = scores.filter((s) => s.candidate === candidate);
    const absoluteScore = myScores.length ? avg(myScores.map((s) => s.overall)) : null;
    const dimensionScores: Record<string, number | null> = {};
    for (const dim of dimensions) {
      const vals = myScores.map((s) => s.dimensions[dim]).filter((v): v is number => typeof v === "number");
      dimensionScores[dim] = vals.length ? avg(vals) : null;
    }
    return {
      candidate,
      winRate,
      dimensionWinRates,
      avgCostUsd: avg(oks.map((r) => r.costUsd)),
      avgMs: avg(oks.map((r) => r.ms)),
      okRate: own.length ? oks.length / own.length : 0,
      trials,
      objectivePassRate,
      absoluteScore,
      dimensionScores,
    };
  });
}
