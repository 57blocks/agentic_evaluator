/**
 * Command required checks: the contract a user-declared gate can rely on.
 *
 * Exit 0 passes, exit 1 fails the candidate, anything else is the evaluator's
 * own failure and must never be charged to the candidate (protocol §5).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commandCheckVersion, runCommandCheck } from "../src/check.js";
import type { AgentTrace } from "../src/canon/agent-trace.js";

const NODE = process.execPath;

async function workDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "eval-cmd-check-"));
}

function run(argv: string[], dir: string, over: Partial<Parameters<typeof runCommandCheck>[0]> = {}) {
  return runCommandCheck({
    argv,
    versionFiles: [],
    timeoutMs: 20_000,
    files: [],
    output: "the deliverable",
    input: "the input",
    meta: { step: "taskbreakdown", candidate: "cand-a", input: "todo-app", trial: 0 },
    workDir: dir,
    taskRoot: process.cwd(),
    ...over,
  });
}

test("exit 0 passes and stdout becomes the evidence", async () => {
  const dir = await workDir();
  const result = await run([NODE, "-e", "console.log('12/12 requirements covered')"], dir);

  assert.equal(result.state, "pass");
  assert.equal(result.passed, true);
  assert.match(result.output, /12\/12 requirements covered/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("exit 1 fails the candidate and keeps the reported reason", async () => {
  const dir = await workDir();
  const result = await run(
    [NODE, "-e", `console.log(JSON.stringify({evidence:"T-3 cites FR-9, which the PRD does not define",reason:"unknown requirement id"})); process.exit(1)`],
    dir,
  );

  assert.equal(result.state, "fail");
  assert.match(result.output, /FR-9/);
  assert.equal(result.reason, "unknown requirement id");
  await fs.rm(dir, { recursive: true, force: true });
});

test("any other exit code is the evaluator's failure, not the candidate's", async () => {
  const dir = await workDir();
  const result = await run([NODE, "-e", "process.exit(7)"], dir);

  assert.equal(result.state, "evaluator_error");
  assert.equal(result.passed, false);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a missing program is an evaluator error naming the program", async () => {
  const dir = await workDir();
  const result = await run(["definitely-not-on-this-path"], dir);

  assert.equal(result.state, "evaluator_error");
  assert.match(result.reason ?? "", /not found|ENOENT/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a check that hangs is killed and recorded as an evaluator error", async () => {
  const dir = await workDir();
  const result = await run([NODE, "-e", "setTimeout(() => {}, 60000)"], dir, { timeoutMs: 300 });

  assert.equal(result.state, "evaluator_error");
  assert.match(result.reason ?? "", /timed out/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("the work dir hands the check the output, the input and the trial's identity", async () => {
  const dir = await workDir();
  const script = `
    const fs = require("node:fs");
    const meta = JSON.parse(fs.readFileSync("meta.json", "utf-8"));
    const out = fs.readFileSync("output.txt", "utf-8");
    const inp = fs.readFileSync("input.txt", "utf-8");
    console.log(JSON.stringify({ evidence: meta.step + "|" + meta.candidate + "|" + out + "|" + inp }));
  `;
  const result = await run([NODE, "-e", script], dir, { output: "OUT", input: "IN" });

  assert.equal(result.state, "pass");
  assert.equal(result.output, "taskbreakdown|cand-a|OUT|IN");
  await fs.rm(dir, { recursive: true, force: true });
});

test("produced artifacts are materialized next to them", async () => {
  const dir = await workDir();
  const script = `console.log(require("node:fs").readFileSync("src/utils.ts", "utf-8"))`;
  const result = await run([NODE, "-e", script], dir, {
    files: [{ path: "src/utils.ts", content: "export const x = 1;" }],
  });

  assert.equal(result.state, "pass");
  assert.match(result.output, /export const x = 1;/);
  await fs.rm(dir, { recursive: true, force: true });
});

/* A command candidate's trace reaches the check as trace.json: a check can grade the path, not only the deliverable. */

const TRACE: AgentTrace = {
  format: "claude-code",
  turns: 3,
  tool_calls: [
    { name: "Bash", ms: 120, failed: false },
    { name: "Edit", ms: 8, failed: false },
    { name: "Bash", ms: 2400, failed: true },
  ],
  retries: 1,
  denials: 0,
  compactions: null,
  turn_tokens: null,
  models: ["claude-sonnet-5"],
  cost_usd: 0.04,
  ended: "finished",
};

test("a trace is written as trace.json, and the check script can grade the path taken", async () => {
  const dir = await workDir();
  // Fail unless the agent actually ran a command (a Bash call) before finishing.
  const script = `
    const t = JSON.parse(require("node:fs").readFileSync("trace.json", "utf-8"));
    const ran = t.tool_calls.filter((c) => c.name === "Bash").length;
    console.log(JSON.stringify({ evidence: t.format + ": " + ran + " Bash calls in " + t.turns + " turns" }));
    process.exit(ran > 0 ? 0 : 1);
  `;
  const result = await run([NODE, "-e", script], dir, { trace: TRACE });

  assert.equal(result.state, "pass");
  assert.equal(result.output, "claude-code: 2 Bash calls in 3 turns");
  const written = JSON.parse(await fs.readFile(path.join(dir, "trace.json"), "utf-8")) as AgentTrace;
  assert.deepEqual(written, TRACE);
  await fs.rm(dir, { recursive: true, force: true });
});

test("without a trace, nothing is written and a trace.json among the files is left alone", async () => {
  // check-task's oracle probe copies references/<input>/ into the work dir:
  // a reference may carry its own trace.json for a check that needs one.
  const dir = await workDir();
  const script = `console.log(require("node:fs").readFileSync("trace.json", "utf-8"))`;
  const result = await run([NODE, "-e", script], dir, { files: [{ path: "trace.json", content: `{"from":"references"}` }] });

  assert.equal(result.state, "pass");
  assert.equal(result.output, `{"from":"references"}`);
  await fs.rm(dir, { recursive: true, force: true });
});

test("without a trace, the work dir has no trace.json at all", async () => {
  const dir = await workDir();
  const result = await run([NODE, "-e", `process.exit(require("node:fs").existsSync("trace.json") ? 1 : 0)`], dir);

  assert.equal(result.state, "pass");
  await fs.rm(dir, { recursive: true, force: true });
});

test("the version changes when the check script changes, not when it is re-run", async () => {
  const a = await commandCheckVersion([NODE, "checks/x.mjs"], ["package.json"], process.cwd());
  const again = await commandCheckVersion([NODE, "checks/x.mjs"], ["package.json"], process.cwd());
  const otherArgv = await commandCheckVersion([NODE, "checks/y.mjs"], ["package.json"], process.cwd());
  const otherFiles = await commandCheckVersion([NODE, "checks/x.mjs"], ["tsconfig.json"], process.cwd());

  assert.equal(a, again);
  assert.notEqual(a, otherArgv);
  assert.notEqual(a, otherFiles);
});

/* The shipped example gate, exercised through the same contract a spec uses. */

const PRD = `
## 3. Requirements
FR-1 add a task with a title and optional due date.
AC-1.1 a task with no title is rejected.
FR-2 filter by all / active / completed.
`;

function coverage(output: string, dir: string) {
  return run([NODE, path.resolve("tasks/prd-chain-trial/checks/task-coverage.mjs")], dir, { output, input: PRD });
}

test("task-coverage passes a breakdown that cites every requirement", async () => {
  const dir = await workDir();
  const tasks = JSON.stringify([
    { id: "T-1", title: "Task model", covers: ["FR-1", "AC-1.1"] },
    { id: "T-2", title: "Filters", covers: ["FR-2"] },
  ]);

  const result = await coverage(tasks, dir);

  assert.equal(result.state, "pass");
  assert.match(result.output, /3\/3 requirements covered/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("task-coverage fails on an invented requirement id and names it", async () => {
  const dir = await workDir();
  const tasks = JSON.stringify([
    { id: "T-1", covers: ["FR-1", "AC-1.1", "FR-9"] },
    { id: "T-2", covers: ["FR-2"] },
  ]);

  const result = await coverage(tasks, dir);

  assert.equal(result.state, "fail");
  assert.match(result.output, /T-1 cites FR-9/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("task-coverage fails when a requirement is left uncovered", async () => {
  const dir = await workDir();
  const result = await coverage(JSON.stringify([{ id: "T-1", covers: ["FR-1", "AC-1.1"] }]), dir);

  assert.equal(result.state, "fail");
  assert.match(result.output, /FR-2/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("task-coverage reads a fenced json block, as models usually emit it", async () => {
  const dir = await workDir();
  const fenced = "```json\n" + JSON.stringify([{ id: "T-1", covers: ["FR-1", "AC-1.1", "FR-2"] }]) + "\n```";

  assert.equal((await coverage(fenced, dir)).state, "pass");
  await fs.rm(dir, { recursive: true, force: true });
});

test("an unparsable task list is the candidate's failure, not the evaluator's", async () => {
  const dir = await workDir();
  const result = await coverage("I could not complete this task.", dir);

  assert.equal(result.state, "fail");
  assert.match(result.reason ?? "", /unparsable/);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a PRD with no requirement ids is an evaluator error, not a silent pass", async () => {
  const dir = await workDir();
  const result = await run([NODE, path.resolve("tasks/prd-chain-trial/checks/task-coverage.mjs")], dir, {
    output: JSON.stringify([{ id: "T-1" }]),
    input: "a prose brief with no ids at all",
  });

  assert.equal(result.state, "evaluator_error");
  await fs.rm(dir, { recursive: true, force: true });
});

test("a repo-relative script is resolved against the repo, not the work dir", async () => {
  // The work dir is a temp directory; "checks/…" only exists under the repo.
  const dir = await workDir();
  const result = await run([NODE, "tasks/prd-chain-trial/checks/task-coverage.mjs"], dir, {
    output: JSON.stringify([{ id: "T-1", covers: ["FR-1"] }]),
    input: "FR-1 add a task.",
  });

  assert.equal(result.state, "pass");
  await fs.rm(dir, { recursive: true, force: true });
});

test("a declared script that does not exist is an evaluator error, not a failed candidate", async () => {
  // node exits 1 for "cannot find module" — indistinguishable from our fail
  // contract, which once marked every candidate as failed.
  const dir = await workDir();
  const result = await run([NODE, "checks/not-a-real-check.mjs"], dir);

  assert.equal(result.state, "evaluator_error");
  assert.match(result.output, /not found under the repo/);
  await fs.rm(dir, { recursive: true, force: true });
});
