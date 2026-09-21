/**
 * Does the absolute judge actually discriminate?
 *
 * A 1–5 grader that returns 5 for every candidate on every dimension has
 * measured nothing, but it still produces a mean that ranks candidates and
 * reads like evidence. This happened on a real run: the pairwise judge said
 * one output invented features the brief never asked for, while the absolute
 * pass gave that same output 5/5 on `no-hallucination`.
 *
 * So the spread is computed and reported next to the scores. A dimension with
 * one distinct value across two or more graded trials is saturated, and the
 * selector is not allowed to break a tie with it.
 */

import type { TrialRow } from "./rows.js";

export interface DimensionSpread {
  dimension: string;
  /** Trials that carry a score on this dimension. */
  scored: number;
  distinct: number;
  min: number | null;
  max: number | null;
  /** Two or more graded trials, one distinct value: no discrimination. */
  saturated: boolean;
}

export interface JudgeDiscrimination {
  overall: DimensionSpread;
  dimensions: DimensionSpread[];
  /** Dimension names (plus "overall") that showed a single value. */
  saturated: string[];
  /**
   * False when the overall score cannot separate candidates. The selector
   * reads this; a saturated overall must not act as a tiebreak.
   */
  discriminates: boolean;
}

function spread(dimension: string, values: readonly number[]): DimensionSpread {
  const distinct = new Set(values).size;
  return {
    dimension,
    scored: values.length,
    distinct,
    min: values.length > 0 ? Math.min(...values) : null,
    max: values.length > 0 ? Math.max(...values) : null,
    saturated: values.length >= 2 && distinct <= 1,
  };
}

export function judgeDiscrimination(trials: readonly TrialRow[]): JudgeDiscrimination {
  const overallValues = trials
    .map((t) => t.judge.absolute_overall)
    .filter((v): v is number => v !== null && v !== undefined);

  const byDimension = new Map<string, number[]>();
  for (const t of trials) {
    for (const [dim, value] of Object.entries(t.judge.absolute_dimensions ?? {})) {
      if (typeof value !== "number") continue;
      byDimension.set(dim, [...(byDimension.get(dim) ?? []), value]);
    }
  }

  const overall = spread("overall", overallValues);
  const dimensions = [...byDimension.entries()].map(([dim, values]) => spread(dim, values));
  return {
    overall,
    dimensions,
    saturated: [overall, ...dimensions].filter((s) => s.saturated).map((s) => s.dimension),
    discriminates: !overall.saturated && overallValues.length > 0,
  };
}

/** One line for GAPS.md when the grader returned the same score throughout. */
export function saturationGap(d: JudgeDiscrimination): string | null {
  if (d.saturated.length === 0) return null;
  const value = d.overall.saturated && d.overall.max !== null ? ` (every graded trial scored ${d.overall.max})` : "";
  return (
    `- absolute scores show no discrimination on: ${d.saturated.join(", ")}${value}. ` +
    "A dimension with one distinct value measures nothing; treat those scores as not evaluated " +
    "until the rubric carries per-dimension thresholds and the judge is calibrated."
  );
}
