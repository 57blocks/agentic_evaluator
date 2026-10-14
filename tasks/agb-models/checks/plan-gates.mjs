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
 * ab-gate runs from the agb checkout in AGB_HOME (default ~/workspace/57b/agb),
 * at packages/agb/src/gate/cli.ts (packages/ab-gate/src/cli.ts before agb #77).
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
// agb #77 folded ab-gate into the agb package; keep the old path for older checkouts.
const cli = [path.join(home, "packages", "agb", "src", "gate", "cli.ts"), path.join(home, "packages", "ab-gate", "src", "cli.ts")].find((p) => existsSync(p))
  ?? path.join(home, "packages", "agb", "src", "gate", "cli.ts");
const cwd = process.cwd();

function finish(code, evidence, reason) {
  process.stdout.write(JSON.stringify({ evidence, ...(reason ? { reason } : {}) }));
  process.exit(code);
}

const planPath = path.join(cwd, ".ab", "tasks.json");
if (!existsSync(planPath)) finish(1, "no .ab/tasks.json was produced", "no plan written");
let tasks = 0;
try {
  tasks = JSON.parse(readFileSync(planPath, "utf-8")).domains.reduce((n, d) => n + (d.tasks?.length ?? 0), 0);
} catch (e) {
  finish(1, `.ab/tasks.json cannot be read: ${e.message}`, "plan unreadable");
}
if (tasks === 0) finish(1, ".ab/tasks.json contains no tasks", "empty plan");
// Not the candidate's fault when the ruler is missing: exit 2 is an evaluator error.
if (!existsSync(cli)) finish(2, `ab-gate not found: ${cli} (set AGB_HOME)`, "ab-gate not found");

const events = path.join(cwd, ".ab", "events.jsonl");
rmSync(events, { force: true });
// Newer agb redacts finding text from events.jsonl; the gate's own report on
// stdout still says what is wrong, so the first line under each finding
// header is kept as evidence.
const ANSI = /\x1b\[[0-9;]*m/g;
const headlines = [];
for (const gate of GATES) {
  const r = spawnSync(tsx, [cli, "check", "--all", `--gate=${gate}`, "--stage=detail"], { cwd, encoding: "utf-8" });
  if (r.status !== 0 && r.status !== 1) finish(2, `ab-gate ${gate} exited with ${r.status}: ${(r.stderr || r.stdout).slice(-400)}`, "ab-gate did not run");
  const report = (r.stdout ?? "").replace(ANSI, "").split("\n");
  report.forEach((line, i) => {
    const head = /^\[(hard|partial)\]\s+(\S+)/.exec(line);
    if (head) headlines.push({ gate: head[2], severity: head[1], text: (report[i + 1] ?? "").trim() });
  });
}
const headlineFor = (f) => headlines.find((h) => h.gate === f.gate && h.severity === f.severity && !h.used);

const findings = existsSync(events)
  ? readFileSync(events, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "gate.finding")
  : [];
const blocking = findings.filter((f) => f.severity === "hard" || (f.severity === "partial" && REQUIRED.includes(f.gate)));
const noted = findings.filter((f) => f.severity === "partial" && RECORDED.includes(f.gate));
const byGate = RECORDED.map((g) => `${g} ${noted.filter((f) => f.gate === g).length}`).join(", ");
const lines = [
  `${tasks} tasks; ${blocking.length} coverage or structure findings`,
  ...blocking.slice(0, 6).map((f) => {
    const h = headlineFor(f);
    if (h) h.used = true;
    return `· [${f.gate}] ${String(f.message ?? h?.text ?? `${f.severity} finding`).slice(0, 200)}`;
  }),
  `heuristics (recorded, not gating): ${byGate}`,
];
finish(blocking.length === 0 ? 0 : 1, lines.join("\n"), blocking.length ? "plan has coverage or structure findings" : undefined);
