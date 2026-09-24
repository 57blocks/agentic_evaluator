/**
 * What the live terminal view knows about a run, as a fold over its events.
 *
 * Pure, so the view can be a function of this and nothing else, and so the
 * counting can be tested without a terminal. The wording of every permanent
 * line still comes from `formatEvent`: the live view decides only which lines
 * are worth keeping, never how they read.
 */

import type { Phase, RunEvent, StepPlan } from "../core/events.js";
import { formatEvent } from "./print.js";

export interface Tally {
  /** Dispatched (judge, score) or resolved (generations), including failures. */
  done: number;
  /** From the plan; null when nothing announced one. */
  total: number | null;
  failed: number;
}

export interface Counts {
  generations: Tally;
  judging: Tally;
  scoring: Tally;
}

export interface LogLine {
  id: number;
  text: string;
}

export interface Progress {
  /** Lines that stay on screen once written: plans, warnings, failures, summaries. */
  log: readonly LogLine[];
  plans: Readonly<Record<string, StepPlan>>;
  /** Generations in one e2e arm, once a workflow has announced its arms. */
  perArm: number | null;
  /** The step or e2e arm the live block is about; null between steps. */
  active: string | null;
  /** Set while an e2e arm runs, so its trials count against the arm. */
  arm: string | null;
  phase: Phase | null;
  counts: Readonly<Record<string, Counts>>;
  /** Generation spend reported so far; judge and score costs arrive only with step.done. */
  spentUsd: number;
  finished: boolean;
}

export function initialProgress(): Progress {
  return { log: [], plans: {}, perArm: null, active: null, arm: null, phase: null, counts: {}, spentUsd: 0, finished: false };
}

function tally(total: number | null): Tally {
  return { done: 0, total, failed: 0 };
}

function countsFor(p: Progress, key: string): Counts {
  const existing = p.counts[key];
  if (existing) return existing;
  const plan = p.plans[key];
  if (plan) return { generations: tally(plan.generations), judging: tally(plan.pairs), scoring: tally(plan.scoreCalls) };
  return { generations: tally(key === p.arm ? p.perArm : null), judging: tally(null), scoring: tally(null) };
}

function bump(p: Progress, key: string, which: keyof Counts, by: { done?: number; failed?: number }): Progress {
  const counts = countsFor(p, key);
  const t = counts[which];
  const next: Tally = { ...t, done: t.done + (by.done ?? 0), failed: t.failed + (by.failed ?? 0) };
  return { ...p, active: key, counts: { ...p.counts, [key]: { ...counts, [which]: next } } };
}

function withLines(p: Progress, event: RunEvent): Progress {
  const lines = formatEvent(event);
  if (lines.length === 0) return p;
  const added = lines.map((text, i) => ({ id: p.log.length + i, text }));
  return { ...p, log: [...p.log, ...added] };
}

function reduceTrial(p: Progress, e: Extract<RunEvent, { type: "trial" }>): Progress {
  const key = p.arm ?? e.step;
  const isFailure = e.state === "skipped" || e.error !== undefined;
  const counted = bump(p, key, "generations", { done: 1, failed: isFailure ? 1 : 0 });
  const spent = { ...counted, spentUsd: counted.spentUsd + (e.costUsd ?? 0) };
  return isFailure ? withLines(spent, e) : spent;
}

export function reduceProgress(p: Progress, e: RunEvent): Progress {
  switch (e.type) {
    case "step.planned":
      return withLines({ ...p, plans: { ...p.plans, [e.plan.step]: e.plan } }, e);
    case "workflow.planned":
      return withLines({ ...p, perArm: e.e2e.perArm }, e);
    case "phase":
      return withLines({ ...p, active: e.step, phase: e.phase }, e);
    case "trial":
      return reduceTrial(p, e);
    case "judge":
      return e.ok ? bump(p, e.step, "judging", { done: 1 }) : withLines(bump(p, e.step, "judging", { failed: 1 }), e);
    case "score":
      return e.ok ? bump(p, e.step, "scoring", { done: 1 }) : withLines(bump(p, e.step, "scoring", { failed: 1 }), e);
    case "e2e.arm.start":
      return withLines({ ...p, arm: e.armId, active: e.armId, phase: "generating" }, e);
    case "e2e.arm.done":
      return withLines({ ...p, arm: null, active: null, phase: null }, e);
    case "step.done":
      return withLines({ ...p, active: null, phase: null }, e);
    case "run.done":
      return withLines({ ...p, finished: true }, e);
    default:
      return withLines(p, e);
  }
}
