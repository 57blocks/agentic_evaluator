/**
 * The report's sentences, built from structured data.
 *
 * The selector writes its reasons into recommendation.json, and those stay
 * as they are — they are a protocol artifact, read by tools and by audits,
 * terse and machine-shaped. A reader should not get those raw clauses spliced
 * into the page. So every sentence here is rebuilt from the numbers the
 * decision was made on (gates, thresholds, each candidate's rates), and only
 * a reason this file does not recognise falls through verbatim.
 *
 * No Node imports: the dashboard's browser bundle reads this file too.
 */

import type { Recommendation } from "./canon/select.js";
import type { Rate } from "./canon/rates.js";
import type { EligibilityThresholds } from "./canon/types.js";

// ── labels ──────────────────────────────────────────────────────────────────

const MODE_LABEL: Record<string, string> = {
  "lowest-cost": "lowest cost",
  "fastest-within-cost-ceiling": "fastest within cost ceiling",
  "highest-assurance": "highest assurance",
  "judge-preference": "judge preference",
};

export function modeLabel(mode: string | null | undefined): string {
  if (!mode) return "no operating mode declared";
  return MODE_LABEL[mode] ?? mode;
}

const MODE_EXPLAIN: Record<string, string> = {
  "lowest-cost": "Among the candidates that pass every gate, pick the one with the lowest generation cost per success.",
  "fastest-within-cost-ceiling": "Within the cost ceiling, pick the one with the shortest median duration.",
  "highest-assurance": "Pick the highest reliability; break ties on required-check pass rate, then on cost.",
  "judge-preference": "No deterministic check is available, so candidates are ranked by judge preference; the result can be directional at best.",
};

/** What an operating mode does, in one sentence. */
export function modeExplain(mode: string | null | undefined): string {
  if (!mode) return "No operating mode is declared, so no choice is made among eligible candidates.";
  return MODE_EXPLAIN[mode] ?? `Operating mode ${mode}.`;
}

export const FIRMNESS_LABEL: Record<Recommendation["firmness"], string> = {
  firm: "firm",
  directional: "directional",
  "needs-review": "needs review",
};

const COMPLETION_LABEL: Record<string, string> = {
  success: "completed",
  refusal: "refused",
  timeout: "timed out",
  malformed: "malformed output",
  cancelled: "cancelled",
  provider_error: "provider error",
  skipped: "skipped",
};

const OUTCOME_LABEL: Record<string, string> = {
  success: "success",
  failure: "failure",
  undetermined: "undetermined",
};

const EVALUATION_LABEL: Record<string, string> = {
  pass: "pass",
  fail: "fail",
  not_evaluated: "not evaluated",
  evaluator_error: "evaluator error",
};

export const completionLabel = (s: string): string => COMPLETION_LABEL[s] ?? s;
export const outcomeLabel = (s: string): string => OUTCOME_LABEL[s] ?? s;
export const evaluationLabel = (s: string): string => EVALUATION_LABEL[s] ?? s;

// ── numbers in words ─────────────────────────────────────────────────────────

const pct = (v: number): string => `${(v * 100).toFixed(v === 1 || v === 0 ? 0 : 1)}%`;

/** `88.9% (8/9)`, or `n/a (0/0)` when nothing was counted. */
export function rateText(r: Rate): string {
  return r.value === null ? `n/a (${r.numerator}/${r.denominator})` : `${pct(r.value)} (${r.numerator}/${r.denominator})`;
}

const usd = (v: number): string => `$${v.toFixed(4)}`;

const capitalize = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

// ── the gates ────────────────────────────────────────────────────────────────

export interface GateRow {
  label: string;
  removed: Array<{ candidate: string; detail: string }>;
  remaining: string[];
}

function gateLabel(id: string, e: EligibilityThresholds, fallback: string): string {
  switch (id) {
    case "qualifying-success-criteria":
      return "spec declares a required check";
    case "required-check-pass-rate":
      return e.minimum_required_check_pass_rate === null ? fallback : `required-check pass rate ≥ ${pct(e.minimum_required_check_pass_rate)}`;
    case "reliability":
      return e.minimum_reliability === null ? fallback : `reliability ≥ ${pct(e.minimum_reliability)}`;
    case "p95-ceiling":
      return e.maximum_p95_ms === null ? fallback : `p95 duration ≤ ${e.maximum_p95_ms} ms`;
    case "cost-ceiling":
      return e.cost_ceiling_per_success_usd === null ? fallback : `cost per success ≤ $${e.cost_ceiling_per_success_usd}`;
    default:
      return fallback;
  }
}

/**
 * The gates a step will apply, in the order the selector applies them —
 * the same order and the same words the report's gate walkthrough uses afterwards.
 */
export function gateLabels(e: EligibilityThresholds, requiredChecks: readonly string[], mode: string | null | undefined): string[] {
  const ids: string[] = [];
  if (requiredChecks.length === 0 && mode !== "judge-preference") ids.push("qualifying-success-criteria");
  if (e.minimum_required_check_pass_rate !== null) ids.push("required-check-pass-rate");
  if (e.minimum_reliability !== null) ids.push("reliability");
  if (e.maximum_p95_ms !== null) ids.push("p95-ceiling");
  if (mode === "fastest-within-cost-ceiling" && e.cost_ceiling_per_success_usd !== null) ids.push("cost-ceiling");
  return ids.map((id) => gateLabel(id, e, id));
}

function removedDetail(gate: string, candidate: string, rec: Recommendation, fallback: string): string {
  const t = rec.tradeoffs.find((x) => x.candidate === candidate);
  if (!t) return fallback;
  switch (gate) {
    case "qualifying-success-criteria":
      return "spec declares no required check";
    case "required-check-pass-rate":
      return `required check passed ${rateText(t.required_check_pass_rate)}`;
    case "reliability":
      return `reliability ${rateText(t.reliability)}`;
    case "p95-ceiling":
      return t.p95_ms === null ? "p95 duration not measured" : `p95 ${t.p95_ms} ms`;
    case "cost-ceiling":
      return t.generation_cost_per_success === null ? "no successful task, so cost is n/a" : usd(t.generation_cost_per_success);
    default:
      return fallback;
  }
}

/** Each eligibility gate in order: what it asked, who it removed and why, who was left. */
export function gateRows(rec: Recommendation): GateRow[] {
  return rec.filters.map((f) => ({
    label: gateLabel(f.id, rec.eligibility, f.description),
    removed: f.removed.map((r) => ({ candidate: r.candidate, detail: removedDetail(f.id, r.candidate, rec, r.reason) })),
    remaining: f.remaining,
  }));
}

// ── the recommendation ───────────────────────────────────────────────────────

function pickClause(rec: Recommendation): string {
  const chosen = rec.chosen as string;
  const t = rec.tradeoffs.find((x) => x.candidate === chosen);
  const n = rec.eligible.length;
  const among = n > 1 ? `Of the ${n} candidates that pass every gate, ` : "It is the only candidate that passes every gate; ";
  switch (rec.operating_mode) {
    case "lowest-cost":
      return t?.generation_cost_per_success != null
        ? `${among}${chosen} has the lowest generation cost per success (${usd(t.generation_cost_per_success)}). `
        : `${among}${chosen} is picked by lowest cost. `;
    case "fastest-within-cost-ceiling":
      return t?.p50_ms != null
        ? `${among}${chosen} has the shortest median duration (${(t.p50_ms / 1000).toFixed(1)} s). `
        : `${among}${chosen} is picked as fastest within the cost ceiling. `;
    case "highest-assurance":
      return t ? `${among}${chosen} has the highest reliability (${rateText(t.reliability)}). ` : `${among}${chosen} is picked by highest assurance. `;
    case "judge-preference":
      return `This step has no deterministic check to tell right from wrong, so the recommendation reflects only the judge model's preference: ${chosen} is preferred most. `;
    default:
      return `Recommend ${chosen}. `;
  }
}

/** When a cheaper or faster candidate lost to the control on the declared minimum difference. */
function keptControlClause(rec: Recommendation): string {
  const first = rec.reasons[0] ?? "";
  const m = first.match(/^(?:cheapest|fastest) eligible is (\S+)/);
  if (!m || !rec.control_candidate) return "";
  return `${m[1]} is ${first.startsWith("cheapest") ? "cheaper" : "faster"}, but not by the minimum meaningful difference the spec declares, so the control ${rec.control_candidate} is kept.`;
}

function controlClause(rec: Recommendation): string {
  const control = rec.control_candidate;
  if (!control || !rec.chosen) return "";
  if (rec.chosen === control) return keptControlClause(rec) || "It is also the control candidate.";
  const beats = rec.compared_to_control?.beats_control;
  if (beats === true) return `It beats the control ${control}.`;
  if (beats === false) return `It has no advantage over the control ${control}.`;
  return "";
}

/** One paragraph: what is recommended and why, or why nothing is. */
export function recommendationSentence(rec: Recommendation): string {
  if (rec.chosen) return (pickClause(rec) + controlClause(rec)).trim();
  if (!rec.operating_mode) return "The spec declares no operating mode, so no choice can be made among eligible candidates.";
  if (rec.eligible.length === 0) return "No candidate passes every gate, so this step makes no recommendation.";
  return `${rec.eligible.length} candidates are eligible, but "${modeLabel(rec.operating_mode)}" cannot separate them.`;
}

// ── how firm, and what the judge thought ─────────────────────────────────────

function directionalReason(reason: string): string {
  const inputs = reason.match(/^(\d+) inputs?; fewer than (\d+)/) ?? reason.match(/^fewer than (\d+) inputs/);
  if (inputs && inputs.length === 3) return `only ${inputs[1]} input(s) (fewer than ${inputs[2]})`;
  if (inputs) return `fewer than ${inputs[1]} inputs`;
  if (/no minimum meaningful difference/.test(reason)) return "the spec declares no minimum meaningful difference";
  if (/^judge-preference/.test(reason)) return "the ranking rests entirely on the judge model";
  return reason;
}

/** Why the recommendation is as firm as it is, in words a reader can act on. */
export function firmnessNote(firmness: Recommendation["firmness"], directionalReasons: readonly string[]): string {
  if (firmness === "firm") return "Sample size and thresholds both meet the bar for a decision.";
  if (firmness === "needs-review") return "This step has no recommendation to adopt; someone needs to review the evidence below and decide.";
  const why = directionalReasons.map(directionalReason);
  return why.length > 0 ? `${capitalize(why.join(", "))}, so this result is directional only.` : "This result is directional only.";
}

export interface JudgePick {
  candidate: string;
  wins: number;
  losses: number;
  ties: number;
  comparisons: number;
  sole: boolean;
  disagrees: boolean;
}

/** The judge's favourite, always kept apart from the recommendation. */
export function judgeNote(j: JudgePick | null, chosen: string | null): string {
  if (!j) return "No pairwise comparison was available this run.";
  if (!j.sole) return "The judge did not separate the candidates: more than one shares the top win rate.";
  const record = `${j.wins} W ${j.losses} L ${j.ties} T of ${j.comparisons}`;
  const head = `The judge preferred ${j.candidate} most (${record})`;
  if (j.disagrees) return `${head}, which differs from the recommendation — the recommendation compares only candidates that pass the required checks, by operating mode, and does not use judge preference.`;
  if (chosen === j.candidate) return `${head}, which matches the recommendation.`;
  return `${head}.`;
}
