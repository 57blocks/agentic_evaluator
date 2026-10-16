#!/usr/bin/env node
/**
 * detail: a task plan was written, and agb's coverage and structure gates
 * find nothing wrong with it.
 *
 * Two tiers, calibrated on the plans demo-todo, chessicle and invoice adopted:
 *   REQUIRED  every page and contract endpoint has a task, and domains do not
 *             depend in a cycle. The adopted plans are clean on all three.
 *   RECORDED  heuristics (task size, vague file lists, AC claims): the adopted
 *             plans trip them often, so they are counted, never gated on.
 */

import { agb, countByGate, ensureGit, finish, readJson } from "./lib.mjs";

const REQUIRED = ["page-coverage", "contract-coverage", "plan-domain-cycle"];
const RECORDED = ["ac-task-coverage", "task-granularity", "task-files-vague"];

const plan = readJson(".ab/tasks.json");
if (!plan) finish(1, "no readable .ab/tasks.json was produced", "no plan");
const tasks = (plan.domains ?? []).reduce((n, d) => n + (d.tasks?.length ?? 0), 0);
if (tasks === 0) finish(1, ".ab/tasks.json contains no tasks", "empty plan");

ensureGit();
const found = [];
for (const gate of [...REQUIRED, ...RECORDED]) {
  const { findings, headlines } = agb(["check", "--all", `--gate=${gate}`, "--stage=detail"]);
  for (const f of findings) found.push({ ...f, text: headlines.find((h) => h.gate === f.gate)?.text ?? f.message ?? "" });
}
const blocking = found.filter((f) => f.severity === "hard" || (f.severity === "partial" && REQUIRED.includes(f.gate)));
const noted = found.filter((f) => f.severity === "partial" && RECORDED.includes(f.gate));
const summary = `${plan.domains.length} domains, ${tasks} tasks. Heuristics (recorded, not gated): ${countByGate(noted)}`;
if (blocking.length > 0) {
  finish(1, `${summary}. Fails: ${blocking.map((f) => `${f.severity} ${f.gate}: ${f.text}`).join("; ")}`, `${blocking[0].gate}: ${blocking[0].text}`);
}
finish(0, summary);
