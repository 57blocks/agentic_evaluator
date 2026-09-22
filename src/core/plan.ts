/**
 * What a run will do, before it does any of it.
 *
 * Plans are pure: given the compiled suites, they say how many generations,
 * pairwise comparisons and absolute scores a run incurs, and nothing else
 * happens. That is what makes a preview trustworthy, and it is what the
 * dashboard's budget gate echoes back before anything is billed.
 */

import { orderControlChain } from "../canon/e2e.js";
import type { JudgeMethod, Suite } from "../types.js";
import type { E2ePlan, StepPlan } from "./events.js";

/** Fallback max concurrent LLM calls when neither the spec nor EVAL_CONCURRENCY says. */
const DEFAULT_CONCURRENCY = 5;

/** Below this many inputs a comparison can only report a direction. */
const MIN_INPUTS_FOR_MAGNITUDE = 10;

/** The spec wins over the environment: a step that declares a limit means it. */
export function resolveConcurrency(suite: Suite): number {
  if (suite.concurrency && suite.concurrency > 0) return suite.concurrency;
  const parsed = parseInt(process.env.EVAL_CONCURRENCY ?? "", 10);
  return Number.isNaN(parsed) ? DEFAULT_CONCURRENCY : Math.max(1, parsed);
}

/**
 * Methods the step declared.
 *
 * Absent means both — that is what a spec written before the key existed
 * means. An empty list means neither; see `judgeMethodsOf` in the loader for
 * why the two must not collapse.
 */
export function methodsOf(suite: Suite): { pairwise: boolean; absolute: boolean } {
  const declared: readonly JudgeMethod[] = suite.judgeMethods ?? ["pairwise-swap", "absolute-1-5"];
  return { pairwise: declared.includes("pairwise-swap"), absolute: declared.includes("absolute-1-5") };
}

export function planStep(suite: Suite, opts: { reuse?: boolean } = {}): StepPlan {
  const candidates = suite.candidates.length;
  const inputs = suite.inputs.length;
  const trials = suite.trials ?? 2;
  const { pairwise, absolute } = methodsOf(suite);
  const pairs = pairwise ? (inputs * candidates * (candidates - 1)) / 2 : 0;
  return {
    step: suite.step,
    suiteId: suite.suiteId,
    producer: suite.producer ?? "prompt",
    candidates,
    inputs,
    trials,
    generations: candidates * inputs * trials,
    pairs,
    judgeCalls: pairs * 2,
    scoreCalls: absolute ? candidates * inputs * trials : 0,
    judge: suite.judge,
    concurrency: resolveConcurrency(suite),
    reuse: opts.reuse ?? false,
    budgetUsd: suite.budgetUsd ?? null,
    benchmarkMode: suite.benchmarkMode ?? "capability-neutral",
    cacheMode: suite.cacheMode ?? "cold",
    directional: inputs < MIN_INPUTS_FOR_MAGNITUDE || suite.mmd == null,
  };
}

/**
 * The chained steps, in handoff order, or null when the spec declares none.
 * Independent steps are evaluated but never validated end to end. Ordering is
 * `orderControlChain`'s job — one definition of what a chain is.
 */
export function e2eChain(suites: readonly Suite[]): Suite[] | null {
  const ids = orderControlChain(suites.map((s) => ({ id: s.step, inputFrom: s.inputFrom })));
  if (!ids) return null;
  const byId = new Map(suites.map((s) => [s.step, s]));
  return ids.map((id) => byId.get(id)!);
}

export function planE2e(suites: readonly Suite[]): E2ePlan | null {
  const chain = e2eChain(suites);
  if (!chain) return null;
  const root = chain[0];
  const trials = root.trials ?? 2;
  return {
    controlCandidate: root.controlCandidate ?? null,
    chain: chain.map((s) => s.step),
    perArm: root.inputs.length * trials * chain.length,
  };
}

export interface WorkflowPlan {
  steps: StepPlan[];
  e2e: E2ePlan | null;
  /** Generations across every step, plus both end-to-end arms at their upper bound. */
  totalGenerations: number;
  totalJudgeCalls: number;
  totalScoreCalls: number;
}

export function planWorkflow(suites: readonly Suite[], opts: { reuse?: boolean } = {}): WorkflowPlan {
  const steps = suites.map((s) => planStep(s, opts));
  const e2e = planE2e(suites);
  return {
    steps,
    e2e,
    totalGenerations: steps.reduce((n, s) => n + s.generations, 0) + (e2e ? e2e.perArm * 2 : 0),
    totalJudgeCalls: steps.reduce((n, s) => n + s.judgeCalls, 0),
    totalScoreCalls: steps.reduce((n, s) => n + s.scoreCalls, 0),
  };
}
