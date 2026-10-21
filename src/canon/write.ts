/**
 * Writes the canonical run bundle (protocol §12) next to the legacy outputs.
 *
 *   manifest.json      what was tested (written before generation, finalized after)
 *   scores.jsonl       one row per trial
 *   evaluations.jsonl  one row per evaluator invocation, including errors
 *   ledger.json        itemized cost
 *   summary.json       per-candidate rates + directionality
 *   recommendation.json eligibility filters + operating-mode choice (pure)
 *   items.json         per-input classes and effective N (item-stats.ts)
 *   GAPS.md            fields the protocol wants that this run could not observe
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { CostLedger } from "./cost.js";
import type { RunManifest } from "./manifest.js";
import type { CandidateRates, Directionality } from "./rates.js";
import type { EvaluationRow, TrialRow } from "./rows.js";
import { recommendFromCanon, type Recommendation } from "./select.js";
import { INFRA_COMPLETION_STATES } from "./states.js";
import { budgetGap, type BudgetState } from "./budget.js";
import { judgeDiscrimination, saturationGap, type JudgeDiscrimination } from "./discrimination.js";
import { itemGaps, itemStats } from "./item-stats.js";
import type { TraceIntegrity } from "./trace.js";

export interface CanonSummary {
  run: string;
  step: string;
  inputs: string[];
  candidates: CandidateRates[];
  directionality: Directionality;
  integrity: TraceIntegrity;
  /** Whether the absolute grader separated the candidates at all. */
  judge_discrimination?: JudgeDiscrimination;
  /** Spend against the declared ceiling, and what the ceiling stopped. */
  budget?: BudgetState;
  evaluation_coverage: {
    evaluator: string;
    version: string;
    pass: number;
    fail: number;
    not_evaluated: number;
    evaluator_error: number;
  }[];
}

function jsonl(rows: readonly unknown[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
}

export async function writeManifest(runDir: string, manifest: RunManifest): Promise<void> {
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");
}

export function evaluationCoverage(rows: readonly EvaluationRow[]): CanonSummary["evaluation_coverage"] {
  const byKey = new Map<string, CanonSummary["evaluation_coverage"][number]>();
  for (const r of rows) {
    const key = `${r.evaluator}@${r.version}`;
    const cur = byKey.get(key) ?? { evaluator: r.evaluator, version: r.version, pass: 0, fail: 0, not_evaluated: 0, evaluator_error: 0 };
    byKey.set(key, { ...cur, [r.state]: cur[r.state] + 1 });
  }
  return [...byKey.values()];
}

/** Trials whose generation spend the harness could not see (cost source "none"). */
function unobservedCostGap(trials: readonly TrialRow[]): string | null {
  const unobserved = trials.filter((t) => t.cost.source === "none");
  if (unobserved.length === 0) return null;
  const candidates = [...new Set(unobserved.map((t) => t.candidate))].sort().join(", ");
  return `- generation cost: **not observed** for ${unobserved.length} trial(s) (${candidates}). These candidates' spend was not reported to the harness, so their cost per success is undefined (null, not $0); ledger \`generation\` and \`total\` are lower bounds, and \`cost_per_success\` / \`cost_per_attempt\` are null.`;
}

/** Trials the provider, transport or harness lost: undetermined, never the candidate's failure. */
function infraGap(trials: readonly TrialRow[]): string | null {
  const lost = trials.filter((t) => INFRA_COMPLETION_STATES.has(t.completion_state));
  if (lost.length === 0) return null;
  const byCandidate = [...new Set(lost.map((t) => t.candidate))]
    .sort()
    .map((c) => `${c} ${lost.filter((t) => t.candidate === c).length}`)
    .join(", ");
  return `- infra failures: ${lost.length} trial(s) ended in provider_error or cancelled (${byCandidate}). They are undetermined: out of task-success and reliability denominators, and shown as lost evaluation coverage.`;
}

/** Spend a candidate's own command reported: recorded, but nothing the harness saw. */
function selfReportedCostGap(trials: readonly TrialRow[], selfReporting: readonly string[]): string | null {
  const reported = [...new Set(
    trials.filter((t) => selfReporting.includes(t.candidate) && t.cost.source !== "none").map((t) => t.candidate),
  )].sort();
  if (reported.length === 0) return null;
  return `- generation cost: **self-reported** by ${reported.join(", ")} through \`.eval-usage.json\` (the spec declares \`cli.reports_usage\`). Recorded as \`estimated\`; not verified by the harness, so it is only as trustworthy as the command that wrote it.`;
}

export function buildGaps(
  trials: readonly TrialRow[],
  evaluations: readonly EvaluationRow[],
  integrity?: TraceIntegrity,
  budget?: BudgetState,
  judgeMethods?: readonly string[],
  /** Candidates whose spec lets them report their own spend (`cli.reports_usage`). */
  selfReporting: readonly string[] = [],
): string {
  const lines: string[] = [
    "# GAPS — fields the protocol wants that this run did not observe",
    "",
    "Every field below is recorded as `null` or `not_applicable`, never defaulted to a measured-looking value.",
    "",
  ];
  const overBudget = budget ? budgetGap(budget) : null;
  if (overBudget !== null) lines.push(overBudget);
  if (integrity && integrity.gaps_over_threshold > 0) {
    lines.push(
      `- **wall-clock integrity**: ${integrity.gaps_over_threshold} gap(s) with nothing in flight, longer than ${Math.round(integrity.threshold_ms / 60000)} min between consecutive trace events (longest ${(integrity.longest_gap_ms / 60000).toFixed(1)} min). The host likely suspended the process; durations, timeouts and p50/p95 in this run are unreliable.`,
    );
  }
  const sawCache = trials.some((t) => t.tokens.cached !== null && t.tokens.cached > 0);
  const sawProvider = trials.some((t) => t.deployment_ref !== null);
  const evaluatorErrors = evaluations.filter((e) => e.state === "evaluator_error").length;

  const unpriced = unobservedCostGap(trials);
  if (unpriced !== null) lines.push(unpriced);
  const selfReported = selfReportedCostGap(trials, selfReporting);
  if (selfReported !== null) lines.push(selfReported);
  lines.push("- `ttft_ms`: non-streaming calls; no time to first token.");
  lines.push(
    sawCache
      ? "- `cache`: OpenRouter reported cached prompt tokens on some calls; recorded under `tokens.cached`, no cache cost breakdown."
      : "- `cache`: no cached prompt tokens reported on any call; cache economics not observable.",
  );
  lines.push(
    sawProvider
      ? "- `deployment_ref.region / tier`: provider name observed via OpenRouter; region and service tier are not exposed."
      : "- `deployment_ref`: OpenRouter did not return a provider on these calls.",
  );
  lines.push("- `human_intervention`: single-call producers, no interactive execution; recorded as not applicable.");
  lines.push("- `tool_calls`: producers make no tool calls this milestone.");
  lines.push("- `checkpoint`: not applicable to single-call trials.");
  lines.push(
    "- transport retry: model-API calls retry transient failures (HTTP 408/409/425/429, 5xx, network) twice with exponential backoff and no jitter; per-trial retry counts are not in scores.jsonl, only retry cost.",
  );
  const infra = infraGap(trials);
  if (infra !== null) lines.push(infra);
  lines.push(
    evaluatorErrors > 0
      ? `- evaluator errors: ${evaluatorErrors} evaluator invocation(s) failed and are recorded as evaluator_error rows (excluded from candidate rates).`
      : "- evaluator errors: none in this run.",
  );
  if (judgeMethods && !judgeMethods.includes("absolute-1-5")) {
    lines.push(
      "- absolute 1–5 scoring: **not run** — the spec declares `methods` without `absolute-1-5`. Magnitude is therefore not observed at all in this run; the empty score columns are a declaration, not a failure.",
    );
  }
  if (judgeMethods && !judgeMethods.includes("pairwise-swap")) {
    lines.push("- pairwise judging: **not run** — the spec declares `methods` without `pairwise-swap`. No preference direction is observed in this run.");
  }
  const saturation = saturationGap(judgeDiscrimination(trials));
  if (saturation !== null) lines.push(saturation);
  lines.push(...itemGaps(itemStats(trials)));
  lines.push("- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector reads the pairwise score only to rank judge-preference, and to break a tie on assurance in highest-assurance.");
  lines.push("- statistical uncertainty: the chosen candidate's gated rates carry Wilson 95% intervals, and a highest-assurance pick must beat the runner-up on an exact sign test over inputs (recommendation.json `evidence`). Inputs generated from one template are still treated as independent, which overstates certainty when they share a template.");
  return lines.join("\n") + "\n";
}

/** GAPS.md for a finished run, from what the bundle on disk records. */
export function gapsFor(bundle: { manifest: RunManifest; trials: readonly TrialRow[]; evaluations: readonly EvaluationRow[]; summary: CanonSummary }): string {
  return buildGaps(
    bundle.trials,
    bundle.evaluations,
    bundle.summary.integrity,
    bundle.summary.budget,
    bundle.manifest.judge.methods,
    Object.entries(bundle.manifest.candidates)
      .filter(([, def]) => def.cli?.reports_usage === true)
      .map(([id]) => id),
  );
}

export async function writeCanonBundle(
  runDir: string,
  bundle: {
    manifest: RunManifest;
    trials: readonly TrialRow[];
    evaluations: readonly EvaluationRow[];
    ledger: CostLedger;
    summary: CanonSummary;
  },
): Promise<Recommendation> {
  const recommendation = recommendFromCanon(bundle.manifest, bundle.summary, bundle.trials);
  await fs.mkdir(runDir, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(runDir, "manifest.json"), JSON.stringify(bundle.manifest, null, 2), "utf-8"),
    fs.writeFile(path.join(runDir, "scores.jsonl"), jsonl(bundle.trials), "utf-8"),
    fs.writeFile(path.join(runDir, "evaluations.jsonl"), jsonl(bundle.evaluations), "utf-8"),
    fs.writeFile(path.join(runDir, "ledger.json"), JSON.stringify(bundle.ledger, null, 2), "utf-8"),
    fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify(bundle.summary, null, 2), "utf-8"),
    fs.writeFile(path.join(runDir, "recommendation.json"), JSON.stringify(recommendation, null, 2), "utf-8"),
    fs.writeFile(path.join(runDir, "items.json"), JSON.stringify(itemStats(bundle.trials), null, 2), "utf-8"),
    fs.writeFile(path.join(runDir, "GAPS.md"), gapsFor(bundle), "utf-8"),
  ]);
  return recommendation;
}
