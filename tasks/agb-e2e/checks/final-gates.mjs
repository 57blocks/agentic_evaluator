#!/usr/bin/env node
/**
 * Required check for the whole chain: did agb deliver a working app?
 *
 * Reads the files the chain left (no installs, no git; see agents/agb-e2e.mjs),
 * copies them to a temp dir outside any repo, installs, makes the copy a git
 * repo (agb's stack detection reads `git ls-files`) and runs `agb smoke`: every gate up
 * to runtime, including a real build, typecheck and each workspace's test
 * suite. Pass needs all of:
 *
 *   tasks    every task in .ab/tasks.json is in agb's completedTasks
 *   install  the lockfile installs
 *   hard     agb smoke reports no hard finding
 *   build    build-passed evidence, and no `build` finding
 *   tests    test-passed evidence, and no `test-suite` finding (a workspace's
 *            whole suite failed or did not run)
 *   plan     no `page-coverage` / `contract-coverage` finding
 *
 * Every other partial finding is counted in the evidence, never gated on:
 * calibrated on demo-todo's adopted end state, agb smoke raises 34 partials
 * (`testid-contract` flags words like "data-testid", `runtime-smoke` cannot
 * find a backend start script, `at-coverage` misses tests tagged by AC).
 *
 * The tests are the candidate's own, written during the chain. They pass the
 * bar only if they all pass together; what they cover is the evidence, and
 * which app is better is the human review's question.
 *
 * Why a copy: the trial dir sits under this repo's runs/, and vitest walks up
 * to the nearest vite.config.ts. A workspace with no config of its own then
 * runs this repo's dashboard tests instead of its own (seen on the reference).
 *
 * Exit 2 when the ruler is missing or broke (agb not found, the registry is
 * unreachable, agb smoke crashed): never the candidate's fault.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const home = process.env.AGB_HOME ?? path.join(os.homedir(), "workspace", "57b", "agb");
const AGB = [path.join(home, "node_modules", ".bin", "tsx"), path.join(home, "packages", "agb", "src", "run", "cli.ts")];
const REQUIRED_CLEAN = ["build", "test-suite", "page-coverage", "contract-coverage"];
const NETWORK = /ETIMEDOUT|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network|50[234] /i;
const ANSI = /\x1b\[[0-9;]*m/g;
const trialDir = process.cwd();
let cwd = trialDir;

function finish(code, evidence, reason) {
  process.stdout.write(JSON.stringify({ evidence, ...(reason ? { reason } : {}) }));
  process.exit(code);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(path.join(cwd, file), "utf-8"));
  } catch {
    return null;
  }
}

function sh(cmd, args, timeoutMin) {
  return spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: timeoutMin * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
}

// What the chain itself reported (AGB_EVAL_RESULT.json), as context only.
const result = readJson("AGB_EVAL_RESULT.json");
const stageLine = (result?.stages ?? []).map((s) => `${s.stage} ${s.ok ? "ok" : `failed (exit ${s.exit}${s.subtype ? `, ${s.subtype}` : ""})`}`).join(", ");
const chain = stageLine ? `chain: ${stageLine}. ` : "";

// 1. Every planned task was done.
const plan = readJson(".ab/tasks.json");
const taskIds = (plan?.domains ?? []).flatMap((d) => (d.tasks ?? []).map((t) => t.id));
if (taskIds.length === 0) finish(1, `${chain}no task plan with tasks in .ab/tasks.json`, "no plan");
const state = readJson("AGB_EVAL_STATE.json") ?? readJson(".ab/run/state.json");
const done = new Set(state?.completedTasks ?? []);
const missing = taskIds.filter((id) => !done.has(id));
if (missing.length > 0) finish(1, `${chain}${taskIds.length - missing.length} of ${taskIds.length} tasks done; not done: ${missing.join(", ")}`, "tasks not done");

if (!AGB.every(existsSync)) finish(2, `agb not found under ${home} (set AGB_HOME)`, "agb not found");

cwd = mkdtempSync(path.join(os.tmpdir(), "agb-e2e-check-"));
process.on("exit", () => rmSync(cwd, { recursive: true, force: true }));
cpSync(trialDir, cwd, { recursive: true, filter: (src) => !["node_modules", ".git"].includes(path.basename(src)) });

// 2. It installs.
const lock = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].find((f) => existsSync(path.join(cwd, f)));
if (!existsSync(path.join(cwd, "package.json"))) finish(1, `${chain}no package.json: nothing to build`, "no app");
const install = lock === "pnpm-lock.yaml" ? ["pnpm", ["install", "--frozen-lockfile"]]
  : lock === "yarn.lock" ? ["yarn", ["install", "--frozen-lockfile"]]
  : lock ? ["npm", ["ci", "--no-audit", "--no-fund"]] : ["npm", ["install", "--no-audit", "--no-fund"]];
const inst = sh(install[0], install[1], 15);
if (inst.status !== 0) {
  const tail = `${inst.stderr ?? ""}${inst.stdout ?? ""}`.slice(-600);
  if (inst.error || NETWORK.test(tail)) finish(2, `${install.flat().join(" ")} could not reach the registry: ${inst.error?.message ?? tail}`, "install: network");
  finish(1, `${chain}${install.flat().join(" ")} failed: ${tail}`, "install failed");
}

// 3. agb smoke, from a clean event log so only this pass is read back.
const g = (...args) => sh("git", ["-c", "user.name=agentic-evaluator", "-c", "user.email=eval@localhost", ...args], 2);
g("init", "-q");
g("add", "-A");
g("commit", "-q", "-m", "agb-e2e: delivered state");
const events = path.join(cwd, ".ab", "events.jsonl");
rmSync(events, { force: true });
const smoke = sh(AGB[0], [AGB[1], "smoke"], 20);
const report = `${smoke.stdout ?? ""}`.replace(ANSI, "");
if (smoke.error || (smoke.status !== 0 && smoke.status !== 1)) {
  finish(2, `agb smoke exited with ${smoke.status ?? smoke.error?.message}: ${`${smoke.stderr ?? ""}${report}`.slice(-600)}`, "agb smoke did not run");
}

const findings = existsSync(events)
  ? readFileSync(events, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "gate.finding")
  : [];
// The first line under each finding's header says what is wrong.
const lines = report.split("\n");
const headline = (gate) => {
  const i = lines.findIndex((l) => new RegExp(`^\\[(hard|partial)\\]\\s+${gate}\\b`).test(l));
  return i === -1 ? "" : (lines[i + 1] ?? "").trim().slice(0, 300);
};
const evidenceLine = lines.find((l) => l.includes("evidence established this run:")) ?? "";
const established = evidenceLine.split(":").slice(1).join(":").trim();

const hard = findings.filter((f) => f.severity === "hard");
const blocking = findings.filter((f) => f.severity === "partial" && REQUIRED_CLEAN.includes(f.gate));
const problems = [
  ...hard.map((f) => `hard ${f.gate}: ${headline(f.gate)}`),
  ...blocking.map((f) => `${f.gate}: ${headline(f.gate)}`),
  ...(/build-passed/.test(established) ? [] : ["no build-passed evidence: the build never ran"]),
  ...(/test-passed/.test(established) ? [] : ["no test-passed evidence: no test suite passed"]),
];

const partialByGate = {};
for (const f of findings.filter((f) => f.severity === "partial" && !REQUIRED_CLEAN.includes(f.gate))) {
  partialByGate[f.gate] = (partialByGate[f.gate] ?? 0) + 1;
}
const recorded = Object.entries(partialByGate).sort((a, b) => b[1] - a[1]).map(([gate, n]) => `${gate} ${n}`).join(", ");
const summary = [
  `${chain}${taskIds.length} of ${taskIds.length} tasks done`,
  `evidence: ${established || "none"}`,
  `other partial findings (recorded, not gated): ${recorded || "none"}`,
];

if (problems.length > 0) finish(1, [...summary, `fails: ${[...new Set(problems)].join("; ")}`].join(". "), problems[0]);
finish(0, summary.join(". "));
