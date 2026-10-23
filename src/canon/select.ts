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
import { allTrialsPassRate, directionality, type CandidateRates, type Directionality, type Rate } from "./rates.js";
import { clearsGate, fmtP, pairByInput, wilson, type PairedComparison } from "./stats.js";
import type { EligibilityDecl, EligibilityThresholds, OperatingMode } from "./types.js";

export const SELECT_RULE_VERSION = "select-v4" as const;

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
  all_trials_pass_rate: Rate;
}

export type RecommendationFirmness = "firm" | "directional" | "needs-review";

/**
 * Who came nearest when every candidate was gated out. Never adopted: `chosen`
 * stays null and the step still needs review. It tells the reader where to
 * start looking, ranked by required-check pass rate, then reliability, then
 * cost per success. A candidate removed only by the p95 or cost ceiling ranks
 * on those rates too, however far it is from the ceiling.
 */
export interface ClosestCandidate {
  candidate: string;
  reason: string;
  /** Why the gate that removed it did so (later gates skip a removed candidate). */
  gated_by: string[];
}

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
  /** Why the recommendation is not firm; empty when it is. Also listed in `reasons`. */
  firmness_reasons: string[];
  /** The statistics firmness was decided on (stats.ts); null when nobody was chosen. */
  evidence: FirmnessEvidence | null;
  reasons: string[];
  /** Set only when the gates removed every candidate; null otherwise. */
  closest: ClosestCandidate | null;
}

/** A gated rate of the chosen candidate with its Wilson 95% interval. */
export interface GateInterval {
  gate: "required-check-pass-rate" | "reliability" | "all-trials-pass-rate";
  threshold: number;
  /** Counted per input when trials repeat inputs (see gateInterval). */
  successes: number;
  n: number;
  low: number;
  high: number;
}

export interface FirmnessEvidence {
  gates: GateInterval[];
  /** highest-assurance only: the chosen candidate against the runner-up, by input. */
  versus_runner_up: PairedComparison | null;
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
  /** Trial rows: the paired comparison and per-input counts are read from them. */
  trials?: readonly TrialRow[];
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
    minimum_all_trials_pass_rate: declaredOr(declared?.minimum_all_trials_pass_rate, null),
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

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Why a rate is undefined when no attempt could be attributed to the candidate. */
function infraOnly(c: CandidateRates, r: Rate): string | null {
  if (r.denominator > 0) return null;
  const infra = c.completion_states.provider_error + c.completion_states.cancelled;
  if (infra > 0) return `no attempt completed (${plural(infra, "infra error")})`;
  const ungraded = c.check_states.evaluator_error;
  if (ungraded > 0) return `no attempt could be graded (${plural(ungraded, "evaluator error")})`;
  return null;
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
): Pick {
  const priced = eligible.filter(hasCost);
  const unpriced = eligible.filter((c) => !hasCost(c)).map((c) => c.candidate).sort();
  if (priced.length === 0) {
    return {
      chosen: null,
      reason: `no eligible candidate has a defined cost: cost per successful task is undefined for ${unpriced.join(", ")} (no success, or spend not observed — see GAPS.md)`,
    };
  }
  const notRanked = unpriced.length > 0
    ? `; not ranked, cost per success undefined: ${unpriced.join(", ")}`
    : "";
  const best = rankAscending(priced, control, (c) => c.generation_cost_per_success)[0];
  const ctrl = control ? priced.find((c) => c.candidate === control) : undefined;
  if (ctrl && best.candidate !== control && mmd !== null) {
    const delta = ctrl.generation_cost_per_success - best.generation_cost_per_success;
    if (delta < mmd) {
      return {
        chosen: control,
        reason: `cheapest eligible is ${best.candidate} ($${best.generation_cost_per_success}) but the saving versus control ${control} ($${ctrl.generation_cost_per_success}) is ${delta.toFixed(6)}, below the declared minimum meaningful difference ${mmd}${notRanked}`,
      };
    }
  }
  return {
    chosen: best.candidate,
    reason: `lowest generation cost per successful task among eligible: $${best.generation_cost_per_success}${notRanked}`,
  };
}

function pickFastest(
  eligible: readonly CandidateRates[],
  control: string | null,
  mmd: number | null,
): Pick {
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

/** The judge's pairwise score as the report shows it: (wins + ties/2) / comparisons. Null when never compared. */
function pairwiseScore(s: JudgeStanding | undefined): number | null {
  return s && s.comparisons > 0 ? (s.wins + s.ties / 2) / s.comparisons : null;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/**
 * Highest reliability, then required-check pass rate. Among candidates still
 * tied on both — common: every eligible one passed everything — the judge's
 * pairwise score decides when a judge ran (the better answer among equally
 * correct ones), then cost. The reason says it was a tie and what broke it,
 * since "highest reliability" alone would hide that six were at 100%.
 */
interface Pick {
  chosen: string | null;
  reason: string;
  /** highest-assurance: the next candidate in its ranking, whom the chosen must beat. */
  runnerUp?: string;
}

function pickHighestAssurance(
  eligible: readonly CandidateRates[],
  control: string | null,
  standings: readonly JudgeStanding[],
): Pick {
  if (eligible.length === 0) {
    return { chosen: null, reason: "no eligible candidates" };
  }
  const judged = new Map(standings.map((s) => [s.candidate, pairwiseScore(s)]));
  const assurance = (a: CandidateRates, b: CandidateRates): number =>
    rateSortValue(b.reliability) - rateSortValue(a.reliability) ||
    rateSortValue(b.required_check_pass_rate) - rateSortValue(a.required_check_pass_rate);
  const ranked = [...eligible].sort((a, b) => {
    const first = assurance(a, b);
    if (first !== 0) return first;
    const ja = judged.get(a.candidate) ?? null;
    const jb = judged.get(b.candidate) ?? null;
    if (ja !== null && jb !== null && ja !== jb) return jb - ja;
    const costA = a.generation_cost_per_success;
    const costB = b.generation_cost_per_success;
    if (costA !== null && costB !== null && costA !== costB) return costA - costB;
    return compareIds(a.candidate, b.candidate, control);
  });
  const best = ranked[0];
  const runnerUp = ranked[1]?.candidate;
  const tied = ranked.filter((c) => assurance(best, c) === 0);
  const level = `${fmtRate(best.reliability)} reliability and ${fmtRate(best.required_check_pass_rate)} required-check pass rate`;
  if (tied.length === 1) {
    return { chosen: best.candidate, runnerUp, reason: `highest assurance: ${best.candidate} alone has ${level}` };
  }
  const next = tied[1];
  const jBest = judged.get(best.candidate) ?? null;
  const jNext = judged.get(next.candidate) ?? null;
  const byJudge = jBest !== null && jNext !== null && jBest !== jNext;
  const breaker = byJudge
    ? `the judge's pairwise score (${best.candidate} ${pct(jBest)}, next ${next.candidate} ${pct(jNext)})`
    : `generation cost per success, the judge not separating them${jBest === null ? " (no pairwise judging)" : ""}`;
  return {
    chosen: best.candidate,
    runnerUp,
    reason: `${tied.length} eligible candidates tie at ${level}; ${best.candidate} is picked by ${breaker}`,
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
): Pick {
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
  // Every comparison a tie and no usable scale: the judge did not separate
  // them, and picking on id order would dress an arbitrary choice as a verdict.
  const separated =
    new Set(judged.map((c) => byCandidate.get(c.candidate)!.win_rate ?? -1)).size > 1;
  if (judged.length > 1 && !separated && !absoluteDiscriminates) {
    return {
      chosen: null,
      reason: `the judge did not separate the candidates: ${s.wins}–${s.losses}–${s.ties} across ${s.comparisons} comparison(s) for each, and the absolute scores show no discrimination`,
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
): Pick {
  switch (mode) {
    case "lowest-cost":
      return pickLowestCost(eligible, control, mmd);
    case "fastest-within-cost-ceiling":
      return pickFastest(eligible, control, mmd);
    case "highest-assurance":
      return pickHighestAssurance(eligible, control, standings);
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
          : infraOnly(c, c.required_check_pass_rate) ??
            `required-check pass rate ${fmtRate(c.required_check_pass_rate)} < ${min}`,
    );
  }

  if (eligibility.minimum_reliability !== null) {
    const min = eligibility.minimum_reliability;
    runFilter(
      "reliability",
      `reliability ≥ ${min}`,
      (c) =>
        meetsMin(c.reliability, min)
          ? null
          : infraOnly(c, c.reliability) ?? `reliability ${fmtRate(c.reliability)} < ${min}`,
    );
  }

  if (eligibility.minimum_all_trials_pass_rate !== null) {
    const min = eligibility.minimum_all_trials_pass_rate;
    runFilter(
      "all-trials-pass-rate",
      `pass^k (every trial of an input succeeds) ≥ ${min}`,
      (c) => {
        const r = passAllOf(c);
        return meetsMin(r, min) ? null : infraOnly(c, r) ?? `pass^k ${fmtRate(r)} < ${min}`;
      },
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
  let runnerUp: string | undefined;
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
    runnerUp = pick.runnerUp;
    reasons.push(pick.reason);
  }

  if (chosen === null && !reasons.some((r) => r.includes("no candidate") || r.includes("operating_mode") || r.includes("requires eligibility"))) {
    reasons.push("selector could not choose a candidate");
  }

  let firmness: RecommendationFirmness;
  let firmnessReasons: string[] = [];
  let evidence: FirmnessEvidence | null = null;
  if (chosen === null || mode === null) firmness = "needs-review";
  else if (mode === JUDGE_MODE) {
    // Capped on purpose: no deterministic check ran, so nothing here is firm.
    firmness = "directional";
    firmnessReasons = [
      input.requiredChecks.length === 0
        ? "judge-preference: this step declares no required check, so task success is undetermined for every candidate and this ranking rests entirely on the judge model"
        : "judge-preference: the ranking rests on the judge model, not on the required checks",
      ...input.directionality.reasons,
    ];
  } else {
    const judged = judgeFirmness(byId(candidates, chosen)!, runnerUp, mode, eligibility, input.trials ?? []);
    evidence = judged.evidence;
    firmnessReasons = [...input.directionality.reasons, ...judged.reasons];
    firmness = firmnessReasons.length > 0 ? "directional" : "firm";
  }
  reasons.push(...firmnessReasons);

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
    all_trials_pass_rate: passAllOf(c),
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
    firmness_reasons: firmnessReasons,
    evidence,
    reasons,
    closest: mode && eligibleRates.length === 0 ? closestOf(candidates, filters) : null,
  };
}

/** pass^k; a summary written before the field existed reads as undefined, never as a pass. */
function passAllOf(c: CandidateRates): Rate {
  return c.all_trials_pass_rate ?? { value: null, numerator: 0, denominator: 0 };
}

/** Distinct inputs a candidate has classified trials on. */
function inputsOf(trials: readonly TrialRow[], candidate: string): number {
  return new Set(
    trials
      .filter((t) => t.candidate === candidate && (t.task_outcome === "success" || t.task_outcome === "failure"))
      .map((t) => t.input),
  ).size;
}

/**
 * Wilson interval on a gated rate. Trials of one input are not independent
 * evidence, so when trials repeat inputs the count is scaled down to the
 * number of inputs (k·n_in/n): conservative, and exact when trials = 1.
 */
function gateInterval(
  gate: GateInterval["gate"],
  rate: Rate,
  threshold: number,
  inputs: number,
): GateInterval | null {
  if (rate.value === null) return null;
  const n = inputs > 0 ? Math.min(rate.denominator, inputs) : rate.denominator;
  const successes = rate.value * n;
  const ci = wilson(successes, n);
  if (!ci) return null;
  return { gate, threshold, successes: Math.round(successes * 100) / 100, n, low: ci.low, high: ci.high };
}

/**
 * Firm needs two things the point estimates cannot show:
 *   - every declared gate still holds at the low end of the chosen
 *     candidate's 95% interval — passing 30 of 30 is consistent with a true
 *     rate near 0.89, so a gate of 1.0 can never be firm;
 *   - highest-assurance: the chosen beats the runner-up on task success by an
 *     exact sign test over inputs. Indistinguishable candidates picked by the
 *     judge or by cost stay directional.
 */
function judgeFirmness(
  chosen: CandidateRates,
  runnerUp: string | undefined,
  mode: OperatingMode,
  eligibility: EligibilityThresholds,
  trials: readonly TrialRow[],
): { reasons: string[]; evidence: FirmnessEvidence } {
  const reasons: string[] = [];
  const inputs = inputsOf(trials, chosen.candidate);
  const gates = [
    eligibility.minimum_required_check_pass_rate === null
      ? null
      : gateInterval("required-check-pass-rate", chosen.required_check_pass_rate, eligibility.minimum_required_check_pass_rate, inputs),
    eligibility.minimum_reliability === null
      ? null
      : gateInterval("reliability", chosen.reliability, eligibility.minimum_reliability, inputs),
    eligibility.minimum_all_trials_pass_rate === null
      ? null
      : gateInterval("all-trials-pass-rate", passAllOf(chosen), eligibility.minimum_all_trials_pass_rate, inputs),
  ].filter((g): g is GateInterval => g !== null);
  for (const g of gates) {
    if (clearsGate(g.low, g.threshold)) continue;
    const never = g.threshold >= 1 ? `; a gate of ${g.threshold} can never be firm, declare one such as 0.95` : "";
    reasons.push(
      `${chosen.candidate}: ${g.gate} ${g.successes}/${g.n} has a 95% interval down to ${g.low.toFixed(3)}, below the gate ${g.threshold}${never}`,
    );
  }

  let versus: PairedComparison | null = null;
  if (mode === "highest-assurance" && runnerUp !== undefined) {
    versus = pairByInput(trials, chosen.candidate, runnerUp);
    const wins = versus.significant && versus.a_better > versus.b_better;
    if (!wins) {
      reasons.push(
        `${chosen.candidate} and ${runnerUp} cannot be told apart on task success: ${chosen.candidate} did better on ${versus.a_better} input(s), ${runnerUp} on ${versus.b_better}, equal on ${versus.same} (sign test p ${fmtP(versus.p_value)})`,
      );
    }
  }
  return { reasons, evidence: { gates, versus_runner_up: versus } };
}

const costSortValue = (c: CandidateRates): number => c.generation_cost_per_success ?? Number.POSITIVE_INFINITY;

/** The gated-out candidate nearest to qualifying: see ClosestCandidate. Null when there is nobody to rank. */
function closestOf(candidates: readonly CandidateRates[], filters: readonly RecommendFilter[]): ClosestCandidate | null {
  const ranked = [...candidates].sort(
    (a, b) =>
      rateSortValue(b.required_check_pass_rate) - rateSortValue(a.required_check_pass_rate) ||
      rateSortValue(b.reliability) - rateSortValue(a.reliability) ||
      costSortValue(a) - costSortValue(b),
  );
  const best = ranked[0];
  if (best === undefined) return null;
  return {
    candidate: best.candidate,
    reason: `no candidate passed the gates; the closest is ${best.candidate}, with required-check pass rate ${fmtRate(best.required_check_pass_rate)} and reliability ${fmtRate(best.reliability)}`,
    gated_by: filters.flatMap((f) => f.removed.filter((r) => r.candidate === best.candidate).map((r) => r.reason)),
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
  // Firmness is a select-time rule: recompute it so a summary written under an
  // older rule cannot carry a stale label.
  const inputs = new Set(trials.map((t) => t.input)).size;
  // Summaries written before pass^k existed lack it; the rows still have it.
  const candidates = summary.candidates.map((c) =>
    c.all_trials_pass_rate !== undefined || trials.length === 0
      ? c
      : { ...c, all_trials_pass_rate: allTrialsPassRate(trials.filter((t) => t.candidate === c.candidate)) },
  );
  return recommend({
    trials,
    judge: judgeStandings(trials),
    absoluteDiscriminates: judgeDiscrimination(trials).discriminates,
    operatingMode: manifest.operating_mode,
    controlCandidate: manifest.control_candidate,
    requiredChecks: manifest.evaluators.required_checks,
    eligibility: manifest.eligibility,
    mmd: manifest.minimum_meaningful_difference,
    directionality: inputs > 0 ? directionality(inputs, manifest.minimum_meaningful_difference) : summary.directionality,
    candidates,
  });
}
