/**
 * Which inputs told the candidates apart (Layer 7 output that feeds task design).
 *
 * A 300-input set where every candidate passes 290 of the same inputs is a
 * 10-input set for deciding anything. So each input is classified by how the
 * candidates did on it, and the inputs that separated someone from someone
 * else are counted as the effective N.
 *
 *   splits    candidates' success rates on it differ — it carried evidence
 *   all-pass  every candidate passed every classified trial — saturated
 *   all-fail  every candidate failed — suspect the check or the input before
 *             blaming the models
 *   flat      every candidate got the same rate strictly between 0 and 1 —
 *             trial noise, no separation
 *   unscored  fewer than two candidates have a classified trial on it
 *
 * The classes are over task success. Beside them, `judge_effective_n` counts
 * the inputs where the judge preferred one candidate over another in some
 * pairwise duel: under judge-preference that is the evidence the pick rests on.
 *
 * This is not the judge's score spread; that is discrimination.ts.
 */

import type { TrialRow } from "./rows.js";

export type ItemClass = "splits" | "all-pass" | "all-fail" | "flat" | "unscored";

export interface ItemStat {
  input: string;
  class: ItemClass;
  /** Success over every classified trial of every candidate: the input's ease. */
  pass_rate: number | null;
  /** Per candidate: success rate over its classified trials on this input. */
  by_candidate: Record<string, number>;
  /**
   * Correlation between candidates' rates on this input and their overall
   * rates: positive means stronger candidates pass it more. Null with fewer
   * than three candidates or no spread.
   */
  discrimination: number | null;
}

export interface ItemStats {
  inputs: number;
  /** Inputs that separated at least two candidates on task success. */
  effective_n: number;
  /** Inputs where some pairwise verdict was not a tie; null when no pairwise judging ran. */
  judge_effective_n: number | null;
  counts: Record<ItemClass, number>;
  items: ItemStat[];
}

const MIN_CANDIDATES_FOR_CORRELATION = 3;

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

function classify(rates: readonly number[]): ItemClass {
  if (rates.length < 2) return "unscored";
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  if (hi > lo) return "splits";
  if (lo === 1) return "all-pass";
  if (hi === 0) return "all-fail";
  return "flat";
}

export function itemStats(trials: readonly TrialRow[]): ItemStats {
  const classified = trials.filter((t) => t.task_outcome === "success" || t.task_outcome === "failure");
  // input → candidate → [successes, trials]
  const cells = new Map<string, Map<string, [number, number]>>();
  const overall = new Map<string, [number, number]>();
  for (const t of classified) {
    const ok = t.task_outcome === "success" ? 1 : 0;
    const byCand = cells.get(t.input) ?? new Map<string, [number, number]>();
    const [s, n] = byCand.get(t.candidate) ?? [0, 0];
    byCand.set(t.candidate, [s + ok, n + 1]);
    cells.set(t.input, byCand);
    const [os, on] = overall.get(t.candidate) ?? [0, 0];
    overall.set(t.candidate, [os + ok, on + 1]);
  }
  const overallRate = new Map([...overall].map(([c, [s, n]]) => [c, s / n]));

  const allInputs = [...new Set(trials.map((t) => t.input))].sort();
  const items = allInputs.map((input): ItemStat => {
    const byCand = cells.get(input) ?? new Map<string, [number, number]>();
    const entries = [...byCand].map(([c, [s, n]]) => [c, s / n] as const).sort(([a], [b]) => a.localeCompare(b));
    const rates = entries.map(([, r]) => r);
    const [succ, tot] = [...byCand.values()].reduce(([a, b], [s, n]) => [a + s, b + n], [0, 0]);
    return {
      input,
      class: classify(rates),
      pass_rate: tot > 0 ? succ / tot : null,
      by_candidate: Object.fromEntries(entries),
      discrimination:
        entries.length >= MIN_CANDIDATES_FOR_CORRELATION
          ? pearson(rates, entries.map(([c]) => overallRate.get(c)!))
          : null,
    };
  });

  const counts: Record<ItemClass, number> = { splits: 0, "all-pass": 0, "all-fail": 0, flat: 0, unscored: 0 };
  for (const it of items) counts[it.class] += 1;
  return { inputs: items.length, effective_n: counts.splits, judge_effective_n: judgeSeparated(trials), counts, items };
}

function judgeSeparated(trials: readonly TrialRow[]): number | null {
  const duels = trials.flatMap((t) => (t.judge.pairwise ?? []).map((d) => ({ input: t.input, resolved: d.resolved })));
  if (duels.length === 0) return null;
  return new Set(duels.filter((d) => d.resolved !== "tie").map((d) => d.input)).size;
}

const MAX_LISTED = 10;

const judgeClause = (s: ItemStats): string =>
  s.judge_effective_n === null || s.judge_effective_n === undefined
    ? ""
    : ` The judge preferred one candidate over another on ${s.judge_effective_n} of ${s.inputs}.`;

const listed = (ids: readonly string[]): string =>
  ids.length <= MAX_LISTED ? ids.join(", ") : `${ids.slice(0, MAX_LISTED).join(", ")} and ${ids.length - MAX_LISTED} more`;

/** GAPS.md lines: how much of the set carried evidence, and what to inspect. */
export function itemGaps(s: ItemStats): string[] {
  if (s.inputs === 0) return [];
  const lines = [
    `- effective N: ${s.effective_n} of ${s.inputs} inputs separated any two candidates on task success; ${s.counts["all-pass"]} every candidate passed, ${s.counts.flat} gave everyone the same partial rate. Only the separating inputs carry evidence for a choice (items.json).${judgeClause(s)}`,
  ];
  const allFail = s.items.filter((i) => i.class === "all-fail").map((i) => i.input);
  if (allFail.length > 0) {
    lines.push(
      `- every candidate failed ${allFail.length} input(s): ${listed(allFail)}. Check those traces for a harness or check bug before counting them as model failures.`,
    );
  }
  return lines;
}
