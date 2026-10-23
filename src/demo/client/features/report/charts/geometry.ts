/**
 * Shared chart helpers: the diverging tint is the same function the offline
 * report uses.
 */

import type { CSSProperties } from "react";
import { heatTint } from "../../../../../report-format.js";

/** `heatTint` returns a CSS declaration for the string renderer; React wants an object. */
export function tintStyle(value: number | null, min: number, max: number): CSSProperties | undefined {
  const css = heatTint(value, min, max);
  return css ? { background: css.slice("background:".length) } : undefined;
}

