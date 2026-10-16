#!/usr/bin/env node
/**
 * The chain's end product (workflow.e2e.final_checks): did agb deliver a
 * working app? Pass needs all of:
 *
 *   tasks    every task in .ab/tasks.json is in agb's completedTasks
 *   install  the lockfile installs
 *   hard     `agb smoke` reports no hard finding
 *   build    build-passed evidence, and no `build` finding
 *   tests    test-passed evidence, and no `test-suite` finding (a
 *            workspace's whole suite failed or did not run)
 *   plan     no `page-coverage` / `contract-coverage` finding
 *
 * Every other partial finding is counted, never gated on: on demo-todo's
 * adopted end state agb smoke raises 34 (`testid-contract` flags words like
 * "data-testid", `runtime-smoke` cannot find a backend start script).
 *
 * The tests are the candidates' own, written during the chain; they pass the
 * bar only if they all pass together. Which delivery is better is the e2e
 * judge's question.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { agb, countByGate, cwd, ensureGit, finish, NETWORK, readJson, sh } from "./lib.mjs";

const REQUIRED_CLEAN = ["build", "test-suite", "page-coverage", "contract-coverage"];

const plan = readJson(".ab/tasks.json");
const taskIds = (plan?.domains ?? []).flatMap((d) => (d.tasks ?? []).map((t) => t.id));
if (taskIds.length === 0) finish(1, "no task plan with tasks in .ab/tasks.json", "no plan");
const done = new Set(readJson(".ab/run/state.json")?.completedTasks ?? []);
const missing = taskIds.filter((id) => !done.has(id));
if (missing.length > 0) finish(1, `${taskIds.length - missing.length} of ${taskIds.length} tasks done; not done: ${missing.join(", ")}`, "tasks not done");

if (!existsSync(path.join(cwd, "package.json"))) finish(1, "no package.json: nothing to build", "no app");
const lock = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].find((f) => existsSync(path.join(cwd, f)));
const [cmd, args] = lock === "pnpm-lock.yaml" ? ["pnpm", ["install", "--frozen-lockfile"]]
  : lock === "yarn.lock" ? ["yarn", ["install", "--frozen-lockfile"]]
  : lock ? ["npm", ["ci", "--no-audit", "--no-fund"]] : ["npm", ["install", "--no-audit", "--no-fund"]];
const inst = sh(cmd, args, { minutes: 15 });
if (inst.status !== 0) {
  const tail = `${inst.stderr ?? ""}${inst.stdout ?? ""}`.slice(-600);
  if (inst.error || NETWORK.test(tail)) finish(2, `${cmd} ${args.join(" ")} could not reach the registry: ${inst.error?.message ?? tail}`, "install: network");
  finish(1, `${cmd} ${args.join(" ")} failed: ${tail}`, "install failed");
}

ensureGit();
const { findings, headlines, report } = agb(["smoke"], { minutes: 20 });
const headline = (gate) => headlines.find((h) => h.gate === gate)?.text ?? "";
const established = (report.split("\n").find((l) => l.includes("evidence established this run:")) ?? "").split(":").slice(1).join(":").trim();

const hard = findings.filter((f) => f.severity === "hard");
const blocking = findings.filter((f) => f.severity === "partial" && REQUIRED_CLEAN.includes(f.gate));
const problems = [
  ...hard.map((f) => `hard ${f.gate}: ${headline(f.gate)}`),
  ...blocking.map((f) => `${f.gate}: ${headline(f.gate)}`),
  ...(/build-passed/.test(established) ? [] : ["no build-passed evidence: the build never ran"]),
  ...(/test-passed/.test(established) ? [] : ["no test-passed evidence: no test suite passed"]),
];
const other = findings.filter((f) => f.severity === "partial" && !REQUIRED_CLEAN.includes(f.gate));
const summary = [
  `${taskIds.length} of ${taskIds.length} tasks done`,
  `evidence: ${established || "none"}`,
  `other partial findings (recorded, not gated): ${countByGate(other)}`,
];
if (problems.length > 0) finish(1, [...summary, `fails: ${[...new Set(problems)].join("; ")}`].join(". "), problems[0]);
finish(0, summary.join(". "));
