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

import type { TrialRow } from "../canon/rows.js";

export interface SummaryInput {
  step: string;
  candidates: readonly string[];
  trials: readonly TrialRow[];
  chosen: string | null;
  firmness: string;
  /** Candidates the eligibility gate removed, and why. */
  gated: ReadonlyArray<{ candidate: string; reason: string }>;
  ledgerTotal: number;
  ledgerSource: string;
}

interface Row {
  candidate: string;
  trials: number;
  success: number;
  checkPass: number;
  checkTotal: number;
  wins: number;
  duels: number;
  absolute: number | null;
  costUsd: number;
  medianMs: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function rowFor(candidate: string, trials: readonly TrialRow[]): Row {
  const mine = trials.filter((t) => t.candidate === candidate);
  const checked = mine.filter((t) => Object.keys(t.checks).length > 0);
  const scores = mine.map((t) => t.judge.absolute_overall).filter((n): n is number => n !== null);
  const duels = mine.flatMap((t) => t.judge.pairwise ?? []);
  return {
    candidate,
    trials: mine.length,
    success: mine.filter((t) => t.task_outcome === "success").length,
    checkPass: checked.filter((t) => Object.values(t.checks).every((c) => c.state === "pass")).length,
    checkTotal: checked.length,
    wins: duels.filter((d) => d.resolved === "win").length,
    duels: duels.length,
    absolute: scores.length === 0 ? null : scores.reduce((a, b) => a + b, 0) / scores.length,
    costUsd: mine.reduce((sum, t) => sum + t.cost.generation + (t.cost.retry ?? 0), 0),
    medianMs: median(mine.map((t) => t.ms)),
  };
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

  const header = [
    "candidate",
    "success",
    ...(showCheck ? ["check"] : []),
    ...(showDuels ? ["duels"] : []),
    ...(showScore ? ["score"] : []),
    "cost",
    "p50",
  ];
  const body = rows.map((r) => [
    r.candidate,
    `${r.success}/${r.trials}`,
    ...(showCheck ? [r.checkTotal === 0 ? "—" : `${r.checkPass}/${r.checkTotal}`] : []),
    ...(showDuels ? [r.duels === 0 ? "—" : `${r.wins}/${r.duels}`] : []),
    ...(showScore ? [r.absolute === null ? "—" : r.absolute.toFixed(1)] : []),
    `$${r.costUsd.toFixed(4)}`,
    r.medianMs === null ? "—" : `${(r.medianMs / 1000).toFixed(1)}s`,
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: readonly string[]): string =>
    cells.map((c, i) => pad(c, widths[i], i > 0)).join("  ");

  const gated = input.gated.map((g) => `  gated  ${g.candidate} — ${g.reason}`);

  return [
    "",
    `  ${line(header)}`,
    `  ${widths.map((w) => "─".repeat(w)).join("  ")}`,
    ...body.map((b) => `  ${line(b)}`),
    "",
    ...gated,
    `  → ${input.chosen ?? "no candidate qualified"} (${input.firmness}) · total $${input.ledgerTotal.toFixed(4)} (${input.ledgerSource})`,
    "",
  ];
}
