/**
 * Eligibility gates and operating-mode selection (protocol §7 steps 8, 11; §12).
 *
 * Pure: reads rates + frozen thresholds, writes a recommendation. Never infers
 * success from a score, never lets a cheaper ineligible candidate win, never
 * calls a model. Re-running on the same summary + manifest is idempotent.
 */

import { judgeStandings, type JudgeStanding } from "./judge-standings.js";
import { judgeDiscrimination } from "./discrimination.js";
import type { TrialRow } from "./rows.js";
import type { CandidateRates, Directionality, Rate } from "./rates.js";
import type { EligibilityDecl, EligibilityThresholds, OperatingMode } from "./types.js";

export const SELECT_RULE_VERSION = "select-v1" as const;

const MODES: readonly OperatingMode[] = [
  "lowest-cost",
  "fastest-within-cost-ceiling",
  "highest-assurance",
  "judge-preference",
];

/**
 * The one mode that ranks on model opinion instead of measured outcomes.
 * It exists so a step with no deterministic check can still produce a written
 * decision trace — never so that such a step can look decided.
 */
const JUDGE_MODE: OperatingMode = "judge-preference";

export interface RemovedCandidate {
  candidate: string;
  reason: string;
}

export interface RecommendFilter {
  id: string;
  description: string;
  removed: RemovedCandidate[];
  remaining: string[];
}

export interface CandidateTradeoff {
  candidate: string;
  eligible: boolean;
  /** Present only in judge-preference runs: what the ranking actually read. */
  judge?: { win_rate: number | null; wins: number; comparisons: number; absolute_mean: number | null };
  generation_cost_per_success: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  reliability: Rate;
  required_check_pass_rate: Rate;
  task_success_rate: Rate;
}

export type RecommendationFirmness = "firm" | "directional" | "needs-review";

export interface Recommendation {
  rule_version: typeof SELECT_RULE_VERSION;
  operating_mode: string | null;
  control_candidate: string | null;
  eligibility: EligibilityThresholds;
  filters: RecommendFilter[];
  eligible: string[];
  tradeoffs: CandidateTradeoff[];
  chosen: string | null;
  compared_to_control: { beats_control: boolean | null; reason: string } | null;
  firmness: RecommendationFirmness;
  reasons: string[];
}

export interface RecommendInput {
  operatingMode: string | null;
  controlCandidate: string | null;
  requiredChecks: readonly string[];
  eligibility?: EligibilityDecl | EligibilityThresholds | null;
  mmd: number | null;
  directionality: Directionality;
  candidates: CandidateRates[];
  /** Required by judge-preference; ignored by every other mode. */
  judge?: readonly JudgeStanding[];
  /**
   * False when the absolute grader gave every candidate the same score, so the
   * mean cannot rank anyone. Defaults to true for callers that never scored.
   */
  absoluteDiscriminates?: boolean;
}

/**
 * Omitted spec keys take defaults. Frozen `null` stays "not applied"
 * (`null ?? default` would wrongly resurrect a gate).
 */
export function resolveEligibility(
  requiredChecks: readonly string[],
  declared?: EligibilityDecl | EligibilityThresholds | null,
): EligibilityThresholds {
  const hasChecks = requiredChecks.length > 0;
  return {
    minimum_reliability: declaredOr(declared?.minimum_reliability, hasChecks ? 1 : null),
    minimum_required_check_pass_rate: declaredOr(
      declared?.minimum_required_check_pass_rate,
      hasChecks ? 1 : null,
    ),
    maximum_p95_ms: declaredOr(declared?.maximum_p95_ms, null),
    cost_ceiling_per_success_usd: declaredOr(declared?.cost_ceiling_per_success_usd, null),
  };
}

function declaredOr(value: number | null | undefined, fallback: number | null): number | null {
  return value === undefined ? fallback : value;
}

function fmtRate(rate: Rate): string {
  if (rate.value === null) return `undefined (${rate.numerator}/${rate.denominator})`;
  return `${rate.value.toFixed(3)} (${rate.numerator}/${rate.denominator})`;
}

function meetsMin(rate: Rate, min: number): boolean {
  return rate.value !== null && rate.value + 1e-12 >= min;
}

function rateSortValue(rate: Rate): number {
  return rate.value ?? -1;
}

function remainingOf(candidates: readonly CandidateRates[], removed: ReadonlySet<string>): string[] {
  return candidates.filter((c) => !removed.has(c.candidate)).map((c) => c.candidate);
}

function applyFilter(
  id: string,
  description: string,
  candidates: readonly CandidateRates[],
  already: ReadonlySet<string>,
  decide: (c: CandidateRates) => string | null,
): { filter: RecommendFilter; removed: Set<string> } {
  const removed = new Set(already);
  const newly: RemovedCandidate[] = [];
  for (const c of candidates) {
    if (removed.has(c.candidate)) continue;
    const reason = decide(c);
    if (reason) {
      removed.add(c.candidate);
      newly.push({ candidate: c.candidate, reason });
    }
  }
  return {
    filter: { id, description, removed: newly, remaining: remainingOf(candidates, removed) },
    removed,
  };
}

function byId(candidates: readonly CandidateRates[], id: string): CandidateRates | undefined {
  return candidates.find((c) => c.candidate === id);
}

function compareIds(a: string, b: string, control: string | null): number {
  if (control && a === control && b !== control) return -1;
  if (control && b === control && a !== control) return 1;
  return a.localeCompare(b);
}

function rankAscending<T extends { candidate: string }>(
  items: readonly T[],
  control: string | null,
  valueOf: (c: T) => number,
): T[] {
  return [...items].sort((a, b) => {
    const d = valueOf(a) - valueOf(b);
    return d !== 0 ? d : compareIds(a.candidate, b.candidate, control);
  });
}

function hasCost(
  c: CandidateRates,
): c is CandidateRates & { generation_cost_per_success: number } {
  return c.generation_cost_per_success !== null;
}

function hasP50(c: CandidateRates): c is CandidateRates & { p50_ms: number } {
  return c.p50_ms !== null;
}

function pickLowestCost(
  eligible: readonly CandidateRates[],
  control: string | null,
  mmd: number | null,
): { chosen: string | null; reason: string } {
  const priced = eligible.filter(hasCost);
  if (priced.length === 0) {
    return { chosen: null, reason: "no eligible candidate has a defined cost per successful task" };
  }
  const best = rankAscending(priced, control, (c) => c.generation_cost_per_success)[0];
  const ctrl = control ? priced.find((c) => c.candidate === control) : undefined;
  if (ctrl && best.candidate !== control && mmd !== null) {
    const delta = ctrl.generation_cost_per_success - best.generation_cost_per_success;
    if (delta < mmd) {
      return {
        chosen: control,
        reason: `cheapest eligible is ${best.candidate} ($${best.generation_cost_per_success}) but the saving versus control ${control} ($${ctrl.generation_cost_per_success}) is ${delta.toFixed(6)}, below the declared minimum meaningful difference ${mmd}`,
      };
    }
  }
  return {
    chosen: best.candidate,
    reason: `lowest generation cost per successful task among eligible: $${best.generation_cost_per_success}`,
  };
}

function pickFastest(
  eligible: readonly CandidateRates[],
  control: string | null,
  mmd: number | null,
): { chosen: string | null; reason: string } {
  const timed = eligible.filter(hasP50);
  if (timed.length === 0) {
    return { chosen: null, reason: "no eligible candidate has a p50 completion time" };
  }
  const best = rankAscending(timed, control, (c) => c.p50_ms)[0];
  const ctrl = control ? timed.find((c) => c.candidate === control) : undefined;
  if (ctrl && best.candidate !== control && mmd !== null) {
    const delta = ctrl.p50_ms - best.p50_ms;
    if (delta < mmd) {
      return {
        chosen: control,
        reason: `fastest eligible is ${best.candidate} (${best.p50_ms} ms) but the gain versus control ${control} (${ctrl.p50_ms} ms) is ${delta} ms, below the declared minimum meaningful difference ${mmd}`,
      };
    }
  }
  return {
    chosen: best.candidate,
    reason: `lowest p50 completion time among eligible: ${best.p50_ms} ms`,
  };
}

function pickHighestAssurance(
  eligible: readonly CandidateRates[],
  control: string | null,
): { chosen: string | null; reason: string } {
  if (eligible.length === 0) {
    return { chosen: null, reason: "no eligible candidates" };
  }
  const ranked = [...eligible].sort((a, b) => {
    const rel = rateSortValue(b.reliability) - rateSortValue(a.reliability);
    if (rel !== 0) return rel;
    const chk = rateSortValue(b.required_check_pass_rate) - rateSortValue(a.required_check_pass_rate);
    if (chk !== 0) return chk;
    const costA = a.generation_cost_per_success;
    const costB = b.generation_cost_per_success;
    if (costA !== null && costB !== null && costA !== costB) return costA - costB;
    return compareIds(a.candidate, b.candidate, control);
  });
  const best = ranked[0];
  return {
    chosen: best.candidate,
    reason: `highest reliability among eligible (${fmtRate(best.reliability)}), then required-check pass rate, then cost`,
  };
}

/**
 * Rank on judge opinion: pairwise win rate first, absolute mean as the
 * tie-break, cost last. Never reads success or reliability — there is none to
 * read, which is the only reason this mode exists.
 */
function pickJudgePreference(
  eligible: readonly CandidateRates[],
  standings: readonly JudgeStanding[],
  control: string | null,
  /** False when every candidate got the same absolute score; then it cannot rank. */
  absoluteDiscriminates: boolean,
): { chosen: string | null; reason: string } {
  const byCandidate = new Map(standings.map((s) => [s.candidate, s]));
  const judged = eligible.filter((c) => {
    const s = byCandidate.get(c.candidate);
    return s !== undefined && (s.comparisons > 0 || s.absolute_scored > 0);
  });
  if (judged.length === 0) {
    return { chosen: null, reason: "no eligible candidate carries a judge verdict or score" };
  }
  const ranked = [...judged].sort((a, b) => {
    const sa = byCandidate.get(a.candidate)!;
    const sb = byCandidate.get(b.candidate)!;
    const win = (sb.win_rate ?? -1) - (sa.win_rate ?? -1);
    if (win !== 0) return win;
    const abs = absoluteDiscriminates ? (sb.absolute_mean ?? -1) - (sa.absolute_mean ?? -1) : 0;
    if (abs !== 0) return abs;
    const costA = a.generation_cost_per_success;
    const costB = b.generation_cost_per_success;
    if (costA !== null && costB !== null && costA !== costB) return costA - costB;
    return compareIds(a.candidate, b.candidate, control);
  });
  const best = ranked[0];
  const s = byCandidate.get(best.candidate)!;
  const absolute = absoluteDiscriminates
    ? `mean absolute score ${s.absolute_mean === null ? "n/a" : s.absolute_mean.toFixed(2)}`
    : "absolute scores ignored: they show no discrimination between candidates";
  if (judged.length === 1 && s.comparisons === 0) {
    return {
      chosen: best.candidate,
      reason:
        `only ${best.candidate} carried any judge evidence; every other candidate produced nothing gradable, ` +
        "so this is the last one standing, not a preference between candidates",
    };
  }
  if (!absoluteDiscriminates && s.comparisons === 0) {
    return {
      chosen: null,
      reason:
        "no usable judge evidence: no pairwise comparison, and the absolute scores are identical across candidates",
    };
  }
  return {
    chosen: best.candidate,
    reason: `highest judge preference: ${s.wins}–${s.losses}–${s.ties} over ${s.comparisons} comparison(s), ${absolute}. This ranks one model's opinion, not measured task success.`,
  };
}

function pickForMode(
  mode: OperatingMode,
  eligible: readonly CandidateRates[],
  control: string | null,
  mmd: number | null,
  standings: readonly JudgeStanding[],
  absoluteDiscriminates: boolean,
): { chosen: string | null; reason: string } {
  switch (mode) {
    case "lowest-cost":
      return pickLowestCost(eligible, control, mmd);
    case "fastest-within-cost-ceiling":
      return pickFastest(eligible, control, mmd);
    case "highest-assurance":
      return pickHighestAssurance(eligible, control);
    case "judge-preference":
      return pickJudgePreference(eligible, standings, control, absoluteDiscriminates);
  }
}

function compareToControl(
  chosen: string | null,
  control: string | null,
  mode: OperatingMode | null,
  candidates: readonly CandidateRates[],
): Recommendation["compared_to_control"] {
  if (!control) return null;
  if (!chosen) {
    return { beats_control: null, reason: `no chosen candidate to compare with control ${control}` };
  }
  if (chosen === control) {
    return { beats_control: false, reason: `chosen candidate is the control (${control})` };
  }
  const c = byId(candidates, chosen);
  const k = byId(candidates, control);
  if (!c || !k) {
    return { beats_control: null, reason: `control ${control} has no rates in this summary` };
  }
  switch (mode) {
    case "lowest-cost": {
      if (c.generation_cost_per_success === null || k.generation_cost_per_success === null) {
        return { beats_control: null, reason: "cost per success is undefined for chosen or control" };
      }
      return {
        beats_control: c.generation_cost_per_success < k.generation_cost_per_success,
        reason: `chosen $${c.generation_cost_per_success} vs control $${k.generation_cost_per_success} per successful task`,
      };
    }
    case "fastest-within-cost-ceiling": {
      if (c.p50_ms === null || k.p50_ms === null) {
        return { beats_control: null, reason: "p50 is undefined for chosen or control" };
      }
      return {
        beats_control: c.p50_ms < k.p50_ms,
        reason: `chosen p50 ${c.p50_ms} ms vs control ${k.p50_ms} ms`,
      };
    }
    case "highest-assurance":
      return {
        beats_control: rateSortValue(c.reliability) > rateSortValue(k.reliability),
        reason: `chosen reliability ${fmtRate(c.reliability)} vs control ${fmtRate(k.reliability)}`,
      };
    default:
      return { beats_control: null, reason: "no operating mode to compare against control" };
  }
}

function asOperatingMode(raw: string | null): OperatingMode | null {
  for (const mode of MODES) {
    if (mode === raw) return mode;
  }
  return null;
}

export function recommend(input: RecommendInput): Recommendation {
  const eligibility = resolveEligibility(input.requiredChecks, input.eligibility);
  const mode = asOperatingMode(input.operatingMode);
  const candidates = input.candidates;
  const filters: RecommendFilter[] = [];
  let removed = new Set<string>();
  const reasons: string[] = [];

  function runFilter(
    id: string,
    description: string,
    decide: (c: CandidateRates) => string | null,
  ): void {
    const next = applyFilter(id, description, candidates, removed, decide);
    filters.push(next.filter);
    removed = next.removed;
  }

  if (input.requiredChecks.length === 0 && mode !== JUDGE_MODE) {
    runFilter(
      "qualifying-success-criteria",
      "a candidate can qualify only when the step declares required checks; without them task success is undetermined and cannot gate cost or speed",
      (c) => `${c.candidate}: no required checks declared for this step`,
    );
  }

  if (eligibility.minimum_required_check_pass_rate !== null) {
    const min = eligibility.minimum_required_check_pass_rate;
    runFilter(
      "required-check-pass-rate",
      `required-check pass rate ≥ ${min}`,
      (c) =>
        meetsMin(c.required_check_pass_rate, min)
          ? null
          : `required-check pass rate ${fmtRate(c.required_check_pass_rate)} < ${min}`,
    );
  }

  if (eligibility.minimum_reliability !== null) {
    const min = eligibility.minimum_reliability;
    runFilter(
      "reliability",
      `reliability ≥ ${min}`,
      (c) => (meetsMin(c.reliability, min) ? null : `reliability ${fmtRate(c.reliability)} < ${min}`),
    );
  }

  if (eligibility.maximum_p95_ms !== null) {
    const max = eligibility.maximum_p95_ms;
    runFilter("p95-ceiling", `p95 completion time ≤ ${max} ms`, (c) => {
      if (c.p95_ms === null) return `p95 is not observable`;
      return c.p95_ms <= max ? null : `p95 ${c.p95_ms} ms > ${max} ms`;
    });
  }

  const costCeiling = eligibility.cost_ceiling_per_success_usd;
  if (mode === "fastest-within-cost-ceiling") {
    if (costCeiling === null) {
      reasons.push("operating mode fastest-within-cost-ceiling requires eligibility.cost_ceiling_per_success_usd");
    } else {
      runFilter(
        "cost-ceiling",
        `generation cost per successful task ≤ $${costCeiling}`,
        (c) => {
          if (c.generation_cost_per_success === null) return `cost per successful task is undefined`;
          return c.generation_cost_per_success <= costCeiling
            ? null
            : `$${c.generation_cost_per_success} > ceiling $${costCeiling}`;
        },
      );
    }
  }

  const eligibleRates = candidates.filter((c) => !removed.has(c.candidate));
  const eligible = eligibleRates.map((c) => c.candidate);

  let chosen: string | null = null;
  if (!mode) {
    reasons.push(
      input.operatingMode
        ? `unknown operating_mode "${input.operatingMode}"`
        : "no operating_mode declared",
    );
  } else if (mode === "fastest-within-cost-ceiling" && costCeiling === null) {
    // already noted; do not pick
  } else if (eligibleRates.length === 0) {
    reasons.push("no candidate passed eligibility gates");
  } else {
    const pick = pickForMode(
      mode,
      eligibleRates,
      input.controlCandidate,
      input.mmd,
      input.judge ?? [],
      input.absoluteDiscriminates ?? true,
    );
    chosen = pick.chosen;
    reasons.push(pick.reason);
  }

  if (chosen === null && !reasons.some((r) => r.includes("no candidate") || r.includes("operating_mode") || r.includes("requires eligibility"))) {
    reasons.push("selector could not choose a candidate");
  }

  let firmness: RecommendationFirmness;
  if (chosen === null) firmness = "needs-review";
  else if (mode === JUDGE_MODE) {
    // Capped on purpose: no deterministic check ran, so nothing here is firm.
    firmness = "directional";
    reasons.push(
      input.requiredChecks.length === 0
        ? "judge-preference: this step declares no required check, so task success is undetermined for every candidate and this ranking rests entirely on the judge model"
        : "judge-preference: the ranking rests on the judge model, not on the required checks",
    );
    reasons.push(...input.directionality.reasons);
  } else if (input.directionality.directional) {
    firmness = "directional";
    reasons.push(...input.directionality.reasons);
  } else {
    firmness = "firm";
  }

  const standingOf = new Map((input.judge ?? []).map((s) => [s.candidate, s]));
  const tradeoffs: CandidateTradeoff[] = candidates.map((c) => ({
    candidate: c.candidate,
    eligible: eligible.includes(c.candidate),
    ...(mode === JUDGE_MODE && standingOf.has(c.candidate)
      ? {
          judge: {
            win_rate: standingOf.get(c.candidate)!.win_rate,
            wins: standingOf.get(c.candidate)!.wins,
            comparisons: standingOf.get(c.candidate)!.comparisons,
            absolute_mean: standingOf.get(c.candidate)!.absolute_mean,
          },
        }
      : {}),
    generation_cost_per_success: c.generation_cost_per_success,
    p50_ms: c.p50_ms,
    p95_ms: c.p95_ms,
    reliability: c.reliability,
    required_check_pass_rate: c.required_check_pass_rate,
    task_success_rate: c.task_success_rate,
  }));

  return {
    rule_version: SELECT_RULE_VERSION,
    operating_mode: input.operatingMode,
    control_candidate: input.controlCandidate,
    eligibility,
    filters,
    eligible,
    tradeoffs,
    chosen,
    compared_to_control: compareToControl(chosen, input.controlCandidate, mode, candidates),
    firmness,
    reasons,
  };
}

/** Convenience for run/report: freeze-time thresholds live on the manifest when present. */
export function recommendFromCanon(
  manifest: {
    operating_mode: string | null;
    control_candidate: string | null;
    minimum_meaningful_difference: number | null;
    evaluators: { required_checks: string[] };
    eligibility?: EligibilityThresholds;
  },
  summary: { candidates: CandidateRates[]; directionality: Directionality },
  /** Judge standings are derived from the trial rows; only judge-preference reads them. */
  trials: readonly TrialRow[] = [],
): Recommendation {
  return recommend({
    judge: judgeStandings(trials),
    absoluteDiscriminates: judgeDiscrimination(trials).discriminates,
    operatingMode: manifest.operating_mode,
    controlCandidate: manifest.control_candidate,
    requiredChecks: manifest.evaluators.required_checks,
    eligibility: manifest.eligibility,
    mmd: manifest.minimum_meaningful_difference,
    directionality: summary.directionality,
    candidates: summary.candidates,
  });
}
