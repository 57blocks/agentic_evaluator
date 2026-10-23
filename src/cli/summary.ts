/**
 * The table a run prints when it finishes.
 *
 * Built from the canonical rows, not from the legacy `Report` — which is what
 * let the legacy layer retire. It answers, per candidate, the three questions
 * the protocol cares about in the order it cares about them: did the required
 * check pass, did the task succeed, and what did it cost. Pairwise records and
 * 1–5 scores appear only when those methods were declared; a method that was
 * not run leaves a column out rather than a zero in it.
 */

import { itemStats } from "../canon/item-stats.js";
import { allTrialsPassRate, type Rate } from "../canon/rates.js";
import type { TrialRow } from "../canon/rows.js";
import type { FirmnessEvidence } from "../canon/select.js";
import type { StoppedCandidate } from "../canon/early-stop.js";
import { certaintyLines } from "./certainty-lines.js";

export interface SummaryInput {
  step: string;
  candidates: readonly string[];
  trials: readonly TrialRow[];
  chosen: string | null;
  /** Named when nobody qualified (Recommendation.closest); never adopted. */
  closest?: string | null;
  firmness: string;
  /** Why the recommendation is not firm (Recommendation.firmness_reasons). */
  firmnessReasons?: readonly string[];
  /** The statistics firmness was decided on (Recommendation.evidence). */
  evidence?: FirmnessEvidence | null;
  /** Candidates early stop took out of the run. */
  earlyStopped?: readonly StoppedCandidate[];
  /** Candidates the eligibility gate removed, and why. */
  gated: ReadonlyArray<{ candidate: string; reason: string }>;
  ledgerTotal: number;
  ledgerSource: string;
}

interface Row {
  candidate: string;
  trials: number;
  success: number;
  /** Trials no one could attribute (infra failure, check could not run): not misses. */
  undetermined: number;
  checkPass: number;
  checkTotal: number;
  /** pass^k: inputs where every trial succeeded. */
  passAll: Rate;
  wins: number;
  duels: number;
  absolute: number | null;
  costUsd: number;
  /** False when any attempt's spend was not reported: the sum is then a floor, not a cost. */
  costObserved: boolean;
  medianMs: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function rowFor(candidate: string, trials: readonly TrialRow[]): Row {
  const mine = trials.filter((t) => t.candidate === candidate);
  // A trial whose check could not run was not graded: it is not a check miss.
  const checked = mine.filter(
    (t) => Object.keys(t.checks).length > 0 && Object.values(t.checks).every((c) => c.state === "pass" || c.state === "fail"),
  );
  const scores = mine.map((t) => t.judge.absolute_overall).filter((n): n is number => n !== null);
  const duels = mine.flatMap((t) => t.judge.pairwise ?? []);
  return {
    candidate,
    trials: mine.length,
    success: mine.filter((t) => t.task_outcome === "success").length,
    undetermined: mine.filter((t) => t.task_outcome === "undetermined").length,
    checkPass: checked.filter((t) => Object.values(t.checks).every((c) => c.state === "pass")).length,
    checkTotal: checked.length,
    passAll: allTrialsPassRate(mine),
    wins: duels.filter((d) => d.resolved === "win").length,
    duels: duels.length,
    absolute: scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length,
    costUsd: mine.reduce((sum, t) => sum + t.cost.generation + (t.cost.retry ?? 0), 0),
    costObserved: mine.every((t) => t.cost.source !== "none"),
    medianMs: median(mine.map((t) => t.ms)),
  };
}

/** "1/2" over attributable trials; ", N undetermined" when some were not. */
function successCell(r: Row): string {
  const cell = `${r.success}/${r.trials - r.undetermined}`;
  return r.undetermined > 0 ? `${cell}, ${r.undetermined} undetermined` : cell;
}

/** "$0.0700"; "unobserved" when nothing was reported; "≥$0.0700" when only some of it was. */
function costCell(r: Row): string {
  const usd = `$${r.costUsd.toFixed(4)}`;
  if (r.costObserved) return usd;
  return r.costUsd > 0 ? `≥${usd}` : "unobserved";
}

function pad(text: string, width: number, right = false): string {
  return right ? text.padStart(width) : text.padEnd(width);
}

/**
 * Lines, not a string: the caller decides what a line is. Column widths are
 * computed rather than fixed, because a truncated candidate id in a summary
 * is how two candidates start looking like one.
 */
export function summaryLines(input: SummaryInput): string[] {
  const rows = input.candidates.map((c) => rowFor(c, input.trials));
  const showDuels = rows.some((r) => r.duels > 0);
  const showScore = rows.some((r) => r.absolute !== null);
  const showCheck = rows.some((r) => r.checkTotal > 0);
  // With one trial per input pass^k is just success per input: no column then.
  const showPassAll = input.trials.some((t) => t.trial > 0);

  const header = [
    "candidate",
    "success",
    ...(showCheck ? ["check"] : []),
    ...(showPassAll ? ["pass^k"] : []),
    ...(showDuels ? ["duels"] : []),
    ...(showScore ? ["score"] : []),
    "cost",
    "p50",
  ];
  const body = rows.map((r) => [
    r.candidate,
    successCell(r),
    ...(showCheck ? [r.checkTotal === 0 ? "—" : `${r.checkPass}/${r.checkTotal}`] : []),
    ...(showPassAll ? [r.passAll.denominator === 0 ? "—" : `${r.passAll.numerator}/${r.passAll.denominator}`] : []),
    ...(showDuels ? [r.duels === 0 ? "—" : `${r.wins}/${r.duels}`] : []),
    ...(showScore ? [r.absolute === null ? "—" : r.absolute.toFixed(1)] : []),
    costCell(r),
    r.medianMs === null ? "—" : `${(r.medianMs / 1000).toFixed(1)}s`,
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: readonly string[]): string =>
    cells.map((c, i) => pad(c, widths[i], i > 0)).join("  ");

  const lowerBound = rows.every((r) => r.costObserved) ? "" : ", lower bound";
  const gated = input.gated.map((g) => `  gated  ${g.candidate} — ${g.reason}`);
  const stopped = (input.earlyStopped ?? []).map(
    (s) => `  stopped ${s.candidate} after ${s.after_trials} trial(s), ${s.skipped} not run — ${s.reason}`,
  );

  return [
    "",
    `  ${line(header)}`,
    `  ${widths.map((w) => "─".repeat(w)).join("  ")}`,
    ...body.map((b) => `  ${line(b)}`),
    "",
    ...gated,
    ...stopped,
    `  → ${input.chosen ?? `no candidate qualified${input.closest ? ` · closest ${input.closest}` : ""}`} (${input.firmness}) · total $${input.ledgerTotal.toFixed(4)} (${input.ledgerSource}${lowerBound})`,
    ...certaintyLines({
      chosen: input.chosen,
      firmness: input.firmness,
      firmnessReasons: input.firmnessReasons ?? [],
      evidence: input.evidence ?? null,
      items: itemStats(input.trials),
    }),
    "",
  ];
}
