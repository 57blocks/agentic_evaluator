/**
 * Writes the canonical run bundle (protocol §12) next to the legacy outputs.
 *
 *   manifest.json      what was tested (written before generation, finalized after)
 *   scores.jsonl       one row per trial
 *   evaluations.jsonl  one row per evaluator invocation, including errors
 *   ledger.json        itemized cost
 *   summary.json       per-candidate rates + directionality
 *   recommendation.json eligibility filters + operating-mode choice (pure)
 *   GAPS.md            fields the protocol wants that this run could not observe
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { CostLedger } from "./cost.js";
import type { RunManifest } from "./manifest.js";
import type { CandidateRates, Directionality } from "./rates.js";
import type { EvaluationRow, TrialRow } from "./rows.js";
import { recommendFromCanon, type Recommendation } from "./select.js";
import { budgetGap, type BudgetState } from "./budget.js";
import { judgeDiscrimination, saturationGap, type JudgeDiscrimination } from "./discrimination.js";
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

export function buildGaps(
  trials: readonly TrialRow[],
  evaluations: readonly EvaluationRow[],
  integrity?: TraceIntegrity,
  budget?: BudgetState,
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
  const providerErrors = trials.filter((t) => t.completion_state === "provider_error").length;
  const evaluatorErrors = evaluations.filter((e) => e.state === "evaluator_error").length;

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
    providerErrors > 0
      ? `- transport retry: ${providerErrors} provider_error attempt(s) were recorded as candidate results; automatic transport retry is not implemented yet, so they may over-count candidate failures.`
      : "- transport retry: not implemented; no provider_error occurred in this run.",
  );
  lines.push(
    evaluatorErrors > 0
      ? `- evaluator errors: ${evaluatorErrors} evaluator invocation(s) failed and are recorded as evaluator_error rows (excluded from candidate rates).`
      : "- evaluator errors: none in this run.",
  );
  const saturation = saturationGap(judgeDiscrimination(trials));
  if (saturation !== null) lines.push(saturation);
  lines.push("- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector does not use pairwise win rate.");
  lines.push("- statistical uncertainty: no interval estimates yet; results are labeled directional (see summary.json) and recommendation.json firmness follows that label.");
  return lines.join("\n") + "\n";
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
    fs.writeFile(
      path.join(runDir, "GAPS.md"),
      buildGaps(bundle.trials, bundle.evaluations, bundle.summary.integrity, bundle.summary.budget),
      "utf-8",
    ),
  ]);
  return recommendation;
}
