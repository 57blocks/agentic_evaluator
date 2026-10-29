/**
 * The same input, every candidate's answer beside the others. Pure: the
 * dashboard client imports it, so nothing here may reach for node.
 */

import type { RawOutput } from "./report-evidence.js";

/** One input's outputs, one cell per candidate, so the texts can be read against each other. */
export interface SideBySideRow {
  input: string;
  cells: Array<{ candidate: string; output: RawOutput | null }>;
}

/** Inputs shown side by side before the rest are left to the raw-output list: 300 inputs × 8 candidates is not a page. */
export const SIDE_BY_SIDE_MAX_INPUTS = 12;

/**
 * The first trial of every candidate on every input; a candidate with no raw
 * output gets an empty cell. Derived by each renderer from `outputs` rather
 * than stored on the model: storing it would carry every text twice.
 */
export function sideBySideOf(outputs: readonly RawOutput[], candidates: readonly string[]): SideBySideRow[] {
  const inputs = [...new Set(outputs.map((o) => o.input))];
  return inputs.map((input) => ({
    input,
    cells: candidates.map((candidate) => {
      const own = outputs.filter((o) => o.input === input && o.candidate === candidate).sort((x, y) => x.trial - y.trial);
      return { candidate, output: own[0] ?? null };
    }),
  }));
}
