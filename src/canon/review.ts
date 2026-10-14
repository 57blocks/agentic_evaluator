/**
 * Human review, the pure part (docs/design/human-review.md).
 *
 * A reviewer compares two candidates' answers to one input, blind, and says
 * which is better overall and per dimension. Everything here is a function
 * of rows; the server does the I/O. Verdicts are evidence that informs and
 * never decides: they live beside `evaluations`, under their own evaluator
 * id, so nothing that selects a candidate reads them.
 */

import { sha256, short } from "./hash.js";
import type { EvaluationRow, TrialRow } from "./rows.js";

export { matchesShow } from "./show.js";

export const HUMAN_PAIRWISE = "human-pairwise";

/** What a reviewer can say about a pair, in canonical (a, b) orientation. */
export type HumanVerdict = "a" | "b" | "tie" | "both_bad";
/** What a reviewer says on screen: which side, not which candidate. */
export type ScreenVerdict = "left" | "right" | "tie" | "both_bad";

/** One pair to review: two candidates' answers to one input, ids sorted. */
export interface ReviewItem {
  input: string;
  a: string;
  b: string;
  trialA: number;
  trialB: number;
}

/** Which canonical side is shown on the left, for one reviewer and pair. */
export interface BlindLayout {
  left: "a" | "b";
  seed: number;
}

/** A verdict as stored: an evaluation row plus who gave it and what they saw. */
export interface ReviewRow extends EvaluationRow {
  kind: "verdict";
  reviewer: string;
  /** The candidate the reviewer saw on the left, so position bias stays measurable. */
  shown_as: { left: string };
  seed: number;
  at: string;
}

/** Unblinding: after it, that reviewer's verdicts on the run are read-only. */
export interface RevealEntry {
  kind: "reveal";
  reviewer: string;
  at: string;
}

export type ReviewEntry = ReviewRow | RevealEntry;

/**
 * The first trial per candidate and input that completed (and, unless asked,
 * passed its required check): the same choice the judge makes, so human and
 * judge verdicts are about the same answers.
 */
function reviewable(trials: readonly TrialRow[], includeFailed: boolean): Map<string, Map<string, number>> {
  const byInput = new Map<string, Map<string, number>>();
  const sorted = [...trials].sort((x, y) => x.trial - y.trial);
  for (const t of sorted) {
    if (t.completion_state !== "success") continue;
    if (!includeFailed && t.task_outcome !== "success") continue;
    const cands = byInput.get(t.input) ?? new Map<string, number>();
    if (!cands.has(t.candidate)) cands.set(t.candidate, t.trial);
    byInput.set(t.input, cands);
  }
  return byInput;
}

export function reviewQueue(trials: readonly TrialRow[], opts: { includeFailed?: boolean } = {}): ReviewItem[] {
  const out: ReviewItem[] = [];
  const byInput = reviewable(trials, opts.includeFailed === true);
  for (const input of [...byInput.keys()].sort()) {
    const cands = byInput.get(input)!;
    const ids = [...cands.keys()].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        out.push({ input, a: ids[i], b: ids[j], trialA: cands.get(ids[i])!, trialB: cands.get(ids[j])! });
      }
    }
  }
  return out;
}

const pairKey = (item: Pick<ReviewItem, "input" | "a" | "b">): string => `${item.input}\u0000${item.a}\u0000${item.b}`;

/** An opaque, stable id for a pair: what the browser sees instead of candidate ids. */
export function pairId(run: string, item: Pick<ReviewItem, "input" | "a" | "b">): string {
  return short(sha256(`${run}\u0000${pairKey(item)}`));
}

/** Left/right for this reviewer and pair: random across reviewers, fixed on resume. */
export function blindLayout(run: string, reviewer: string, item: Pick<ReviewItem, "input" | "a" | "b">): BlindLayout {
  const seed = parseInt(sha256(`${run}\u0000${reviewer}\u0000${pairKey(item)}`).slice(0, 8), 16);
  return { left: seed % 2 === 0 ? "a" : "b", seed };
}

/** Turn what the reviewer clicked (left/right) into a canonical a/b verdict. */
function fromScreen(v: ScreenVerdict, layout: BlindLayout): HumanVerdict {
  if (v === "tie" || v === "both_bad") return v;
  const right = layout.left === "a" ? "b" : "a";
  return v === "left" ? layout.left : right;
}

export function verdictRow(params: {
  run: string;
  step: string;
  rubricSha: string;
  reviewer: string;
  item: ReviewItem;
  layout: BlindLayout;
  overall: ScreenVerdict;
  dimensions?: Record<string, ScreenVerdict>;
  note?: string;
  at?: string;
}): ReviewRow {
  const { item, layout } = params;
  const dimensions = Object.fromEntries(
    Object.entries(params.dimensions ?? {}).map(([k, v]) => [k, fromScreen(v, layout)]),
  );
  return {
    kind: "verdict",
    run: params.run,
    step: params.step,
    evaluator: HUMAN_PAIRWISE,
    version: `rubric-${short(params.rubricSha)}`,
    state: "pass",
    subject: { kind: "pair", a: item.a, b: item.b, input: item.input },
    ...(Object.keys(dimensions).length > 0 ? { dimensions: dimensions as EvaluationRow["dimensions"] } : {}),
    overall: fromScreen(params.overall, layout) as EvaluationRow["overall"],
    ...(params.note ? { evidence: params.note } : {}),
    reviewer: params.reviewer,
    shown_as: { left: layout.left === "a" ? item.a : item.b },
    seed: layout.seed,
    at: params.at ?? new Date().toISOString(),
  };
}

/** The latest verdict per (reviewer, pair); earlier ones stay in the file as history. */
export function latestVerdicts(entries: readonly ReviewEntry[]): ReviewRow[] {
  const last = new Map<string, ReviewRow>();
  for (const e of entries) {
    if (e.kind !== "verdict" || e.subject.kind !== "pair") continue;
    last.set(`${e.reviewer}\u0000${pairKey(e.subject)}`, e);
  }
  return [...last.values()];
}

export interface HumanRecord {
  wins: number;
  losses: number;
  ties: number;
  comparisons: number;
  /** Win rate, 0–100, a tie (or both_bad) counting half; null with no comparisons. */
  rate: number | null;
}

export function humanRecord(candidate: string, rows: readonly EvaluationRow[]): HumanRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const r of rows) {
    if (r.evaluator !== HUMAN_PAIRWISE || r.subject.kind !== "pair") continue;
    const { a, b } = r.subject;
    if (a !== candidate && b !== candidate) continue;
    const side = a === candidate ? "a" : "b";
    const overall = r.overall as HumanVerdict;
    if (overall === side) wins += 1;
    else if (overall === "a" || overall === "b") losses += 1;
    else ties += 1;
  }
  const comparisons = wins + losses + ties;
  return { wins, losses, ties, comparisons, rate: comparisons > 0 ? ((wins + ties / 2) / comparisons) * 100 : null };
}

/** A verdict read in the (a, b) orientation of a given pair; both_bad compares as tie. */
function oriented(v: unknown, flipped: boolean): "a" | "b" | "tie" {
  if (v === "a") return flipped ? "b" : "a";
  if (v === "b") return flipped ? "a" : "b";
  return "tie";
}

export interface Agreement {
  overall: { agree: number; total: number };
  dimensions: Record<string, { agree: number; total: number }>;
}

/**
 * How often the judge said what the human said, over pairs both judged, per
 * dimension where both gave a verdict. The judge may store a pair either way
 * round; it is read in the human row's orientation.
 */
export function judgeAgreement(human: readonly EvaluationRow[], judge: readonly EvaluationRow[]): Agreement {
  const out: Agreement = { overall: { agree: 0, total: 0 }, dimensions: {} };
  for (const h of human) {
    if (h.evaluator !== HUMAN_PAIRWISE || h.subject.kind !== "pair") continue;
    const hs = h.subject;
    const j = judge.find(
      (r) =>
        r.evaluator === "pairwise-swap" && r.state === "pass" && r.subject.kind === "pair" && r.subject.input === hs.input &&
        ((r.subject.a === hs.a && r.subject.b === hs.b) || (r.subject.a === hs.b && r.subject.b === hs.a)),
    );
    if (!j || j.subject.kind !== "pair") continue;
    const flipped = j.subject.a !== hs.a;
    if (h.overall !== undefined && j.overall !== undefined) {
      out.overall.total += 1;
      if (oriented(h.overall, false) === oriented(j.overall, flipped)) out.overall.agree += 1;
    }
    for (const [dim, hv] of Object.entries(h.dimensions ?? {})) {
      const jv = j.dimensions?.[dim];
      if (jv === undefined) continue;
      const cell = out.dimensions[dim] ?? { agree: 0, total: 0 };
      cell.total += 1;
      if (oriented(hv, false) === oriented(jv, flipped)) cell.agree += 1;
      out.dimensions[dim] = cell;
    }
  }
  return out;
}
