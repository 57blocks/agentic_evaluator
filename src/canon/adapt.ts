/**
 * Adapter: harness records → canonical rows. Pure.
 *
 * The harness keeps its own RunRecord / Judgement / ScoreRecord so `aggregate`
 * and the legacy report stay byte-for-byte reproducible; this module derives
 * the protocol-shaped rows from them plus the evaluator failures the legacy
 * path used to drop.
 */

import type { JudgedPair } from "../judge.js";
import type { RunRecord, ScoreRecord, Winner } from "../types.js";
import { decideTaskOutcome } from "./success.js";
import type { CheckCell, DimensionDetail, EvaluationRow, TrialRow } from "./rows.js";
import type { EvaluatorUsage } from "./usage.js";
import type { SuccessCriteria } from "./types.js";

export interface ScoredRecord extends ScoreRecord {
  usage: EvaluatorUsage;
}

export interface PairFailure {
  input: string;
  a: string;
  b: string;
  message: string;
  usage: EvaluatorUsage;
}

export interface TrialFailure {
  candidate: string;
  input: string;
  trial: number;
  message: string;
  usage: EvaluatorUsage;
}

export interface SkippedPair {
  input: string;
  a: string;
  b: string;
  reason: string;
}

export interface EvaluatorVersions {
  check: string | null;
  pairwise: string;
  absolute: string;
}

export interface AdaptInput {
  runId: string;
  step: string;
  requiredChecks: readonly string[];
  successCriteria?: SuccessCriteria;
  checkId: string;
  pairwiseId: string;
  absoluteId: string;
  versions: EvaluatorVersions;
  records: readonly RunRecord[];
  judgements: readonly JudgedPair[];
  judgeFailures: readonly PairFailure[];
  skippedPairs: readonly SkippedPair[];
  scores: readonly ScoredRecord[];
  scoreFailures: readonly TrialFailure[];
}

const EVIDENCE_CHARS = 600;

/** The legacy pairwise path judges only the first ok output per (candidate, input). */
export function representativeTrial(records: readonly RunRecord[], candidate: string, input: string): number | null {
  const hit = records.find((r) => r.candidate === candidate && r.inputSlug === input && r.status === "ok" && r.text.trim() !== "");
  return hit ? hit.trial : null;
}

function checkCells(input: AdaptInput, r: RunRecord): Record<string, CheckCell> {
  if (!input.requiredChecks.includes(input.checkId) || r.checkState === undefined) return {};
  return {
    [input.checkId]: {
      state: r.checkState,
      version: r.checkVersion ?? input.versions.check ?? "unknown",
      evidence: r.checkOutput ? r.checkOutput.slice(0, EVIDENCE_CHARS) : undefined,
    },
  };
}

function pairwiseFor(input: AdaptInput, r: RunRecord): TrialRow["judge"]["pairwise"] {
  if (representativeTrial(input.records, r.candidate, r.inputSlug) !== r.trial) return null;
  const mine = input.judgements.filter((j) => j.inputSlug === r.inputSlug && (j.a === r.candidate || j.b === r.candidate));
  if (mine.length === 0) return null;
  return mine.map((j) => {
    const side: Winner = j.a === r.candidate ? "a" : "b";
    const resolved = j.overall.resolved === "tie" ? "tie" : j.overall.resolved === side ? "win" : "loss";
    return { vs: j.a === r.candidate ? j.b : j.a, resolved };
  });
}

export function toTrialRows(input: AdaptInput): TrialRow[] {
  return input.records.map((r) => {
    const completion = r.completionState ?? (r.status === "ok" ? "success" : "malformed");
    const checks = checkCells(input, r);
    const decision = decideTaskOutcome({
      criteria: input.successCriteria,
      requiredChecks: input.requiredChecks,
      completion,
      checks: Object.entries(checks).map(([evaluator, c]) => ({ evaluator, version: c.version, state: c.state, reason: c.reason })),
    });
    const score = input.scores.find((s) => s.candidate === r.candidate && s.inputSlug === r.inputSlug && s.trial === r.trial);
    return {
      run: input.runId,
      step: input.step,
      candidate: r.candidate,
      model_ref: r.modelRef ?? r.candidate,
      deployment_ref: r.deploymentRef ?? null,
      input: r.inputSlug,
      trial: r.trial,
      trial_hash: r.trialHash ?? "",
      completion_state: completion,
      truncated: r.truncated ?? false,
      task_outcome: decision.outcome,
      outcome_reasons: decision.reasons,
      rule_version: decision.ruleVersion,
      checks,
      judge: {
        pairwise: pairwiseFor(input, r),
        absolute_overall: score?.overall ?? null,
        absolute_dimensions: score ? { ...score.dimensions } : null,
      },
      cost: { generation: r.costUsd, source: r.costSource ?? (r.costUsd > 0 ? "provider-reported" : "none") },
      tokens: { prompt: r.promptTokens, completion: r.completionTokens, cached: r.cachedTokens ?? null },
      ms: r.ms,
      ttft_ms: null,
      cache: null,
      finish_reason: r.finishReason ?? null,
      error: r.error ?? null,
      legacy_status: r.status,
      legacy_check_passed: r.checkPassed ?? null,
      reused_from: r.reusedFrom ?? null,
    };
  });
}

const costOf = (u: EvaluatorUsage): EvaluationRow["cost"] => ({
  usd: u.costUsd,
  retry_usd: u.retryCostUsd,
  source: u.costSource,
  calls: u.calls,
});

export function toEvaluationRows(input: AdaptInput): EvaluationRow[] {
  const base = { run: input.runId, step: input.step };
  const rows: EvaluationRow[] = [];

  for (const r of input.records) {
    for (const [evaluator, cell] of Object.entries(checkCells(input, r))) {
      rows.push({
        ...base,
        evaluator,
        version: cell.version,
        state: cell.state,
        subject: { kind: "trial", candidate: r.candidate, input: r.inputSlug, trial: r.trial },
        evidence: cell.evidence,
        reason: cell.reason,
      });
    }
  }

  for (const j of input.judgements) {
    const dimensions: Record<string, Winner> = {};
    const dimensionDetail: Record<string, DimensionDetail> = {};
    for (const [k, v] of Object.entries(j.dimensions)) {
      dimensions[k] = v.resolved;
      dimensionDetail[k] = {
        forward: v.forward,
        reverse: v.reverse,
        resolved: v.resolved,
        ...(v.reason ? { reason: v.reason } : {}),
      };
    }
    rows.push({
      ...base,
      evaluator: input.pairwiseId,
      version: input.versions.pairwise,
      state: "pass",
      subject: { kind: "pair", a: j.a, b: j.b, input: j.inputSlug },
      dimensions,
      dimension_detail: dimensionDetail,
      overall: j.overall.resolved,
      evidence: j.overall.reason,
      cost: costOf(j.usage),
      ms: j.usage.ms,
    });
  }
  for (const f of input.judgeFailures) {
    rows.push({
      ...base,
      evaluator: input.pairwiseId,
      version: input.versions.pairwise,
      state: "evaluator_error",
      subject: { kind: "pair", a: f.a, b: f.b, input: f.input },
      reason: f.message,
      cost: costOf(f.usage),
      ms: f.usage.ms,
    });
  }
  for (const s of input.skippedPairs) {
    rows.push({
      ...base,
      evaluator: input.pairwiseId,
      version: input.versions.pairwise,
      state: "not_evaluated",
      subject: { kind: "pair", a: s.a, b: s.b, input: s.input },
      reason: s.reason,
    });
  }

  for (const s of input.scores) {
    rows.push({
      ...base,
      evaluator: input.absoluteId,
      version: input.versions.absolute,
      state: "pass",
      subject: { kind: "trial", candidate: s.candidate, input: s.inputSlug, trial: s.trial },
      score: s.overall,
      dimensions: { ...s.dimensions },
      overall: s.overall,
      cost: costOf(s.usage),
      ms: s.usage.ms,
    });
  }
  for (const f of input.scoreFailures) {
    rows.push({
      ...base,
      evaluator: input.absoluteId,
      version: input.versions.absolute,
      state: "evaluator_error",
      subject: { kind: "trial", candidate: f.candidate, input: f.input, trial: f.trial },
      reason: f.message,
      cost: costOf(f.usage),
      ms: f.usage.ms,
    });
  }

  return rows;
}
