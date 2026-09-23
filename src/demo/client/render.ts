/**
 * View-model helpers for the demo UI — data in, data out, no DOM and no JSX.
 *
 * These are the functions that decide what a reader is told: "needs review"
 * instead of a blank cell, a budget overrun called out rather than left to
 * arithmetic, a task whose every candidate was a scripted stand-in kept out
 * of the evidence list. Keeping them here means Node can unit-test the
 * decisions without rendering anything.
 */

import type { RunView, TaskView } from "../catalog.js";

/**
 * The four questions the protocol exists to answer. The page states them
 * because a reader who does not know what is being claimed cannot judge the
 * evidence below them.
 */
export const PROTOCOL_QUESTIONS = [
  ["1. 做对了吗", "任务结果 × 必过检查，不用平均分冒充成功"],
  ["2. 这一步用谁", "每步自己的推荐，资格门先于选型"],
  ["3. 成本还是速度", "只在合格候选里按 operating mode 选"],
  ["4. 证据能否复现", "打开本步 report.html"],
] as const;

/** Wording for a step that produced no recommendation. */
export const NEEDS_REVIEW = "需人工评审";

/** Wording for a task that exists but has never been run. */
export const NEVER_RAN = "未跑过";

export function runDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

export function runMoney(usd: number | null): string {
  return usd == null ? "" : `$${usd.toFixed(4)}`;
}

/** One line under a run: when it ran, what it cost, what it concluded. */
export function runMeta(run: RunView): string {
  const verdict = run.steps.map((s) => s.chosen ?? NEEDS_REVIEW).join(" · ");
  return [runDate(run.startedAt), runMoney(run.totalUsd), verdict].filter(Boolean).join(" · ");
}

export interface Spend {
  text: string;
  /** Spent more than the spec's declared budget. */
  over: boolean;
}

/** What a task has spent against what its spec allows. Null when nothing ran. */
export function spendLabel(task: TaskView): Spend | null {
  if (task.spentUsd == null) return null;
  const spent = `$${task.spentUsd.toFixed(2)}`;
  if (task.budgetUsd == null) return { text: spent, over: false };
  const over = task.spentUsd > task.budgetUsd;
  return { text: `${spent} / $${task.budgetUsd}${over ? " 超支" : ""}`, over };
}

/** What the task's most recent run concluded — the column you scan down. */
export function latestLabel(task: TaskView): string {
  const run = task.runs[0];
  if (!run) return NEVER_RAN;
  return `${runDate(run.startedAt)} · ${run.steps.map((s) => s.chosen ?? NEEDS_REVIEW).join(" / ")}`;
}

/** A task whose every run used scripted stand-ins proves the pipeline, not a model. */
export function isSmokeTask(task: TaskView): boolean {
  return task.runs.length > 0 && task.runs.every((r) => r.synthetic);
}

/** Badge tone for a step's recommendation firmness. */
export function firmTone(firmness: string): "ok" | "warn" | "bad" {
  if (firmness === "firm") return "ok";
  if (firmness === "needs-review") return "bad";
  return "warn";
}

/** The definition file a task page should open on. */
export function defaultFile(files: readonly string[]): string | undefined {
  return files.find((f) => f === "spec.yaml") ?? files[0];
}
