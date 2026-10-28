/**
 * Small-sample statistics behind "firm" (Layer 7).
 *
 * Task sets here are tens to a few hundred inputs, where normal-approximation
 * error bars run too narrow (Bowyer et al., ICML 2025). So:
 *
 *   one rate      Wilson 95% interval — stays calibrated near 0% and 100%
 *   A versus B    exact two-sided sign test over inputs. Trials collapse to a
 *                 per-input success rate first, so the input is the unit and
 *                 repeated trials of one input cannot pose as independent
 *                 evidence. Inputs where both did equally well say nothing and
 *                 drop out; precision comes from the inputs that differ.
 *                 Under judge-preference the same test runs on the judge's
 *                 pairwise verdicts per input instead of task success.
 *
 * Pure functions; nothing here reads a spec or calls a model.
 */

import type { TrialRow } from "./rows.js";

/** Two-sided significance level for every firm claim. */
export const SIGNIFICANCE = 0.05;
const Z_95 = 1.959964;

/**
 * Fewest differing inputs, all going one way, that an exact two-sided sign
 * test calls significant at 0.05 (6–0 gives p = 0.031; 5–0 gives 0.0625).
 */
export const MIN_DIFFERING_INPUTS = 6;

/** A p-value as reports print it. */
export function fmtP(p: number): string {
  return p < 0.001 ? "< 0.001" : p.toFixed(3);
}

/** Does an interval's low end clear a gate? (Float-tolerant, as the gates are.) */
export function clearsGate(low: number, gate: number): boolean {
  return low + 1e-12 >= gate;
}

export interface Interval {
  low: number;
  high: number;
}

export function wilson(successes: number, trials: number, z = Z_95): Interval | null {
  if (trials <= 0) return null;
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** P(X ≤ k) for X ~ Binomial(n, 1/2). */
function binomialHalfCdf(k: number, n: number): number {
  let term = Math.pow(0.5, n);
  let sum = term;
  for (let i = 1; i <= k; i++) {
    term = (term * (n - i + 1)) / i;
    sum += term;
  }
  return sum;
}

/** Exact two-sided sign test on the inputs one side won and the other won. */
export function signTestP(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  return Math.min(1, 2 * binomialHalfCdf(Math.min(wins, losses), n));
}

/** What a paired comparison counted: task success, or the judge's pairwise verdicts. */
export type ComparisonBasis = "task-success" | "judge";

export interface PairedComparison {
  a: string;
  b: string;
  /** Absent in recommendations written before the judge basis existed: task success. */
  basis?: ComparisonBasis;
  /** Inputs where both have at least one classified trial. */
  compared: number;
  a_better: number;
  b_better: number;
  same: number;
  p_value: number;
  significant: boolean;
}

/** Per input: classified trials' success rate (undetermined trials left out). */
function successByInput(rows: readonly TrialRow[], candidate: string): Map<string, number> {
  const tally = new Map<string, { ok: number; n: number }>();
  for (const r of rows) {
    if (r.candidate !== candidate) continue;
    if (r.task_outcome !== "success" && r.task_outcome !== "failure") continue;
    const t = tally.get(r.input) ?? { ok: 0, n: 0 };
    tally.set(r.input, { ok: t.ok + (r.task_outcome === "success" ? 1 : 0), n: t.n + 1 });
  }
  return new Map([...tally].map(([input, t]) => [input, t.ok / t.n]));
}

export function pairByInput(rows: readonly TrialRow[], a: string, b: string): PairedComparison {
  const ra = successByInput(rows, a);
  const rb = successByInput(rows, b);
  let aBetter = 0;
  let bBetter = 0;
  let same = 0;
  for (const [input, va] of ra) {
    const vb = rb.get(input);
    if (vb === undefined) continue;
    if (va > vb) aBetter += 1;
    else if (vb > va) bBetter += 1;
    else same += 1;
  }
  return paired(a, b, "task-success", aBetter, bBetter, same);
}

/**
 * The judge's verdicts between a and b, input by input. A verdict is recorded
 * on both sides' rows, so only a's rows are read; several verdicts on one
 * input (repeated trials) net out to one vote for that input.
 */
export function judgePairByInput(rows: readonly TrialRow[], a: string, b: string): PairedComparison {
  const net = new Map<string, number>();
  for (const r of rows) {
    if (r.candidate !== a) continue;
    for (const d of r.judge.pairwise ?? []) {
      if (d.vs !== b) continue;
      const vote = d.resolved === "win" ? 1 : d.resolved === "loss" ? -1 : 0;
      net.set(r.input, (net.get(r.input) ?? 0) + vote);
    }
  }
  const votes = [...net.values()];
  const aBetter = votes.filter((v) => v > 0).length;
  const bBetter = votes.filter((v) => v < 0).length;
  return paired(a, b, "judge", aBetter, bBetter, votes.length - aBetter - bBetter);
}

function paired(a: string, b: string, basis: ComparisonBasis, aBetter: number, bBetter: number, same: number): PairedComparison {
  const p = signTestP(aBetter, bBetter);
  return {
    a,
    b,
    basis,
    compared: aBetter + bBetter + same,
    a_better: aBetter,
    b_better: bBetter,
    same,
    p_value: p,
    significant: p < SIGNIFICANCE,
  };
}

/**
 * Fewest inputs at which a candidate that passes every one of them clears
 * `gate` at the low end of its Wilson interval (n / (n + z²) ≥ gate). Null
 * for a gate of 1, which no finite sample clears.
 */
export function inputsToClearGate(gate: number): number | null {
  if (gate >= 1) return null;
  if (gate <= 0) return 1;
  return Math.ceil((Z_95 * Z_95 * gate) / (1 - gate));
}

/**
 * Best case for a paired comparison on `inputs` inputs: the smallest gap in
 * success rate that can come out significant, reached only when every
 * differing input goes the same way. Real gaps need more. Null below
 * MIN_DIFFERING_INPUTS inputs, where no gap can.
 */
export function minDetectableGap(inputs: number): number | null {
  return inputs < MIN_DIFFERING_INPUTS ? null : MIN_DIFFERING_INPUTS / inputs;
}
