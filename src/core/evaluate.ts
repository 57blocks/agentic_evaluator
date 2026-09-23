/**
 * Evaluation: the judge and the scorer.
 *
 * A failed evaluator call is kept as an `evaluator_error` row with its cost
 * rather than vanishing, and a pair where one side produced nothing is
 * recorded as `not_evaluated`. Neither is the same as "no problem found",
 * which is the distinction this whole layer exists to preserve.
 */

import { type LlmTrace } from "../llm.js";
import { judgePair, type JudgedPair } from "../judge.js";
import { scoreOne } from "../score.js";
import { mapWithConcurrency } from "./generate.js";
import type { RunEventSink } from "./events.js";
import { BudgetGuard } from "../canon/budget.js";
import type { PairFailure, ScoredRecord, SkippedPair, TrialFailure } from "../canon/adapt.js";
import { EvaluatorCallError, summarizeAttempts, type EvaluatorUsage } from "../canon/usage.js";
import type { Judgement, RunRecord, Suite, Winner } from "../types.js";

export function representative(records: readonly RunRecord[], candidate: string, inputSlug: string): string | null {
  const hit = records.find((r) => r.candidate === candidate && r.inputSlug === inputSlug && r.status === "ok" && r.text.trim() !== "");
  return hit ? hit.text : null;
}

interface JudgeTask {
  inputSlug: string;
  a: string;
  aText: string;
  b: string;
  bText: string;
}

export interface JudgeOutcome {
  judgements: JudgedPair[];
  failures: PairFailure[];
  skipped: SkippedPair[];
}

function usageOfError(err: unknown): EvaluatorUsage {
  return err instanceof EvaluatorCallError ? summarizeAttempts(err.attempts) : summarizeAttempts([]);
}

/**
 * Pairwise judge every candidate pair, per input. A failed judge call is kept
 * as an evaluator_error (with its cost) instead of vanishing; a pair where one
 * side produced no output is recorded as not_evaluated.
 */
export async function judgeAll(
  suite: Suite,
  rubric: string,
  records: readonly RunRecord[],
  limit: number,
  trace: LlmTrace,
  budget: BudgetGuard,
  emit: RunEventSink,
): Promise<JudgeOutcome> {
  const tasks: JudgeTask[] = [];
  const skipped: SkippedPair[] = [];
  for (const inputSlug of suite.inputs) {
    for (let i = 0; i < suite.candidates.length; i++) {
      for (let j = i + 1; j < suite.candidates.length; j++) {
        const a = suite.candidates[i];
        const b = suite.candidates[j];
        const aText = representative(records, a, inputSlug);
        const bText = representative(records, b, inputSlug);
        if (!aText || !bText) {
          const missing = [!aText ? a : null, !bText ? b : null].filter((x): x is string => x !== null);
          skipped.push({ input: inputSlug, a, b, reason: `no successful output from ${missing.join(" and ")}` });
          continue;
        }
        tasks.push({ inputSlug, a, aText, b, bText });
      }
    }
  }

  const failures: PairFailure[] = [];
  const results = await mapWithConcurrency(tasks, limit, async (task): Promise<JudgedPair | null> => {
    if (!budget.allows("judging")) {
      skipped.push({ input: task.inputSlug, a: task.a, b: task.b, reason: "budget limit reached before this pair was judged" });
      return null;
    }
    emit({ type: "judge", step: suite.step, a: task.a, b: task.b, input: task.inputSlug, ok: true });
    try {
      const judged = await judgePair({
        judgeModel: suite.judge,
        timeoutMs: suite.timeoutMs ?? 240_000,
        rubric,
        dimensions: suite.dimensions ?? [],
        inputSlug: task.inputSlug,
        a: task.a,
        aText: task.aText,
        b: task.b,
        bText: task.bText,
        trace,
      });
      budget.add(judged.usage?.costUsd ?? 0);
      return judged;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      budget.add(usageOfError(err).costUsd);
      emit({ type: "judge", step: suite.step, a: task.a, b: task.b, input: task.inputSlug, ok: false, error: message });
      failures.push({ input: task.inputSlug, a: task.a, b: task.b, message, usage: usageOfError(err) });
      return null;
    }
  });
  return { judgements: results.filter((j): j is JudgedPair => j !== null), failures, skipped };
}

export interface ScoreHooks {
  trace?: LlmTrace;
  onScored?: (record: ScoredRecord) => void;
  onFailure?: (failure: TrialFailure) => void;
  /** Absent when the caller renders its own progress. */
  emit?: RunEventSink;
}

/**
 * Absolute 1–5 grade for every OK output.
 *
 * Everything it produces leaves through the hooks — the graded record, the
 * failures, the usage. It used to also return a stripped copy for the legacy
 * aggregate; that consumer is gone, and a second path out of the same
 * function is a second thing to keep in agreement with the first.
 */
export async function scoreAll(
  suite: Suite,
  rubric: string,
  records: readonly RunRecord[],
  limit: number,
  hooks: ScoreHooks = {},
  budget?: BudgetGuard,
): Promise<void> {
  const dimensions = suite.dimensions ?? [];
  const oks = records.filter((r) => r.status === "ok" && r.text.trim());
  await mapWithConcurrency(oks, limit, async (r): Promise<void> => {
    if (budget && !budget.allows("scoring")) return;
    hooks.emit?.({ type: "score", step: suite.step, candidate: r.candidate, input: r.inputSlug, trial: r.trial, ok: true });
    try {
      const s = await scoreOne({
        judgeModel: suite.judge,
        rubric,
        dimensions,
        text: r.text,
        timeoutMs: suite.timeoutMs ?? 240_000,
        trace: hooks.trace,
        traceContext: { candidate: r.candidate, input: r.inputSlug, trial: r.trial },
      });
      const scored: ScoredRecord = {
        candidate: r.candidate,
        inputSlug: r.inputSlug,
        trial: r.trial,
        dimensions: s.dimensions,
        overall: s.overall,
        reasons: s.reasons,
        usage: s.usage,
      };
      budget?.add(s.usage.costUsd + s.usage.retryCostUsd);
      hooks.onScored?.(scored);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      hooks.emit?.({ type: "score", step: suite.step, candidate: r.candidate, input: r.inputSlug, trial: r.trial, ok: false, error: message });
      const failureUsage = usageOfError(err);
      budget?.add(failureUsage.costUsd + failureUsage.retryCostUsd);
      hooks.onFailure?.({ candidate: r.candidate, input: r.inputSlug, trial: r.trial, message, usage: failureUsage });
    }
  });
}

/**
 * Win rate (0..100, tie = 0.5) for one candidate on one axis, or null when it
 * had no comparisons on that axis.
 */
export function winRateFor(candidate: string, judgements: readonly Judgement[], pick: (jm: Judgement) => Winner | undefined): number | null {
  let wins = 0;
  let comparisons = 0;
  for (const jm of judgements) {
    const resolved = pick(jm);
    if (resolved === undefined) continue;
    if (jm.a === candidate) {
      comparisons++;
      if (resolved === "a") wins += 1;
      else if (resolved === "tie") wins += 0.5;
    } else if (jm.b === candidate) {
      comparisons++;
      if (resolved === "b") wins += 1;
      else if (resolved === "tie") wins += 0.5;
    }
  }
  return comparisons > 0 ? (wins / comparisons) * 100 : null;
}

/** Legacy aggregate — semantics unchanged from the original harness. */
