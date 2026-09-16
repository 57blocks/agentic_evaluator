/**
 * Cost ledger (protocol §3, cost accounting) — six components kept separate,
 * every figure traceable to rows, estimated figures labeled.
 *
 * Judging is routinely more expensive than generation; hiding it inside a
 * per-candidate "avg cost" is exactly the survivorship the protocol forbids.
 */

import type { EvaluationRow, TrialRow } from "./rows.js";
import type { CostSource } from "./types.js";
import { mergeCostSource } from "./usage.js";

export interface CostLedger {
  generation: number;
  judging: number;
  scoring: number;
  checks: number;
  retries: number;
  total: number;
  /** Merged provenance: estimated if any component was estimated. */
  source: CostSource;
  /** Number of successful task outcomes; cost per success is undefined at 0. */
  successes: number;
  cost_per_success: number | null;
  cost_per_attempt: number | null;
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export function buildLedger(
  trials: readonly TrialRow[],
  evaluations: readonly EvaluationRow[],
  pairwiseId: string,
  absoluteId: string,
): CostLedger {
  const generation = trials.reduce((s, t) => s + t.cost.generation, 0);
  const judgingRows = evaluations.filter((e) => e.evaluator === pairwiseId && e.cost);
  const scoringRows = evaluations.filter((e) => e.evaluator === absoluteId && e.cost);
  const judging = judgingRows.reduce((s, e) => s + (e.cost?.usd ?? 0), 0);
  const scoring = scoringRows.reduce((s, e) => s + (e.cost?.usd ?? 0), 0);
  const retries = evaluations.reduce((s, e) => s + (e.cost?.retry_usd ?? 0), 0);
  const total = generation + judging + scoring + retries;
  const successes = trials.filter((t) => t.task_outcome === "success").length;
  const sources: CostSource[] = [
    ...trials.map((t) => t.cost.source),
    ...evaluations.filter((e) => e.cost).map((e) => e.cost!.source),
  ];
  return {
    generation: round(generation),
    judging: round(judging),
    scoring: round(scoring),
    checks: 0,
    retries: round(retries),
    total: round(total),
    source: mergeCostSource(sources),
    successes,
    cost_per_success: successes > 0 ? round(total / successes) : null,
    cost_per_attempt: trials.length > 0 ? round(total / trials.length) : null,
  };
}
