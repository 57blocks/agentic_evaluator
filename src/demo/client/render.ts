/**
 * Pure view helpers for the demo UI — data in, HTML string out, no DOM.
 *
 * Split out of main.ts so Node can unit-test them. These are the functions
 * that decide what a reader sees: "needs review" instead of a blank cell, an
 * overspent budget called out rather than left to arithmetic. Asserting on
 * them beats grepping the served page for a substring.
 */

import type { RunView, TaskView } from "../catalog.js";

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
export function firmClass(f: string): string {
  if (f === "firm") return "ok";
  if (f === "needs-review") return "bad";
  return "warn";
}
export function firmPill(f: string): string {
  return '<span class="pill ' + firmClass(f) + '">' + escapeHtml(f) + "</span>";
}
export function chips(items: readonly string[], off?: readonly string[]): string {
  const blocked = new Set(off || []);
  const spans = items.map(function (x: string) {
    const cls = blocked.has(x) ? "chip off" : "chip";
    return '<span class="' + cls + '">' + escapeHtml(x) + "</span>";
  }).join("");
  return '<div class="chips">' + spans + "</div>";
}
export function runDate(iso: string | null): string {
  return iso ? escapeHtml(iso.slice(0, 10)) : "";
}
export function runMoney(usd: number | null): string {
  return usd == null ? "" : "$" + usd.toFixed(4);
}
/** One line under a run's name: when it ran, what it cost, and what it concluded. */
export function runMeta(run: RunView): string {
  const verdict = run.steps
    .map((s) => (s.chosen ? escapeHtml(s.chosen) : "需人工评审"))
    .join(" · ");
  return [runDate(run.startedAt), runMoney(run.totalUsd), verdict].filter(Boolean).join(" · ");
}
export function navButton(kind: string, key: string, title: string, meta: string): string {
  return '<li><button type="button" data-kind="' + kind + '" data-key="' + escapeHtml(key) +
    '"><span class="k">' + escapeHtml(title) + '</span><span class="m">' + meta + "</span></button></li>";
}

/** Budget line: what the task has spent against what its spec allows. */
export function spendLabel(task: TaskView): string {
  if (task.spentUsd == null) return "";
  const spent = "$" + task.spentUsd.toFixed(2);
  if (task.budgetUsd == null) return '<span class="spend">' + spent + "</span>";
  const over = task.spentUsd > task.budgetUsd;
  return '<span class="spend' + (over ? " over" : "") + '">' + spent + " / $" + task.budgetUsd +
    (over ? " 超支" : "") + "</span>";
}

/** What the task's most recent run concluded — the column you scan down. */
export function latestLabel(task: TaskView): string {
  const r = task.runs[0];
  if (!r) return "未跑过";
  return runDate(r.startedAt) + " · " +
    r.steps.map((s) => (s.chosen ? escapeHtml(s.chosen) : "需人工评审")).join(" / ");
}

export function taskItem(task: TaskView): string {
  const runs = task.runs.map((r) =>
    '<li><button type="button" data-kind="run" data-key="' + escapeHtml(r.id) + '">' +
      '<span class="m">' + runMeta(r) + "</span></button></li>"
  ).join("");
  return '<li>' +
    '<button type="button" data-kind="spec" data-key="' + escapeHtml(task.specPath) + '">' +
      '<span class="task-head"><span class="n">' + escapeHtml(task.name) + "</span>" +
      '<span class="c">' + task.runs.length + " 次 " + spendLabel(task) + "</span></span>" +
      '<span class="m">' + latestLabel(task) + "</span>" +
    "</button>" +
    (runs ? '<ul class="runs">' + runs + "</ul>" : "") +
    "</li>";
}

/** A task whose every run used scripted stand-ins proves the pipeline, not a model. */
export function isSmokeTask(task: TaskView): boolean {
  return task.runs.length > 0 && task.runs.every((r) => r.synthetic);
}
