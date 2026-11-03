/**
 * A command candidate that declares `cli.trace` has its trace read into the
 * result: on a normal exit, and after a kill, where the trace is the record
 * of how far it got. Declaring it changes nothing about the trial's identity.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdapterError, agentCliAdapter, trialAdapterFields } from "../src/adapters/resolve.js";
import type { CandidateRequest } from "../src/adapters/types.js";
import type { CandidateDef } from "../src/canon/types.js";

const FIXTURE = path.resolve("tests/fixtures/agent-traces/atif-terminus-fix-git.json");

/** A command that copies the ATIF fixture into place as its trace, then does `then`. */
function copyingTrace(then = ""): string {
  return `require('fs').copyFileSync(${JSON.stringify(FIXTURE)}, '.eval-trace.json'); require('fs').writeFileSync('out.txt', 'done'); ${then}`;
}

function request(code: string, cli: Partial<CandidateRequest["cli"]> = {}, timeoutMs = 10_000): CandidateRequest {
  return { stepId: "s", candidateId: "c", inputId: "i", inputText: "go", promptTemplate: "", temperature: 0, timeoutMs, cli: { argv: [process.execPath, "-e", code], trace: "atif", ...cli } };
}

test("a declared trace is read into the result and is not part of the answer", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  const r = await agentCliAdapter.execute(request(copyingTrace()), { workDir, taskRoot: workDir });

  assert.deepEqual(r.artifacts.map((f) => f.path), ["out.txt"], "the trace file is not a deliverable");
  assert.equal(r.trace?.format, "atif");
  assert.equal(r.trace?.turns, 10);
  assert.equal(r.trace?.tool_calls.length, 23);
  assert.equal(r.trace?.ended, null);
  assert.equal(r.traceError, undefined);
});

test("without the declaration the same file is neither read nor hidden", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  const r = await agentCliAdapter.execute(request(copyingTrace(), { trace: undefined }), { workDir, taskRoot: workDir });
  assert.equal(r.trace, undefined);
  // Not in SKIP_NAMES by name alone? It is: the file name is reserved for the
  // harness whatever the spec says, like .eval-usage.json.
  assert.deepEqual(r.artifacts.map((f) => f.path), ["out.txt"]);
});

test("a trace that cannot be read is an error on the result, not a silent nothing", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  const r = await agentCliAdapter.execute(request("require('fs').writeFileSync('.eval-trace.json', '{\"steps\": 1}')"), { workDir, taskRoot: workDir });
  assert.equal(r.trace, undefined);
  assert.match(r.traceError ?? "", /unreadable as atif/);
});

test("a killed command's trace is read after the kill, and says it was killed", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  // Write the trace and usage, then hang past the timeout.
  const code = copyingTrace("require('fs').writeFileSync('.eval-usage.json', JSON.stringify({ cost_usd: 0.05, prompt_tokens: 100, completion_tokens: 10 })); setInterval(() => {}, 1000);");
  await assert.rejects(
    agentCliAdapter.execute(request(code, { reports_usage: true }, 1_500), { workDir, taskRoot: workDir }),
    (err: unknown) => {
      assert.ok(err instanceof AdapterError && err.kind === "timeout", String(err));
      assert.equal(err.partial?.trace?.ended, "killed");
      assert.equal(err.partial?.trace?.turns, 10);
      assert.equal(err.partial?.costUsd, 0.05);
      assert.equal(err.partial?.costSource, "estimated");
      return true;
    },
  );
});

test("declaring a trace does not change the trial's identity", () => {
  const plain: CandidateDef = { id: "a", adapter: "agent-cli", cli: { argv: ["node", "run.mjs"], reports_usage: true } };
  const traced: CandidateDef = { ...plain, cli: { ...plain.cli!, trace: "atif" } };
  assert.deepEqual(trialAdapterFields(traced, "agent"), trialAdapterFields(plain, "agent"));
  assert.notDeepEqual(trialAdapterFields({ ...plain, cli: { ...plain.cli!, argv: ["node", "other.mjs"] } }, "agent"), trialAdapterFields(plain, "agent"));
});

test("a trace that is a symlink, or over the size cap, is refused unread", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  const secret = path.join(workDir, "..", `secret-${path.basename(workDir)}.json`);
  await fs.writeFile(secret, JSON.stringify({ schema_version: "ATIF-v1.8", steps: [{ step_id: 1, source: "user", message: "the answer key" }] }));
  try {
    const linked = await agentCliAdapter.execute(
      request(`require('fs').symlinkSync(${JSON.stringify(secret)}, '.eval-trace.json'); require('fs').writeFileSync('out.txt', 'x')`),
      { workDir, taskRoot: workDir },
    );
    assert.equal(linked.trace, undefined);
    assert.match(linked.traceError ?? "", /is a symlink|not a regular file/);
    assert.doesNotMatch(linked.traceError ?? "", /answer key/);

    const big = await agentCliAdapter.execute(
      request("require('fs').writeFileSync('.eval-trace.json', '[' + '1,'.repeat(1_100_000) + '1]'); require('fs').writeFileSync('out.txt', 'x')"),
      { workDir: await fs.mkdtemp(path.join(os.tmpdir(), "trace-")), taskRoot: workDir },
    );
    assert.match(big.traceError ?? "", /over \d+/);
  } finally {
    await fs.rm(secret, { force: true });
  }
});

test("a trace's parse error names a field, never the file's contents", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  const r = await agentCliAdapter.execute(request("require('fs').writeFileSync('.eval-trace.json', 'SECRET-TOKEN {')"), { workDir, taskRoot: workDir });
  assert.equal(r.traceError, ".eval-trace.json unreadable as atif: not JSON");
});

test("a FIFO left as the trace does not block the harness", { skip: process.platform === "win32" }, async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  const code = "require('child_process').execFileSync('mkfifo', ['.eval-trace.json']); require('fs').writeFileSync('out.txt', 'x')";
  const started = Date.now();
  const r = await agentCliAdapter.execute(request(code), { workDir, taskRoot: workDir });
  assert.ok(Date.now() - started < 5_000, "the open returned");
  assert.match(r.traceError ?? "", /not a regular file/);
});

/* The trace reaches the required check as trace.json, and is kept with the trial's evidence. */

test("a run's check sees the trace as trace.json, kept beside the files the agent left", async () => {
  const { generateOne } = await import("../src/core/generate.js");
  const taskRoot = await fs.mkdtemp(path.join(os.tmpdir(), "trace-task-"));
  const evidence = path.join(taskRoot, "runs", "r1", "checks", "c__i__t0");
  // Pass only if the trace shows the agent used its terminal.
  const check = `const t = JSON.parse(require("fs").readFileSync("trace.json", "utf-8")); process.exit(t.tool_calls.length > 0 ? 0 : 1)`;
  const suite = {
    step: "s", taskRoot, inputs: ["i"], candidates: ["c"],
    check: { id: "used-the-terminal", kind: "command", argv: [process.execPath, "-e", check], versionFiles: [], timeoutMs: 10_000 },
  } as unknown as import("../src/types.js").Suite;

  const g = await generateOne({
    suite, producer: "codegen", promptTpl: "", inputSlug: "i", inputText: "go",
    def: { id: "c", adapter: "agent-cli", cli: { argv: [process.execPath, "-e", copyingTrace()], trace: "atif" } },
    temperature: 0, timeoutMs: 10_000, checkWorkDir: evidence, trace: () => {}, traceContext: {},
  });

  assert.equal(g.checkState, "pass", g.checkOutput);
  const kept = JSON.parse(await fs.readFile(path.join(evidence, "trace.json"), "utf-8")) as { format: string; tool_calls: unknown[] };
  assert.equal(kept.format, "atif");
  assert.equal(kept.tool_calls.length, 23);
  assert.ok(!g.artifacts.some((f) => f.path === "trace.json"), "the written trace is not the candidate's deliverable");
});

/* A reused trial regraded under a changed check gets its trace back: fixing a check never means paying for the agent again. */

test("--reuse regrades a trial with the trace it left, so a new trace rule needs no new run", async () => {
  const { runSuite } = await import("../src/core/execute.js");
  const sample = path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check");
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "trace-reuse-"));
  const task = path.join(ws, "tasks", "traced");
  await fs.cp(sample, task, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  const spec = path.join(task, "spec.yaml");
  let yaml = await fs.readFile(spec, "utf-8");
  // One candidate that leaves an ATIF trace; one command check, versioned by its file.
  yaml = yaml.replace(/candidates:[\s\S]*?\nevaluators:/, `candidates:\n  - id: tracer\n    adapter: agent-cli\n    cli:\n      argv: [${JSON.stringify(process.execPath)}, -e, ${JSON.stringify(copyingTrace())}]\n      trace: atif\n\nevaluators:`);
  yaml = yaml.replace("candidate_ids: [careful, sloppy]", "candidate_ids: [tracer]").replace("control_candidate: careful", "control_candidate: tracer");
  yaml = yaml.replace("argv: [node, checks/release-notes.mjs]", `argv: [${JSON.stringify(process.execPath)}, checks/gate.cjs]`).replace("version_files: [checks/release-notes.mjs]", "version_files: [checks/gate.cjs]");
  await fs.writeFile(spec, yaml);
  const gate = path.join(task, "checks", "gate.cjs");
  await fs.writeFile(gate, "process.exit(require('fs').existsSync('out.txt') ? 0 : 1);\n");

  await runSuite(spec, false, { yes: true, onEvent: () => {} });
  const runsRoot = path.join(task, "runs");
  const [firstRun] = await fs.readdir(runsRoot);
  const evidence = (run: string) => path.join(runsRoot, run, "checks", "tracer__changelog__t0", "trace.json");
  assert.ok(await fs.stat(evidence(firstRun!)).then(() => true, () => false), "the first run kept trace.json with the check's evidence");

  // The check changes: now it grades the path, not the file.
  await fs.writeFile(gate, "const t = JSON.parse(require('fs').readFileSync('trace.json', 'utf-8')); process.exit(t.tool_calls.length === 23 ? 0 : 1);\n");
  const events: { reusedFrom?: string; check?: string; state: string }[] = [];
  const saved = process.env.EVAL_REUSE;
  process.env.EVAL_REUSE = "1";
  try {
    await runSuite(spec, false, { yes: true, onEvent: (e) => { if (e.type === "trial") events.push(e); } });
  } finally {
    if (saved === undefined) delete process.env.EVAL_REUSE;
    else process.env.EVAL_REUSE = saved;
  }

  const [trial] = events;
  assert.ok(trial?.reusedFrom, "the agent did not run again");
  assert.equal(trial?.check, "pass", "the new rule was applied to the kept trace");
  const second = (await fs.readdir(runsRoot)).find((r) => r !== firstRun)!;
  assert.ok(await fs.stat(evidence(second)).then(() => true, () => false), "the regrade's evidence carries trace.json too");
});
