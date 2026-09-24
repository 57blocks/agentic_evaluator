#!/usr/bin/env node
/**
 * Turn one agb project's git history into test inputs.
 *
 *   node scripts/harvest.mjs <agb-project-dir> [--name=<short-name>]
 *
 * agb commits every task on its own (`feat(...): … [T-003]`), so the parent
 * of that commit is exactly the state the task started from: the plan, the
 * contracts, the earlier tasks' code, and its own red acceptance tests. The
 * parent of the commit that first wrote `.ab/tasks.json` is the state task
 * breakdown started from. Each becomes a snapshot under fixture/ and an input
 * under inputs/; the spec's input lists are printed at the end to paste in.
 *
 * Only tracked files are taken (`git archive`), so node_modules and local
 * databases never come along.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = process.argv[2];
if (!repo) {
  console.error("usage: harvest.mjs <agb-project-dir> [--name=<short-name>]");
  process.exit(2);
}
const name = process.argv.find((a) => a.startsWith("--name="))?.split("=")[1] ?? path.basename(path.resolve(repo));

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf-8" }).trim();

function snapshot(commit, fixture) {
  const dir = path.join(root, "fixture", fixture);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("sh", ["-c", `git -C "${repo}" archive ${commit} | tar -x -C "${dir}"`]);
}

function input(id, lines) {
  writeFileSync(path.join(root, "inputs", `${id}.txt`), lines.join("\n") + "\n");
}

mkdirSync(path.join(root, "inputs"), { recursive: true });
const made = { detail: [], code: [] };

// Task breakdown: the parent of the commit that first added .ab/tasks.json.
const planCommit = git("log", "--diff-filter=A", "--format=%h", "--", ".ab/tasks.json").split("\n").pop();
if (planCommit) {
  const id = `${name}-detail`;
  snapshot(`${planCommit}^`, id);
  input(id, [
    "stage: detail",
    `fixture: ${id}`,
    "",
    `${name} 的任务拆解：PRD、设计与契约已在工作目录里（${git("rev-parse", "--short", `${planCommit}^`)}），`,
    "产出 .ab/tasks.json 与 UI_CONTRACT.md。",
  ]);
  made.detail.push(id);
}

// Code: one input per task commit, from its parent.
const taskCommits = git("log", "--reverse", "--format=%h%x09%s")
  .split("\n")
  .map((l) => l.split("\t"))
  .map(([hash, subject]) => ({ hash, subject, task: subject?.match(/\[(T-\d+)\]\s*$/)?.[1] }))
  .filter((c) => c.task);
const seen = new Set();
for (const c of taskCommits) {
  if (seen.has(c.task)) continue; // a task committed twice: its first attempt's start is the input
  seen.add(c.task);
  const id = `${name}-${c.task}`;
  snapshot(`${c.hash}^`, id);
  input(id, [
    "stage: code",
    `fixture: ${id}`,
    `task: ${c.task}`,
    "",
    `${name} 的编码阶段，只做 ${c.task}（${c.subject.replace(/\s*\[T-\d+\]\s*$/, "")}）：`,
    "之前的任务已经完成，计划、契约与这个任务的验收测试都在工作目录里。",
  ]);
  made.code.push(id);
}

console.log(`harvested ${name}: ${made.detail.length} task-breakdown input, ${made.code.length} code inputs`);
console.log(`  detail inputs: [${made.detail.join(", ")}]`);
console.log(`  code inputs:   [${made.code.join(", ")}]`);
