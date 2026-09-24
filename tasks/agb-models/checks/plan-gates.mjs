#!/usr/bin/env node
/**
 * Required check for the detail step: a task plan was written, and agb's own
 * plan gates find nothing wrong with it.
 *
 * Every candidate runs the same skill and only the model differs, so agb's
 * gates are a fair ruler here. Most are `partial` severity — they never make
 * ab-gate exit 1 — so the findings are read back rather than the exit code.
 *
 * Two tiers, calibrated on the plan agb's own demo adopted (762959e):
 *   REQUIRED  coverage and structure — every page and contract endpoint has a
 *             task, domains do not depend in a cycle. The adopted plan is clean
 *             on all of them; a plan that is not has a hole in it.
 *   RECORDED  heuristics — AC claims, task size, vague file lists. The adopted
 *             plan trips 12 of them (mostly "a title with 与 in it"), so they
 *             are counted in the evidence for comparison, never gated on.
 * Pass: .ab/tasks.json parses with at least one task, no hard finding from
 * any of them, and no partial finding from a REQUIRED gate.
 *
 * ab-gate runs from the agb checkout in AGB_HOME (default ~/workspace/57b/agb).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REQUIRED = ["page-coverage", "contract-coverage", "plan-domain-cycle"];
const RECORDED = ["ac-task-coverage", "task-granularity", "task-files-vague"];
const GATES = [...REQUIRED, ...RECORDED];
const home = process.env.AGB_HOME ?? path.join(os.homedir(), "workspace", "57b", "agb");
const tsx = path.join(home, "node_modules", ".bin", "tsx");
const cli = path.join(home, "packages", "ab-gate", "src", "cli.ts");
const cwd = process.cwd();

function finish(code, evidence, reason) {
  process.stdout.write(JSON.stringify({ evidence, ...(reason ? { reason } : {}) }));
  process.exit(code);
}

const planPath = path.join(cwd, ".ab", "tasks.json");
if (!existsSync(planPath)) finish(1, "没有产出 .ab/tasks.json", "no plan written");
let tasks = 0;
try {
  tasks = JSON.parse(readFileSync(planPath, "utf-8")).domains.reduce((n, d) => n + (d.tasks?.length ?? 0), 0);
} catch (e) {
  finish(1, `.ab/tasks.json 读不出来：${e.message}`, "plan unreadable");
}
if (tasks === 0) finish(1, ".ab/tasks.json 里一个任务都没有", "empty plan");
// Not the candidate's fault when the ruler is missing: exit 2 is an evaluator error.
if (!existsSync(cli)) finish(2, `找不到 ab-gate：${cli}（设置 AGB_HOME）`, "ab-gate not found");

const events = path.join(cwd, ".ab", "events.jsonl");
rmSync(events, { force: true });
for (const gate of GATES) {
  const r = spawnSync(tsx, [cli, "check", "--all", `--gate=${gate}`, "--quiet"], { cwd, encoding: "utf-8" });
  if (r.status !== 0 && r.status !== 1) finish(2, `ab-gate ${gate} 退出码 ${r.status}：${(r.stderr || r.stdout).slice(-400)}`, "ab-gate did not run");
}

const findings = existsSync(events)
  ? readFileSync(events, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "gate.finding")
  : [];
const blocking = findings.filter((f) => f.severity === "hard" || (f.severity === "partial" && REQUIRED.includes(f.gate)));
const noted = findings.filter((f) => f.severity === "partial" && RECORDED.includes(f.gate));
const byGate = RECORDED.map((g) => `${g} ${noted.filter((f) => f.gate === g).length}`).join("，");
const lines = [
  `${tasks} 个任务；覆盖与结构问题 ${blocking.length} 条`,
  ...blocking.slice(0, 6).map((f) => `· [${f.gate}] ${String(f.message).slice(0, 160)}`),
  `经验规则（只记录，不判定）：${byGate}`,
];
finish(blocking.length === 0 ? 0 : 1, lines.join("\n"), blocking.length ? "plan has coverage or structure findings" : undefined);
