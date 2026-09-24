/**
 * View-model helpers — data in, data out, no DOM and no JSX.
 *
 * These are the functions that decide what a reader is told: "needs review"
 * instead of a blank cell, a budget overrun called out rather than left to
 * arithmetic, a task whose every candidate was a scripted stand-in kept out
 * of the evidence list. Keeping them here means Node can unit-test the
 * decisions without rendering anything.
 */

import type { RunView, TaskView } from "../../catalog.js";
import { NEEDS_REVIEW } from "./copy.js";

export function runDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/**
 * What identifies a run to a reader: when it started. Its `runName` is the
 * task's, so on a task's own page every run would otherwise carry the same
 * label — the clock is the only thing that tells two of them apart.
 */
export function runStamp(run: RunView): string {
  return (run.startedAt ?? run.id).slice(0, 16).replace("T", " ");
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
  return { text: `${spent} / $${task.budgetUsd}${over ? " over budget" : ""}`, over };
}

/**
 * What the task's most recent run concluded, per step — the column you scan
 * down. Null means the task has never run, which the list must say out loud
 * rather than leave as a blank cell.
 */
export function latestVerdict(task: TaskView): string[] | null {
  const run = task.runs[0];
  return run ? run.steps.map((s) => s.chosen ?? NEEDS_REVIEW) : null;
}

/** A task whose every run used scripted stand-ins proves the pipeline, not a model. */
export function isSmokeTask(task: TaskView): boolean {
  return task.runs.length > 0 && task.runs.every((r) => r.synthetic);
}

/** The definition file a task page should open on. */
export function defaultFile(files: readonly string[]): string | undefined {
  return files.find((f) => f === "spec.yaml") ?? files[0];
}

/**
 * The report a run opens on: the workflow page for a multi-step run (it links
 * down to each step), the step's own report otherwise.
 */
export function primaryReportDir(run: RunView): string {
  return run.kind === "workflow" ? run.dir : (run.steps[0]?.dir ?? run.dir);
}
