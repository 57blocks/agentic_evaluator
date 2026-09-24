#!/usr/bin/env node
/**
 * Required check for the code step: this task's own acceptance tests pass.
 *
 * Which tests belong to the task comes from the plan, not from the
 * candidate: the task's entry in the snapshot's .ab/tasks.json lists the
 * files it creates and modifies, test files among them. Those test files are
 * put back exactly as the snapshot has them before anything runs — a
 * candidate does not get to grade itself — and the evidence says if it had
 * touched them. Pass: every one of those files ran, nothing failed, nothing
 * was skipped. `--globals` lets Testing Library register its own cleanup,
 * which the tests assume and a project's setup may omit.
 *
 * Contract (src/check.ts): cwd holds the candidate's files, input.txt the
 * input; exit 0 pass, 1 fail, anything else an evaluator error.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cwd = process.cwd();
const header = Object.fromEntries(
  [...readFileSync(path.join(cwd, "input.txt"), "utf-8").matchAll(/^(fixture|task):\s*(\S+)/gm)].map((m) => [m[1], m[2]]),
);
const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixture", header.fixture ?? "");

function finish(code, evidence, reason) {
  process.stdout.write(JSON.stringify({ evidence, ...(reason ? { reason } : {}) }));
  process.exit(code);
}

const plan = JSON.parse(readFileSync(path.join(fixture, ".ab", "tasks.json"), "utf-8"));
const task = plan.domains.flatMap((d) => d.tasks ?? []).find((t) => t.id === header.task);
if (!task) finish(2, `快照的任务表里没有 ${header.task}`, "task not in plan");
const tests = [...(task.files?.creates ?? []), ...(task.files?.modifies ?? [])]
  .filter((f) => /\.test\.[tj]sx?$/.test(f) && existsSync(path.join(fixture, f)));
if (tests.length === 0) finish(2, `${header.task} 在快照里没有验收测试，这一格判不了`, "no acceptance tests");

const lines = [];
const touched = [];
for (const rel of tests) {
  const dest = path.join(cwd, rel);
  const original = readFileSync(path.join(fixture, rel), "utf-8");
  if (!existsSync(dest)) touched.push(`${rel}（删了）`);
  else if (readFileSync(dest, "utf-8") !== original) touched.push(`${rel}（改了）`);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(path.join(fixture, rel), dest);
}
if (touched.length) lines.push(`候选动过这个任务的验收测试，已恢复原样再跑：${touched.join("、")}`);

const sides = [...new Set(tests.map((t) => t.split("/")[0]))];
const missingPkg = sides.filter((s) => !existsSync(path.join(cwd, s, "package.json")));
if (missingPkg.length) finish(1, [...lines, `${missingPkg.join("、")} 端没有 package.json，项目跑不起来`].join("\n"), "not runnable");

const installDirs = existsSync(path.join(cwd, "package.json")) ? [cwd] : sides.map((s) => path.join(cwd, s));
for (const dir of installDirs) {
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf-8" });
  if (r.status !== 0) finish(1, [...lines, `npm install 失败：${(r.stderr || "").slice(-600)}`].join("\n"), "install failed");
}

let passed = true;
for (const side of sides) {
  const files = tests.filter((t) => t.startsWith(`${side}/`)).map((t) => t.slice(side.length + 1));
  const report = path.join(cwd, `.vitest-${side}.json`);
  const r = spawnSync("npx", ["--no-install", "vitest", "run", "--globals", "--reporter=json", `--outputFile=${report}`, ...files], {
    cwd: path.join(cwd, side),
    encoding: "utf-8",
  });
  if (!existsSync(report)) {
    passed = false;
    lines.push(`${side}：vitest 没有产出结果（退出码 ${r.status}）：${(r.stderr || r.stdout || "").slice(-500)}`);
    continue;
  }
  const result = JSON.parse(readFileSync(report, "utf-8"));
  const ran = new Set((result.testResults ?? []).map((f) => path.relative(path.join(cwd, side), f.name)));
  const notRun = files.filter((f) => !ran.has(f));
  const failed = result.numFailedTests ?? 0;
  const skipped = (result.numPendingTests ?? 0) + (result.numTodoTests ?? 0);
  const failures = (result.testResults ?? [])
    .flatMap((f) => (f.assertionResults ?? []).filter((a) => a.status === "failed").map((a) => a.title))
    .slice(0, 4);
  if (notRun.length || failed || skipped || !result.numTotalTests) passed = false;
  lines.push(
    `${side}：${result.numPassedTests ?? 0}/${result.numTotalTests ?? 0} 通过` +
      (failed ? `，${failed} 失败（${failures.join("；")}）` : "") +
      (skipped ? `，${skipped} 跳过` : "") +
      (notRun.length ? `，没跑到：${notRun.join("、")}` : ""),
  );
}

finish(passed ? 0 : 1, `${header.task} 的验收测试：${tests.length} 个文件\n${lines.join("\n")}`, passed ? undefined : "task tests not all passing");
