/**
 * Shared chart helpers. Scores are always drawn on the same 1–5 scale the
 * offline report uses, and the diverging tint is the same function.
 */

import type { CSSProperties } from "react";
import { SCORE_MAX, SCORE_MIN, heatTint } from "../../../../../report-format.js";

/** Clamp a score into 1–5 and map it onto `[0, span]`. */
export function scale(score: number, span: number): number {
  const clamped = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));
  return ((clamped - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * span;
}

/** `heatTint` returns a CSS declaration for the string renderer; React wants an object. */
export function tintStyle(value: number | null, min: number, max: number): CSSProperties | undefined {
  const css = heatTint(value, min, max);
  return css ? { background: css.slice("background:".length) } : undefined;
}

export const TICKS = [1, 2, 3, 4, 5] as const;
