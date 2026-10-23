/**
 * The formatting and fixed wording both report renderers share, with no
 * Node imports — the dashboard's browser bundle imports this file directly,
 * so a cost, a percentage or a "needs review" sentence is spelled by the same
 * function on the offline page and in the dashboard.
 */

export const fmtUsd = (v: number | null | undefined): string => (v == null ? "—" : `$${v.toFixed(4)}`);
/** A cost cell: "unobserved" when the spend was never reported, never "$0". */
export const fmtCost = (v: number | null | undefined, observed: boolean): string => (observed ? fmtUsd(v) : "unobserved");
export const fmtPct = (v: number | null | undefined): string => (v == null ? "—" : `${v.toFixed(0)}%`);
export const fmtScore = (v: number | null | undefined): string => (v == null ? "—" : v.toFixed(1));
export const fmtSec = (ms: number | null | undefined): string => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);
/** "1 input", "2 inputs"; a non-numeric count (e.g. "—") keeps the plural. */
export const plural = (n: number | string, noun: string): string => `${n} ${n === 1 ? noun : `${noun}s`}`;
export const sha8 = (s: string | null | undefined): string => (s ? s.slice(0, 8) : "—");

/** Protocol state → the three tones both pages colour by. */
export function stateTone(state: string): "ok" | "warn" | "bad" {
  if (state === "success" || state === "pass") return "ok";
  if (state === "undetermined" || state === "not_evaluated" || state === "evaluator_error") return "warn";
  return "bad";
}

/**
 * Diverging tint around a midpoint: blue above, red below, stronger the
 * further from the middle — the same poles as the score bars. A solid ramp says "big number"; this says "better
 * or worse than the middle", which is what a grade or a win rate means.
 */
const TINT_MIN_ALPHA = 0.08;
const TINT_MAX_ALPHA = 0.7;

export function heatTint(value: number | null, min: number, max: number): string {
  if (value === null) return "";
  const mid = (min + max) / 2;
  const dist = Math.min(1, Math.abs(value - mid) / ((max - min) / 2));
  // 0.08 at the midpoint up to 0.7 at the ends: strong enough that 4.0 and 4.9
  // read as different, light enough that ink text keeps ≥ 4.5:1 in both themes.
  const alpha = (TINT_MIN_ALPHA + dist * (TINT_MAX_ALPHA - TINT_MIN_ALPHA)).toFixed(3);
  return `background:rgba(${value >= mid ? "42,120,214" : "201,58,57"},${alpha})`;
}

/** Absolute scores run 1–5 on both pages. */
export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

/** A step that ran and did not produce a recommendation — why is said where it is known. */
export const NO_PICK = "no recommendation";

/** Candidates that are local scripts: they prove the pipeline runs, not that a model is good. */
export const SELF_CHECK = "self-check";

/** Said on the workflow page when there is no §8 verdict. */
export const STEPS_NOT_VALIDATED = "Each recommendation is per step; none has been validated as a workflow.";

/**
 * The workflow verdict's headline: how many steps have a pick, and what still
 * needs a person. `unreadable` counts step reports that could not be read —
 * counted, never dropped, so a missing step cannot make the tally look clean.
 */
export function stepsHeadline(steps: ReadonlyArray<{ chosen: string | null }>, unreadable = 0): string {
  const total = steps.length + unreadable;
  const picked = steps.filter((s) => s.chosen).length;
  const open = steps.length - picked;
  if (open === 0 && unreadable === 0) return `Every step has a recommendation (${picked} of ${total})`;
  const tail = [
    open > 0 ? `${open} ${open === 1 ? "needs" : "need"} review` : "",
    unreadable > 0 ? `${plural(unreadable, "report")} could not be read` : "",
  ].filter(Boolean);
  return [`${picked} of ${total} steps have a recommendation`, ...tail].join(" · ");
}
