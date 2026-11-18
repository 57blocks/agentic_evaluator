#!/usr/bin/env node
/**
 * task-breakdown, with or without agb's skills. Passes when .ab/tasks.json
 * is readable and has tasks. The score is the share of agb's REQUIRED plan
 * gates that are clean, as agb-flow-v3 calibrated them on the adopted plans
 * (demo-todo, chessicle, invoice; all clean): page-coverage (every page has
 * a task), contract-coverage (every endpoint is claimed), plan-domain-cycle
 * (domains do not depend in a cycle). The heuristics (task size, vague file
 * lists, AC claims) are counted, never scored.
 */

import { agb, confirmArm, countByGate, ensureGit, finish, finishScored, readJson } from "./lib.mjs";

const REQUIRED = ["page-coverage", "contract-coverage", "plan-domain-cycle"];
const RECORDED = ["ac-task-coverage", "task-granularity", "task-files-vague"];

confirmArm();
const plan = readJson(".ab/tasks.json");
if (!plan) finish(1, "no readable .ab/tasks.json was produced", "no plan");
const tasks = (plan.domains ?? []).reduce((n, d) => n + (d.tasks?.length ?? 0), 0);
if (tasks === 0) finish(1, ".ab/tasks.json contains no tasks", "empty plan");

ensureGit();
const found = [];
for (const gate of [...REQUIRED, ...RECORDED]) {
  const { findings, headlines } = agb(["check", "--all", `--gate=${gate}`, "--stage=tasks"]);
  for (const f of findings) found.push({ ...f, text: headlines.find((h) => h.gate === f.gate)?.text ?? f.message ?? "" });
}
const noted = found.filter((f) => RECORDED.includes(f.gate));
const unit = (gate) => {
  const own = found.filter((f) => f.gate === gate && (f.severity === "hard" || f.severity === "partial"));
  return { name: gate, clean: own.length === 0, detail: own.length ? `${own.length} finding(s), e.g. ${own[0].text.slice(0, 160)}` : null };
};
finishScored(`${(plan.domains ?? []).length} domains, ${tasks} tasks; heuristics (counted, not scored): ${countByGate(noted)}`, REQUIRED.map(unit));
