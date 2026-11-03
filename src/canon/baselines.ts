/**
 * Baseline selection rules, replayed on a finished run (paper experiment 2).
 *
 * The protocol gates first and optimizes second (select.ts). The rules here
 * are what the literature does instead — rank on average quality, blend
 * quality with cost, or take the cheapest model "close enough" to the best —
 * and none of them looks at a gate. Each pick is then held against the gated
 * recommendation's own filters, so "this rule chose a candidate that fails a
 * required check" is read off the frozen eligibility, not re-decided here.
 *
 *   leaderboard        highest task-success rate; ties go to the cheaper
 *   weighted λ         max  success − λ · cost / most expensive cost
 *                      (one λ is a cherry-pick, so several are replayed)
 *   within q of best   cheapest candidate whose success ≥ q · best success,
 *                      the cost-quality operating point a router is tuned to;
 *                      no router is trained, so it is named for what it is
 *
 * Quality is the task-success rate (success / classified): the measured
 * outcome, never a judge score. So where candidates tie on it, the baselines
 * break the tie on cost while highest-assurance breaks it on the judge — the
 * gated pick's own reason is carried along to say which happened. A candidate
 * whose rate or cost is undefined is left out of the rules that need it, and
 * said so — never ranked as 0.
 */

import type { CandidateRates } from "./rates.js";
import type { Recommendation } from "./select.js";

export const BASELINES_RULE_VERSION = "baselines-v1" as const;

export const WEIGHTED_LAMBDAS: readonly number[] = [0.25, 0.5, 1];
export const QUALITY_TARGETS: readonly number[] = [0.9, 0.95];

export interface FailedGate {
  /** The gated recommendation's filter id, e.g. `required-check-pass-rate`. */
  gate: string;
  reason: string;
}

export interface BaselinePick {
  rule: string;
  description: string;
  chosen: string | null;
  reason: string;
  /** Where the gated rule removed this pick; empty when the pick is eligible. */
  failed_gates: FailedGate[];
}

export interface BaselineComparison {
  rule_version: typeof BASELINES_RULE_VERSION;
  /** `reason`: why the selector picked what it did, as the run's recommendation says it. */
  gated: { chosen: string | null; eligible: string[]; reason: string | null };
  picks: BaselinePick[];
}

interface Ranked {
  candidate: string;
  success: number;
  cost: number | null;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const usd = (x: number | null): string => (x === null ? "undefined" : `$${x}`);

function rankable(candidates: readonly CandidateRates[]): { ranked: Ranked[]; unrated: string[] } {
  const ranked = candidates
    .filter((c) => c.task_success_rate.value !== null)
    .map((c) => ({ candidate: c.candidate, success: c.task_success_rate.value!, cost: c.generation_cost_per_success }));
  const unrated = candidates.filter((c) => c.task_success_rate.value === null).map((c) => c.candidate).sort();
  return { ranked, unrated };
}

/** Lower cost first, unknown cost last, then id — so a tie never depends on input order. */
function byCostThenId(a: Ranked, b: Ranked): number {
  const ca = a.cost ?? Number.POSITIVE_INFINITY;
  const cb = b.cost ?? Number.POSITIVE_INFINITY;
  return ca !== cb ? ca - cb : a.candidate.localeCompare(b.candidate);
}

function leftOut(label: string, ids: readonly string[]): string {
  return ids.length > 0 ? `; left out, ${label}: ${ids.join(", ")}` : "";
}

function leaderboard(ranked: readonly Ranked[], unrated: readonly string[]): Omit<BaselinePick, "failed_gates"> {
  const rule = "leaderboard";
  const description = "highest task-success rate, cost ignored except to break ties";
  const best = [...ranked].sort((a, b) => b.success - a.success || byCostThenId(a, b))[0];
  if (!best) return { rule, description, chosen: null, reason: "no candidate has a task-success rate" };
  return {
    rule,
    description,
    chosen: best.candidate,
    reason: `success ${pct(best.success)}, cost per success ${usd(best.cost)}${leftOut("no success rate", unrated)}`,
  };
}

function weighted(lambda: number, ranked: readonly Ranked[], unrated: readonly string[]): Omit<BaselinePick, "failed_gates"> {
  const rule = `weighted λ=${lambda}`;
  const description = `max success − ${lambda} × cost per success / the most expensive candidate's`;
  const priced = ranked.filter((r): r is Ranked & { cost: number } => r.cost !== null);
  const unpriced = ranked.filter((r) => r.cost === null).map((r) => r.candidate).sort();
  const maxCost = Math.max(0, ...priced.map((r) => r.cost));
  if (priced.length === 0 || maxCost === 0) {
    return { rule, description, chosen: null, reason: "no candidate has a positive cost per success to weigh" };
  }
  const scored = priced.map((r) => ({ ...r, score: r.success - (lambda * r.cost) / maxCost }));
  const best = [...scored].sort((a, b) => b.score - a.score || byCostThenId(a, b))[0];
  return {
    rule,
    description,
    chosen: best.candidate,
    reason: `score ${best.score.toFixed(3)} (success ${pct(best.success)}, cost per success ${usd(best.cost)})${leftOut("cost per success undefined", unpriced)}${leftOut("no success rate", unrated)}`,
  };
}

function withinOfBest(q: number, ranked: readonly Ranked[], unrated: readonly string[]): Omit<BaselinePick, "failed_gates"> {
  const rule = `within ${pct(q)} of best`;
  const description = `cheapest candidate whose success is at least ${pct(q)} of the best candidate's`;
  const top = Math.max(-1, ...ranked.map((r) => r.success));
  if (top < 0) return { rule, description, chosen: null, reason: "no candidate has a task-success rate" };
  const floor = q * top;
  const close = ranked.filter((r) => r.success + 1e-12 >= floor);
  const pick = [...close].sort(byCostThenId)[0];
  return {
    rule,
    description,
    chosen: pick.candidate,
    reason: `success ${pct(pick.success)} ≥ ${pct(floor)} (best ${pct(top)}), cost per success ${usd(pick.cost)}${leftOut("no success rate", unrated)}`,
  };
}

function failedGates(gated: Recommendation, candidate: string | null): FailedGate[] {
  if (candidate === null) return [];
  return gated.filters.flatMap((f) =>
    f.removed.filter((r) => r.candidate === candidate).map((r) => ({ gate: f.id, reason: r.reason })),
  );
}

/** Replay every baseline rule on one step's rates and check each pick against the gated recommendation. */
export function compareBaselines(gated: Recommendation, candidates: readonly CandidateRates[]): BaselineComparison {
  const { ranked, unrated } = rankable(candidates);
  const picks = [
    leaderboard(ranked, unrated),
    ...WEIGHTED_LAMBDAS.map((l) => weighted(l, ranked, unrated)),
    ...QUALITY_TARGETS.map((q) => withinOfBest(q, ranked, unrated)),
  ].map((p) => ({ ...p, failed_gates: failedGates(gated, p.chosen) }));
  return {
    rule_version: BASELINES_RULE_VERSION,
    gated: { chosen: gated.chosen, eligible: gated.eligible, reason: gated.reasons[0] ?? null },
    picks,
  };
}
