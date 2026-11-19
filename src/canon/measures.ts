/**
 * Check measures: named numbers a command check reports beside its verdict
 * (`{"measures": {"comments": 3, "defect_claims": 1}}`) — how many comments a
 * review posted, how many claimed a defect. Descriptive only: nothing here
 * gates, ranks or decides; the verdict and `score` do that.
 *
 * Aggregated with the input as the unit, as every interval in this harness
 * is: a measure's mean over an input's graded (pass/fail) trials first, then
 * the mean over inputs, with a 95% t-interval over the per-input means —
 * three trials of one input are not three independent observations. Each
 * measure has its own n: one that only some inputs report (defect claims,
 * on clean inputs only) is averaged over those inputs and absent elsewhere.
 *
 * Pure: no fs.
 */

import type { CheckCell, TrialRow } from "./rows.js";
import { tInterval95 } from "./stats.js";

/** Lower snake case, starting with a letter, at most 40 characters. */
export const MEASURE_NAME = /^[a-z][a-z0-9_]{0,39}$/;
/** More than this many names on one check is a bug in the check, not data: the rest are dropped. */
export const MAX_MEASURES = 32;

export type Measures = Record<string, number>;

/**
 * What a check printed under `measures`, kept only as named finite numbers.
 * Anything else — a bad name, a string, null, a nested object — is dropped,
 * never an evaluator error. Undefined when nothing is left.
 */
export function measuresOf(value: unknown): Measures | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const kept = Object.entries(value as Record<string, unknown>)
    .filter((e): e is [string, number] => MEASURE_NAME.test(e[0]) && typeof e[1] === "number" && Number.isFinite(e[1]))
    .slice(0, MAX_MEASURES);
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}

/** One measure for one candidate over a set of inputs. */
export interface MeasureStat {
  /** Mean over inputs of each input's mean over its graded trials. */
  mean: number;
  /** Inputs that reported this measure on a graded trial. */
  n: number;
  /** Graded trials that reported it. */
  trials: number;
  /** 95% t-interval over the per-input means; null with fewer than two inputs. */
  low: number | null;
  high: number | null;
}

export type MeasureStats = Record<string, MeasureStat>;

/** The rows a measure is read from; a diff's rows qualify. */
export type MeasureRow = Pick<TrialRow, "candidate" | "input" | "checks">;

const isGraded = (c: CheckCell): boolean => c.state === "pass" || c.state === "fail";

/** Each graded check cell's measures on a row; a step gates on one check, so usually one. */
function gradedMeasures(row: MeasureRow): Measures[] {
  return Object.values(row.checks ?? {}).flatMap((c) => (isGraded(c) && c.measures ? [c.measures] : []));
}

/** Per measure, per input: the mean over that input's graded trials and how many there were. */
export function inputMeans(rows: readonly MeasureRow[], candidate: string, inputs?: ReadonlySet<string>): Map<string, Map<string, { mean: number; trials: number }>> {
  const sums = new Map<string, Map<string, { sum: number; trials: number }>>();
  for (const row of rows) {
    if (row.candidate !== candidate || (inputs && !inputs.has(row.input))) continue;
    for (const measures of gradedMeasures(row)) {
      for (const [name, value] of Object.entries(measures)) {
        const byInput = sums.get(name) ?? new Map<string, { sum: number; trials: number }>();
        const cur = byInput.get(row.input) ?? { sum: 0, trials: 0 };
        byInput.set(row.input, { sum: cur.sum + value, trials: cur.trials + 1 });
        sums.set(name, byInput);
      }
    }
  }
  return new Map(
    [...sums].map(([name, byInput]) => [name, new Map([...byInput].map(([input, s]) => [input, { mean: s.sum / s.trials, trials: s.trials }]))]),
  );
}

/** Every measure the candidate reported on these inputs (all of them when none are given), names sorted. */
export function measureStats(rows: readonly MeasureRow[], candidate: string, inputs?: ReadonlySet<string>): MeasureStats {
  const entries = [...inputMeans(rows, candidate, inputs)].sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(
    entries.map(([name, byInput]) => {
      const means = [...byInput.values()].map((v) => v.mean);
      const ci = tInterval95(means);
      const stat: MeasureStat = {
        mean: means.reduce((s, v) => s + v, 0) / means.length,
        n: means.length,
        trials: [...byInput.values()].reduce((s, v) => s + v.trials, 0),
        low: ci?.low ?? null,
        high: ci?.high ?? null,
      };
      return [name, stat];
    }),
  );
}

/** Every measure name any graded trial reported, sorted. */
export function measureNames(rows: readonly MeasureRow[]): string[] {
  return [...new Set(rows.flatMap((r) => gradedMeasures(r).flatMap((m) => Object.keys(m))))].sort();
}

/** A measure as reports print it: two decimals. */
export function fmtMeasure(v: number): string {
  return v.toFixed(2);
}

/** A measure with its interval and n, in one line: `2.88 [2.41–3.35] · 28 inputs`. */
export function fmtMeasureStat(s: MeasureStat): string {
  const ci = s.low === null || s.high === null ? "" : ` [${fmtMeasure(s.low)}–${fmtMeasure(s.high)}]`;
  return `${fmtMeasure(s.mean)}${ci} · ${s.n} input${s.n === 1 ? "" : "s"}`;
}

/** Every-input means in one line, as shown under the required check: "comments 2.88 · defect_claims 0.40". */
export function measureSummary(m: MeasureStats): string {
  return Object.entries(m).map(([name, s]) => `${name} ${fmtMeasure(s.mean)}`).join(" · ");
}
