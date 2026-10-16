/**
 * Results per slice of the test set: for each input tag and each split, how
 * many of each candidate's graded trials passed the required check. A pass
 * rate over thirty inputs hides that one candidate fails every hard case; a
 * slice shows it. Ungraded trials (an evaluator error, a check that never
 * ran) are left out of both counts, as the pass rate leaves them out.
 */

import type { InputLabels } from "./canon/about.js";
import type { TrialRow } from "./canon/rows.js";

export interface SliceRow {
  /** A tag, or "split: <name>". */
  label: string;
  /** Inputs in this slice. */
  inputs: number;
  cells: Record<string, { pass: number; graded: number }>;
}

const GRADED = new Set(["pass", "fail"]);

/** Slices in the order their tags first appear in the labels, then the splits. */
export function sliceRows(labels: InputLabels | null, trials: readonly TrialRow[], candidates: readonly string[], checkId: string | null): SliceRow[] {
  if (!labels || !checkId) return [];
  const members = new Map<string, Set<string>>();
  const add = (label: string, input: string) => {
    if (!members.has(label)) members.set(label, new Set());
    members.get(label)!.add(input);
  };
  for (const [input, l] of Object.entries(labels)) for (const t of l.tags) add(t, input);
  for (const [input, l] of Object.entries(labels)) if (l.split) add(`split: ${l.split}`, input);

  return [...members].map(([label, inputs]) => {
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
