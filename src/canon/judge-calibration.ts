/**
 * Does the absolute judge's score separate answers a person called right
 * from answers they called wrong?
 *
 * The pairwise path (canon/review.ts `judgeAgreement`) compares a human's
 * A-or-B verdicts with the judge's. Most tasks here run only the absolute
 * 1–5 judge, so that path never fires on them. This one takes per-answer
 * labels — right or wrong, from a review — and asks of each score (overall,
 * and every judged dimension on its own):
 *
 *   AUC          the chance a right answer outscores a wrong one, ties half:
 *                1 separates perfectly, 0.5 is a coin, 0 is backwards
 *   interval     95%, resampling inputs (seeded), because the answers to one
 *                input are not independent evidence
 *   wrong at top how many wrong answers still got the top score
 *
 * It also says how far the labels are from the required check: labels that
 * never disagree with the check are the check's verdicts, and the result is
 * "judge versus check", whoever wrote the file.
 *
 * Pure: the labels file is read by src/core/labels-load.ts.
 */

import type { TrialRow } from "./rows.js";

export interface JudgeLabel {
  candidate: string;
  input: string;
  /** Required when the run has several trials of this candidate on this input. */
  trial?: number;
  label: "right" | "wrong";
  /** Breaks results down, e.g. by item type. */
  group?: string;
  /** Where the label came from, e.g. "reviewed" or "derived"; carried, not interpreted. */
  basis?: string;
  note?: string;
  /** Line in the labels file, for error messages. */
  line?: number;
}

export type CalibrationRow = Pick<TrialRow, "candidate" | "input" | "trial" | "completion_state" | "task_outcome" | "judge">;

export interface ScoreDistribution {
  n: number;
  mean: number | null;
  /** Answers per score, only scores that occur. */
  counts: Record<string, number>;
}

export type CalibrationVerdict = "separates" | "does-not-separate" | "backwards" | "too-few";

export interface MeasureCalibration {
  /** "overall", or a judged dimension. */
  measure: string;
  right: ScoreDistribution;
  wrong: ScoreDistribution;
  /** Labelled answers the judge left without this score. */
  unscored: number;
  auc: number | null;
  interval: { low: number; high: number } | null;
  wrongAtTop: number;
  verdict: CalibrationVerdict;
}

export interface JudgeCalibration {
  labels: number;
  matched: number;
  /** Labels with no row in the run. */
  unmatched: JudgeLabel[];
  /** Labelled trials that produced no answer (timeout, refusal, …): nothing for the judge to score. */
  noAnswer: number;
  /** Labels against the required check's outcome on the same answer. */
  check: { agree: number; disagree: number };
  measures: MeasureCalibration[];
  groups: Array<{ group: string; labels: number; measures: MeasureCalibration[] }>;
}

export class LabelError extends Error {}

/** Below this many labelled answers on either side, no verdict is given. */
export const MIN_LABELS_PER_SIDE = 5;
/** The absolute judge's scale tops out here. */
export const TOP_SCORE = 5;
const RESAMPLES = 1000;
const SEED = 20261112;

/** Rank-based AUC (Mann–Whitney), ties counted half; null when a side is empty. */
export function auc(right: readonly number[], wrong: readonly number[]): number | null {
  if (right.length === 0 || wrong.length === 0) return null;
  const all = [...right.map((s) => ({ s, right: true })), ...wrong.map((s) => ({ s, right: false }))].sort((x, y) => x.s - y.s);
  let rankSumRight = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j]!.s === all[i]!.s) j += 1;
    const avgRank = (i + 1 + j) / 2; // ranks i+1..j, averaged over the tie
    for (let k = i; k < j; k++) if (all[k]!.right) rankSumRight += avgRank;
    i = j;
  }
  return (rankSumRight - (right.length * (right.length + 1)) / 2) / (right.length * wrong.length);
}

interface Scored {
  label: JudgeLabel;
  row: CalibrationRow;
}

export function calibrateJudge(labels: readonly JudgeLabel[], rows: readonly CalibrationRow[]): JudgeCalibration {
  const { matched, unmatched } = matchLabels(labels, rows);
  const answered = matched.filter((m) => m.row.completion_state === "success");
  const graded = answered.filter((m) => m.row.task_outcome === "success" || m.row.task_outcome === "failure");
  const agree = graded.filter((m) => (m.row.task_outcome === "success") === (m.label.label === "right")).length;
  const groupNames = [...new Set(answered.flatMap((m) => (m.label.group === undefined ? [] : [m.label.group])))];
  return {
    labels: labels.length,
    matched: matched.length,
    unmatched,
    noAnswer: matched.length - answered.length,
    check: { agree, disagree: graded.length - agree },
    measures: measuresOf(answered),
    groups: groupNames.map((group) => {
      const own = answered.filter((m) => m.label.group === group);
      return { group, labels: own.length, measures: measuresOf(own) };
    }),
  };
}

/* ── matching labels to rows ─────────────────────────────────────────────── */

const where = (l: JudgeLabel): string => (l.line === undefined ? `label ${l.candidate} on ${l.input}` : `labels line ${l.line}`);

function matchLabels(labels: readonly JudgeLabel[], rows: readonly CalibrationRow[]): { matched: Scored[]; unmatched: JudgeLabel[] } {
  const byPair = new Map<string, CalibrationRow[]>();
  for (const r of rows) {
    const key = `${r.candidate}\0${r.input}`;
    byPair.set(key, [...(byPair.get(key) ?? []), r]);
  }
  const seen = new Map<string, JudgeLabel>();
  const matched: Scored[] = [];
  const unmatched: JudgeLabel[] = [];
  for (const label of labels) {
    const candidates = byPair.get(`${label.candidate}\0${label.input}`) ?? [];
    if (label.trial === undefined && candidates.length > 1) {
      throw new LabelError(`${where(label)}: ${label.candidate} has ${candidates.length} trials on ${label.input} in this run; say which with "trial"`);
    }
    const row = label.trial === undefined ? candidates[0] : candidates.find((r) => r.trial === label.trial);
    if (!row) {
      unmatched.push(label);
      continue;
    }
    const key = `${row.candidate}\0${row.input}\0${row.trial}`;
    const earlier = seen.get(key);
    if (earlier) {
      if (earlier.label !== label.label) throw new LabelError(`${where(label)} calls ${label.candidate} on ${label.input} ${label.label}, but ${where(earlier)} calls it ${earlier.label}`);
      continue; // the same label twice
    }
    seen.set(key, label);
    matched.push({ label, row });
  }
  return { matched, unmatched };
}

/* ── one score at a time ─────────────────────────────────────────────────── */

function measuresOf(answered: readonly Scored[]): MeasureCalibration[] {
  const dims = [...new Set(answered.flatMap((m) => Object.keys(m.row.judge?.absolute_dimensions ?? {})))];
  const overall = measure("overall", answered, (r) => r.judge?.absolute_overall ?? null);
  return [overall, ...dims.map((d) => measure(d, answered, (r) => r.judge?.absolute_dimensions?.[d] ?? null))];
}

function distribution(scores: readonly number[]): ScoreDistribution {
  const counts: Record<string, number> = {};
  for (const s of [...scores].sort((x, y) => x - y)) counts[String(s)] = (counts[String(s)] ?? 0) + 1;
  return { n: scores.length, mean: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, counts };
}

function measure(name: string, answered: readonly Scored[], scoreOf: (r: CalibrationRow) => number | null): MeasureCalibration {
  const scored = answered.flatMap((m) => {
    const s = scoreOf(m.row);
    return s === null ? [] : [{ input: m.row.input, right: m.label.label === "right", s }];
  });
  const right = scored.filter((x) => x.right).map((x) => x.s);
  const wrong = scored.filter((x) => !x.right).map((x) => x.s);
  const point = auc(right, wrong);
  const interval = point === null ? null : resampledInterval(scored);
  return {
    measure: name,
    right: distribution(right),
    wrong: distribution(wrong),
    unscored: answered.length - scored.length,
    auc: point,
    interval,
    wrongAtTop: wrong.filter((s) => s >= TOP_SCORE).length,
    verdict: verdictOf(right.length, wrong.length, interval),
  };
}

function verdictOf(nRight: number, nWrong: number, interval: { low: number; high: number } | null): CalibrationVerdict {
  if (nRight < MIN_LABELS_PER_SIDE || nWrong < MIN_LABELS_PER_SIDE || interval === null) return "too-few";
  if (interval.low > 0.5) return "separates";
  if (interval.high < 0.5) return "backwards";
  return "does-not-separate";
}

/** 95% percentile interval of the AUC, resampling inputs with replacement. */
function resampledInterval(scored: ReadonlyArray<{ input: string; right: boolean; s: number }>): { low: number; high: number } | null {
  const byInput = new Map<string, Array<{ right: boolean; s: number }>>();
  for (const x of scored) byInput.set(x.input, [...(byInput.get(x.input) ?? []), x]);
  const inputs = [...byInput.values()];
  const random = mulberry32(SEED);
  const aucs: number[] = [];
  for (let b = 0; b < RESAMPLES; b++) {
    const right: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < inputs.length; i++) {
      for (const x of inputs[Math.floor(random() * inputs.length)]!) (x.right ? right : wrong).push(x.s);
    }
    const a = auc(right, wrong);
    if (a !== null) aucs.push(a);
  }
  if (aucs.length === 0) return null;
  aucs.sort((x, y) => x - y);
  const at = (q: number) => aucs[Math.min(aucs.length - 1, Math.max(0, Math.round(q * (aucs.length - 1))))]!;
  return { low: at(0.025), high: at(0.975) };
}

/** A small seeded PRNG, so the interval is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
