/**
 * `agenteval check-task`: what can be known about a task before anything is
 * paid. Each case copies the free custom-check sample and breaks one thing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { preflightTask, type Finding, type PreflightReport } from "../src/core/preflight.js";
import { main } from "../src/cli/index.js";
import { EXIT } from "../src/cli/exit-codes.js";
import { bufferIo } from "../src/cli/io.js";

const SAMPLE = path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check");

async function copySample(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "check-task-"));
  await fs.cp(SAMPLE, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  return dir;
}

async function editSpec(taskDir: string, edit: (yaml: string) => string): Promise<void> {
  const file = path.join(taskDir, "spec.yaml");
  await fs.writeFile(file, edit(await fs.readFile(file, "utf-8")));
}

/** Write a reference answer by running the sample's own agent in a scratch dir. */
async function writeReference(taskDir: string, input: string, mode: "careful" | "sloppy"): Promise<void> {
  const ref = path.join(taskDir, "references", input);
  await fs.mkdir(ref, { recursive: true });
  await fs.copyFile(path.join(taskDir, "inputs", `${input}.txt`), path.join(ref, ".eval-input.txt"));
  const args = [path.join(taskDir, "agents", "notes-agent.mjs"), ...(mode === "sloppy" ? ["--mode", "sloppy"] : [])];
  execFileSync(process.execPath, args, { cwd: ref });
  await fs.rm(path.join(ref, ".eval-input.txt"));
}

const findings = (r: PreflightReport): Finding[] => r.steps.flatMap((s) => s.findings);
const byCode = (r: PreflightReport, code: string): Finding | undefined => findings(r).find((f) => f.code === code);

test("the free sample: the check fails an empty answer, and what is missing is a warning", async () => {
  const report = await preflightTask(path.join(SAMPLE, "spec.yaml"));

  assert.equal(report.blocking, 0);
  assert.equal(byCode(report, "check.null")?.severity, "ok");
  assert.equal(byCode(report, "check.no-reference")?.severity, "warning");
  assert.match(byCode(report, "inputs.count")?.message ?? "", /1 input/);
  assert.equal(byCode(report, "inputs.count")?.severity, "warning");
});

test("a check that passes an empty answer blocks", async () => {
  const task = await copySample();
  await fs.writeFile(path.join(task, "checks", "release-notes.mjs"), "process.exit(0);\n");

  const report = await preflightTask(path.join(task, "spec.yaml"));

  assert.equal(byCode(report, "check.null")?.severity, "blocking");
  assert.match(byCode(report, "check.null")?.message ?? "", /passes an empty answer/);
  assert.ok(report.blocking > 0);
});

test("a check that crashes on an empty answer blocks", async () => {
  const task = await copySample();
  await fs.writeFile(path.join(task, "checks", "release-notes.mjs"), "process.exit(3);\n");

  const report = await preflightTask(path.join(task, "spec.yaml"));

  assert.equal(byCode(report, "check.null")?.severity, "blocking");
  assert.match(byCode(report, "check.null")?.message ?? "", /evaluator_error/);
});

test("a correct reference answer passes the check", async () => {
  const task = await copySample();
  await writeReference(task, "changelog", "careful");

  const report = await preflightTask(path.join(task, "spec.yaml"));

  assert.equal(byCode(report, "check.oracle")?.severity, "ok");
  assert.equal(byCode(report, "check.no-reference"), undefined);
});

test("a reference answer the check rejects blocks: the check or the reference is wrong", async () => {
  const task = await copySample();
  await writeReference(task, "changelog", "sloppy");

  const report = await preflightTask(path.join(task, "spec.yaml"));

  assert.equal(byCode(report, "check.oracle")?.severity, "blocking");
  assert.match(byCode(report, "check.oracle")?.message ?? "", /changelog/);
});

test("a candidate whose declared script does not exist blocks before anything is paid", async () => {
  const task = await copySample();
  await editSpec(task, (y) => y.replace("argv: [node, agents/notes-agent.mjs]", "argv: [node, agents/missing.mjs]"));

  const report = await preflightTask(path.join(task, "spec.yaml"));

  assert.equal(byCode(report, "candidate.script-missing")?.severity, "blocking");
  assert.match(byCode(report, "candidate.script-missing")?.message ?? "", /agents\/missing\.mjs/);
});

test("a command candidate on the host is warned it can read the checks and references", async () => {
  const report = await preflightTask(path.join(SAMPLE, "spec.yaml"));

  const warning = byCode(report, "candidate.host-reads-answers");
  assert.equal(warning?.severity, "warning");
  assert.match(warning?.message ?? "", /checks\//);
  assert.match(warning?.message ?? "", /references\//);
});

test("two inputs with the same text are flagged", async () => {
  const task = await copySample();
  await fs.copyFile(path.join(task, "inputs", "changelog.txt"), path.join(task, "inputs", "changelog-copy.txt"));
  await editSpec(task, (y) => y.replace("inputs: [changelog]", "inputs: [changelog, changelog-copy]"));

  const report = await preflightTask(path.join(task, "spec.yaml"));

  assert.equal(byCode(report, "inputs.duplicate")?.severity, "warning");
  assert.match(byCode(report, "inputs.duplicate")?.message ?? "", /changelog-copy/);
});

test("preflight writes nothing outside the task's runs/ and leaves nothing behind", async () => {
  const task = await copySample();
  const before = (await fs.readdir(task)).sort();

  await preflightTask(path.join(task, "spec.yaml"));

  const after = (await fs.readdir(task)).filter((e) => e !== "runs").sort();
  assert.deepEqual(after, before.filter((e) => e !== "runs"));
  const runs = await fs.readdir(path.join(task, "runs")).catch(() => []);
  assert.deepEqual(runs.filter((e) => e.startsWith("check-task-")), []);
});

// ── the command ─────────────────────────────────────────────────────────────

async function cli(argv: string[]): Promise<{ code: number; out: string }> {
  const io = bufferIo();
  const code = await main(argv, io);
  return { code, out: io.stdout };
}

test("`agenteval check-task` prints each finding and exits 0 when nothing blocks", async () => {
  const { code, out } = await cli(["check-task", SAMPLE]);

  assert.equal(code, EXIT.ok);
  assert.match(out, /✔ .*fails an empty answer/);
  assert.match(out, /⚠ .*no reference answer/);
  assert.match(out, /0 blocking/);
});

test("`agenteval check-task` exits 1 when a finding blocks, and --json is machine-readable", async () => {
  const task = await copySample();
  await fs.writeFile(path.join(task, "checks", "release-notes.mjs"), "process.exit(0);\n");

  const text = await cli(["check-task", task]);
  const json = await cli(["check-task", task, "--json"]);

  assert.equal(text.code, EXIT.failed);
  assert.match(text.out, /✖ .*passes an empty answer/);
  const parsed = JSON.parse(json.out) as PreflightReport;
  assert.ok(parsed.blocking > 0);
  assert.equal(json.code, EXIT.failed);
});
