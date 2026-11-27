/**
 * Results per slice of the test set: for each input tag and each split, how
 * many of each candidate's graded trials passed the required check. A pass
 * rate over thirty inputs hides that one candidate fails every hard case; a
 * slice shows it. Ungraded trials (an evaluator error, a check that never
 * ran) are left out of both counts, as the pass rate leaves them out.
 * The check's measures (canon/measures.ts) are sliced the same way, with
 * every input as the first slice.
 */

import type { InputLabels } from "./canon/about.js";
import type { TrialRow } from "./canon/rows.js";
import { measureNames, measureStats, type MeasureRow, type MeasureStats } from "./canon/measures.js";

export interface SliceRow {
  /** A tag, or "split: <name>". */
  label: string;
  /** Inputs in this slice. */
  inputs: number;
  cells: Record<string, { pass: number; graded: number }>;
}

const GRADED = new Set(["pass", "fail"]);

/** Each tag's inputs, in the order tags first appear in the labels, then each split's as "split: <name>". */
export function sliceMembers(labels: InputLabels | null): Array<[string, Set<string>]> {
  if (!labels) return [];
  const members = new Map<string, Set<string>>();
  const add = (label: string, input: string) => {
    if (!members.has(label)) members.set(label, new Set());
    members.get(label)!.add(input);
  };
  for (const [input, l] of Object.entries(labels)) for (const t of l.tags) add(t, input);
  for (const [input, l] of Object.entries(labels)) if (l.split) add(`split: ${l.split}`, input);
  return [...members];
}

/** Slices in the order their tags first appear in the labels, then the splits. */
export function sliceRows(labels: InputLabels | null, trials: readonly TrialRow[], candidates: readonly string[], checkId: string | null): SliceRow[] {
  if (!labels || !checkId) return [];
  return sliceMembers(labels).map(([label, inputs]) => {
    const cells = Object.fromEntries(candidates.map((c) => [c, { pass: 0, graded: 0 }]));
    for (const t of trials) {
      const state = t.checks?.[checkId]?.state;
      const cell = cells[t.candidate];
      if (!cell || !inputs.has(t.input) || !state || !GRADED.has(state)) continue;
      cell.graded++;
      if (state === "pass") cell.pass++;
    }
    return { label, inputs: inputs.size, cells };
  });
}

/** One slice of the check's measures: "all" inputs, a tag, or "split: <name>". */
export interface MeasureSliceRow {
  label: string;
  /** Inputs in this slice (with trials in the run, for "all"). */
  inputs: number;
  /** Per candidate, each measure its graded trials reported on this slice's inputs (canon/measures.ts). */
  byCandidate: Record<string, MeasureStats>;
}

/**
 * The check's measures per candidate, over every input and then per tag and
 * split. Empty when no graded trial reported a measure, so a run from before
 * measures shows nothing new.
 */
export function measureSlices(labels: InputLabels | null, trials: readonly MeasureRow[], candidates: readonly string[]): MeasureSliceRow[] {
  if (measureNames(trials).length === 0) return [];
  const all: [string, Set<string> | undefined][] = [["all", undefined]];
  return [...all, ...sliceMembers(labels)].map(([label, inputs]) => ({
    label,
    inputs: inputs?.size ?? new Set(trials.map((t) => t.input)).size,
    byCandidate: Object.fromEntries(candidates.map((c) => [c, measureStats(trials, c, inputs)])),
  }));
}
