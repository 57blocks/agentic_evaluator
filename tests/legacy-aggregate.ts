/**
 * Pristine copy of the ORIGINAL harness aggregate, taken verbatim from the
 * import commit (cd0840b, agentic-builder@18b8e1de) — the parity oracle.
 *
 * Do not edit. If `src/run.ts`'s aggregate ever drifts, the parity test fails
 * against this file instead of both sides moving together.
 */

import type { Judgement, RunRecord, Scorecard, ScoreRecord, Suite, Winner } from "../src/types.js";

export function winRateFor(
  candidate: string,
  judgements: Judgement[],
  pick: (jm: Judgement) => Winner | undefined,
): number | null {
  let wins = 0;
  let comparisons = 0;
  for (const jm of judgements) {
    const resolved = pick(jm);
    if (resolved === undefined) continue;
    if (jm.a === candidate) {
      comparisons++;
      if (resolved === "a") wins += 1;
      else if (resolved === "tie") wins += 0.5;
    } else if (jm.b === candidate) {
      comparisons++;
      if (resolved === "b") wins += 1;
      else if (resolved === "tie") wins += 0.5;
    }
  }
  return comparisons > 0 ? (wins / comparisons) * 100 : null;
}
export function legacyAggregate(
  suite: Suite,
  records: RunRecord[],
  judgements: Judgement[],
  scores: ScoreRecord[] = [],
): Scorecard[] {
  const trials = suite.trials ?? 2;
  const dimensions = suite.dimensions ?? [];
  return suite.candidates.map((candidate) => {
    const own = records.filter((r) => r.candidate === candidate);
    const oks = own.filter((r) => r.status === "ok");

    // Overall win rate — same rule/口径 as before, now off `overall.resolved`.
    const winRate = winRateFor(candidate, judgements, (jm) => jm.overall.resolved);

    // Per-dimension win rate — the identical computation over each dimension's
    // resolved verdict. A candidate never compared on a dimension → null.
    const dimensionWinRates: Record<string, number | null> = {};
    for (const dim of dimensions) {
      dimensionWinRates[dim] = winRateFor(
        candidate,
        judgements,
        (jm) => jm.dimensions[dim]?.resolved,
      );
    }

    const avg = (nums: number[]) =>
      nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;

    // Objective pass rate: fraction of OK runs whose objective check passed.
    // Producer-agnostic — any producer that stamps `checkPassed` on its records
    // gets a score (codegen → tsc, taskbreakdown → PRD coverage); prd/trd never
    // set it, so the field stays null and the report hides the column.
    const hasObjective = oks.some((r) => r.checkPassed !== undefined);
    const objectivePassRate =
      hasObjective && oks.length
        ? oks.filter((r) => r.checkPassed === true).length / oks.length
        : null;

    // Absolute 1–5 grades: mean overall + mean per dimension across this
    // candidate's graded outputs. Null when nothing was scored (e.g. an older
    // run, or every grade SKIPped) so the report hides the columns.
    const myScores = scores.filter((s) => s.candidate === candidate);
    const absoluteScore = myScores.length
      ? avg(myScores.map((s) => s.overall))
      : null;
    const dimensionScores: Record<string, number | null> = {};
    for (const dim of dimensions) {
      const vals = myScores
        .map((s) => s.dimensions[dim])
        .filter((v): v is number => typeof v === "number");
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
