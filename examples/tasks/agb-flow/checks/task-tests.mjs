#!/usr/bin/env node
/**
 * code (one task): this task's own acceptance tests pass.
 *
 * Which tests belong to the task comes from the fixture's plan, not from the
 * candidate: the task's entry in the fixture's .ab/tasks.json lists the files
 * it creates and modifies, test files among them. Those files are put back as
 * the fixture has them before anything runs — a candidate does not get to
 * grade itself — and the evidence says if it had touched them. Pass: every
 * one of them ran, nothing failed, nothing was skipped. `--globals` lets
 * Testing Library register its own cleanup, which the tests assume.
 *
 * agenteval names the fixture in meta.json; the task id is in input.txt.
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cwd, finish, meta, NETWORK, readJson, sh } from "./lib.mjs";

const fixture = meta().fixture;
const task = /^task:\s*(\S+)/m.exec(readFileSync(path.join(cwd, "input.txt"), "utf-8"))?.[1];
if (!fixture || !task) finish(2, "meta.json names no fixture, or input.txt no task", "no fixture or task");

const entry = (readJson(".ab/tasks.json", fixture)?.domains ?? []).flatMap((d) => d.tasks ?? []).find((t) => t.id === task);
if (!entry) finish(2, `${task} is not in the fixture's task table`, "task not in plan");
const files = Array.isArray(entry.files) ? entry.files : [...(entry.files?.creates ?? []), ...(entry.files?.modifies ?? [])];
const tests = files.filter((f) => /\.test\.[tj]sx?$/.test(f) && existsSync(path.join(fixture, f)));
if (tests.length === 0) finish(2, `${task} has no acceptance tests in the fixture, so this cell cannot be graded`, "no acceptance tests");

// Several tasks share a test file (T-001 and T-002 both list the members
// tests). A test whose title names acceptance criteria (AC-12) counts for the
// task whose criteria name them, and not for another; a test naming none
// counts for every task listing its file.
const acsOf = (t) => new Set(JSON.stringify(t.acceptanceCriteria ?? []).match(/AC-\d+/g) ?? []);
const own = acsOf(entry);
const others = new Set(
  (readJson(".ab/tasks.json", fixture)?.domains ?? []).flatMap((d) => d.tasks ?? []).filter((t) => t.id !== task).flatMap((t) => [...acsOf(t)]),
);
const belongs = (title) => {
  const named = title.match(/AC-\d+/g) ?? [];
  return named.length === 0 || named.some((a) => own.has(a)) || !named.some((a) => others.has(a));
};

const lines = [];
const touched = [];
for (const rel of tests) {
  const dest = path.join(cwd, rel);
  const original = readFileSync(path.join(fixture, rel), "utf-8");
  if (!existsSync(dest)) touched.push(`${rel} (deleted)`);
  else if (readFileSync(dest, "utf-8") !== original) touched.push(`${rel} (modified)`);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(path.join(fixture, rel), dest);
}
if (touched.length) lines.push(`the candidate touched this task's acceptance tests; restored before running: ${touched.join(", ")}`);

// Where the tests run: in each side that has its own package (client/,
// server/: demo-todo's layout, where a root package.json only holds scripts
// and each side carries its own vitest config), else at the root (one package
// for the whole project).
const sides = [...new Set(tests.map((t) => t.split("/")[0]))];
const rootPkg = existsSync(path.join(cwd, "package.json"));
const groups = sides.map((s) =>
  existsSync(path.join(cwd, s, "package.json"))
    ? { name: s, dir: path.join(cwd, s), files: tests.filter((t) => t.startsWith(`${s}/`)).map((t) => t.slice(s.length + 1)) }
    : { name: `root:${s}`, dir: cwd, files: tests.filter((t) => t.startsWith(`${s}/`)) },
);
if (!rootPkg && groups.some((g) => g.dir === cwd)) {
  finish(1, [...lines, `no package.json at the root or on the ${groups.filter((g) => g.dir === cwd).map((g) => g.name.slice(5)).join(", ")} side, so the project cannot run`].join("\n"), "not runnable");
}

// Its own npm cache: checks and agents run side by side, and a shared cache
// written by two installs at once crashes npm ("Cannot read properties of
// null"), which is not the candidate's doing.
const npmCache = mkdtempSync(path.join(os.tmpdir(), "agb-flow-npm-"));
const NPM_CRASH = /npm error (Cannot read properties|Cannot destructure|.*ENOTEMPTY|.*EEXIST)/;
for (const dir of [...new Set([...(rootPkg ? [cwd] : []), ...groups.map((g) => g.dir)])]) {
  if (dir !== cwd && existsSync(path.join(dir, "node_modules"))) continue;
  const r = sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", "--cache", npmCache], { dir, minutes: 10 });
  if (r.status !== 0) {
    const tail = `${r.stderr ?? ""}`.slice(-600);
    if (r.error || NETWORK.test(tail) || NPM_CRASH.test(tail)) finish(2, `npm install broke, not the project: ${r.error?.message ?? tail}`, "install: npm or network");
    finish(1, [...lines, `npm install failed: ${tail}`].join("\n"), "install failed");
  }
}

// The tests run with the candidate's own package.json and vitest config: at
// T-001 there is none until the candidate writes it, so the config is part of
// the deliverable. A candidate set on gaming its config is not stopped here;
// cli.image is the boundary for that.
const reports = mkdtempSync(path.join(os.tmpdir(), "agb-flow-vitest-"));
let passed = true;
for (const { name, dir, files } of groups) {
  // Outside the candidate's tree, so a planted report cannot stand in for a run.
  const report = path.join(reports, `${name}.json`);
  const r = sh("npx", ["--no-install", "vitest", "run", "--globals", "--reporter=json", `--outputFile=${report}`, ...files], { dir });
  if (!existsSync(report)) {
    passed = false;
    lines.push(`${name}: vitest produced no results (exit ${r.status}): ${(r.stderr || r.stdout || "").slice(-500)}`);
    continue;
  }
  const result = JSON.parse(readFileSync(report, "utf-8"));
  const ran = new Set((result.testResults ?? []).map((f) => path.relative(dir, f.name)));
  const notRun = files.filter((f) => !ran.has(f));
  const all = (result.testResults ?? []).flatMap((f) => f.assertionResults ?? []);
  const mine = all.filter((a) => belongs(a.title ?? ""));
  const failedOnes = mine.filter((a) => a.status === "failed");
  const skipped = mine.filter((a) => a.status === "pending" || a.status === "todo" || a.status === "skipped").length;
  const passedCount = mine.filter((a) => a.status === "passed").length;
  if (notRun.length || failedOnes.length || skipped || mine.length === 0) passed = false;
  lines.push(
    `${name}: ${passedCount}/${mine.length} of this task's tests passed` +
      (all.length > mine.length ? ` (${all.length - mine.length} other tasks' tests in these files not counted)` : "") +
      (failedOnes.length ? `, ${failedOnes.length} failed (${failedOnes.slice(0, 4).map((a) => a.title).join("; ")})` : "") +
      (skipped ? `, ${skipped} skipped` : "") +
      (notRun.length ? `, not run: ${notRun.join(", ")}` : ""),
  );
}

finish(passed ? 0 : 1, `${task} acceptance tests: ${tests.length} files\n${lines.join("\n")}`, passed ? undefined : "task tests not all passing");
