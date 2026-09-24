/**
 * The report's state tones, decided once in report-format.ts for both
 * renderers, as dashboard meaning colours; and its series colours.
 */

import { stateTone } from "../../../../report-format.js";

/** A protocol state's tone for a `Tag`: ok / warn / bad. */
export function tagTone(state: string): "ok" | "warn" | "bad" {
  return stateTone(state);
}

/** Categorical series colour by slot — follows the candidate, never its rank. */
export const SERIES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"] as const;

/**
 * A candidate's colour. Only three hues are validated; a fourth candidate is
 * drawn in neutral ink rather than given a colour that repeats the first
 * one's, which would read as the same candidate.
 */
export function seriesColor(slot: number | undefined): string {
  return slot !== undefined && slot < SERIES.length ? SERIES[slot] : "var(--muted-foreground)";
}
