/**
 * What a run emits while it happens.
 *
 * The driver used to print. That made the console the only possible audience:
 * a dashboard could not follow a run in progress, a `--json` mode could not
 * exist, and a test could only assert on stdout. Every one of those printed
 * lines is now an event with the fields the line was built from, and
 * rendering is somebody else's job — `src/cli/print.ts` for a terminal, an
 * SSE stream for the dashboard.
 *
 * Rules for events, learned from the trace format next door:
 *   - carry the values, not a formatted sentence;
 *   - never carry prompt or output text (a trace event already refuses to);
 *   - an event is emitted for what happened, including nothing happening —
 *     "judging off by spec" is an event, because a silent absence is exactly
 *     what this project refuses to let a report contain.
 */

import type { CompletionState } from "../canon/types.js";

/** Counts a step will incur — what `plan()` returns, and what a preview prints. */
export interface StepPlan {
  step: string;
  suiteId: string;
  producer: string;
  candidates: number;
  inputs: number;
  trials: number;
  generations: number;
  /** Pairwise comparisons; 0 when the method is not declared. */
  pairs: number;
  /** Judge calls, two per pair (each order). */
  judgeCalls: number;
  /** Absolute-scoring calls; 0 when the method is not declared. */
  scoreCalls: number;
  judge: string;
  concurrency: number;
  reuse: boolean;
  budgetUsd: number | null;
  benchmarkMode: string;
  cacheMode: string;
  /** True when this step can only report a direction, not a magnitude. */
  directional: boolean;
}

/** The end-to-end arms a chained workflow would add on top of the step plans. */
export interface E2ePlan {
  controlCandidate: string | null;
  chain: string[];
  /** Generations in one arm. */
  perArm: number;
}

export type Phase = "generating" | "judging" | "scoring";

export type RunEvent =
  /** One per step, before anything executes. */
  | { type: "step.planned"; plan: StepPlan }
  | { type: "workflow.planned"; e2e: E2ePlan }
  /** The spec was previewed and not executed: no confirmation was given. */
  | { type: "preview.only" }
  | { type: "phase"; step: string; phase: Phase; declared: boolean }
  /** One generation attempt resolved — including one that was reused or skipped. */
  | {
      type: "trial";
      step: string;
      candidate: string;
      input: string;
      trial: number;
      state: CompletionState | "error" | "skipped";
      ms?: number;
      costUsd?: number;
      costSource?: string;
      /** Required-check state, when the step declares one. */
      check?: string;
      /** Run directory a prior identical generation came from. */
      reusedFrom?: string;
      error?: string;
    }
  | { type: "judge"; step: string; a: string; b: string; input: string; ok: boolean; error?: string }
  | { type: "score"; step: string; candidate: string; input: string; trial: number; ok: boolean; error?: string }
  | {
      type: "budget.stopped";
      limitUsd: number | null;
      spentUsd: number;
      skipped: { generation: number; judging: number; scoring: number };
    }
  /** Wall-clock gaps that make every duration in this run unreliable. */
  | { type: "integrity.gaps"; gaps: number; thresholdMs: number }
  | {
      type: "step.done";
      step: string;
      dir: string;
      trials: number;
      evaluations: number;
      traceEvents: number;
      ledgerTotal: number;
      ledgerSource: string;
      chosen: string | null;
      firmness: string;
      html: boolean;
      /** The legacy markdown report, kept so a terminal can still show it. */
      markdown?: string;
    }
  | { type: "e2e.arm.start"; armId: string; assignment: Record<string, string> }
  | {
      type: "e2e.arm.done";
      armId: string;
      candidate?: string;
      success: number;
      failure: number;
      undetermined: number;
    }
  | { type: "e2e.validated"; verdict: string; firmness: string; reason: string }
  | {
      type: "run.done";
      runId: string;
      dir: string;
      steps: Array<{ id: string; chosen: string | null }>;
      totalUsd: number;
      html: boolean;
    };

/** Where events go. Synchronous and never awaited: emitting must not pace a run. */
export type RunEventSink = (event: RunEvent) => void;

/** Drops everything. The default for a caller that only wants the result. */
export const silentSink: RunEventSink = () => {};
