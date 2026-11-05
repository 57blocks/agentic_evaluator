/**
 * `trace:` rules on a required check, end to end: check-task says who they
 * apply to, a run grades the path with them, and `--reuse` regrades when
 * only the rules changed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateOne } from "../src/core/generate.js";
import { preflightTask, type PreflightReport } from "../src/core/preflight.js";
import { runSuite } from "../src/core/execute.js";
import type { Suite } from "../src/types.js";

const FIXTURE = path.resolve("tests/fixtures/agent-traces/atif-terminus-fix-git.json");
const SAMPLE = path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check");

/** An agent that leaves the ATIF fixture (21 bash_command calls, 2 mark_task_complete) and a file. */
const TRACED_AGENT = `require('fs').copyFileSync(${JSON.stringify(FIXTURE)}, '.eval-trace.json'); require('fs').writeFileSync('out.txt', 'done');`;

const codeOf = (r: PreflightReport, code: string) => r.steps.flatMap((s) => s.findings).find((f) => f.code === code);

/** custom-check in a workspace of its own, with the given trace rules on its check and the given candidate block. */
async function tracedTask(rules: string, candidates: string): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "trace-rules-"));
  const task = path.join(ws, "tasks", "traced");
  await fs.cp(SAMPLE, task, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  const spec = path.join(task, "spec.yaml");
  let yaml = await fs.readFile(spec, "utf-8");
  yaml = yaml.replace(/candidates:[\s\S]*?\nevaluators:/, `candidates:\n${candidates}\nevaluators:`);
  yaml = yaml.replace("candidate_ids: [careful, sloppy]", "candidate_ids: [tracer]").replace("control_candidate: careful", "control_candidate: tracer");
  yaml = yaml.replace("argv: [node, checks/release-notes.mjs]", `argv: [${JSON.stringify(process.execPath)}, checks/gate.cjs]`).replace("version_files: [checks/release-notes.mjs]", "version_files: [checks/gate.cjs]");
  yaml = yaml.replace("      timeout_seconds: 30\n", `      timeout_seconds: 30\n${rules}`);
  await fs.writeFile(spec, yaml);
  await fs.writeFile(path.join(task, "checks", "gate.cjs"), "process.exit(require('fs').existsSync('out.txt') ? 0 : 1);\n");
  // The oracle probe needs a reference; the sample's is for its own agent.
  await fs.rm(path.join(task, "references"), { recursive: true, force: true });
  await fs.mkdir(path.join(task, "references", "changelog"), { recursive: true });
  await fs.writeFile(path.join(task, "references", "changelog", "out.txt"), "done");
  return spec;
}

const TRACER = (trace: string) => `  - id: tracer\n    adapter: agent-cli\n    cli:\n      argv: [${JSON.stringify(process.execPath)}, -e, ${JSON.stringify(TRACED_AGENT)}]\n      trace: ${trace}`;
const UNTRACED = `  - id: tracer\n    adapter: agent-cli\n    cli:\n      argv: [${JSON.stringify(process.execPath)}, -e, ${JSON.stringify(TRACED_AGENT)}]`;

test("check-task warns when trace rules can never apply, and when a format cannot answer one", async () => {
  const unused = await preflightTask(await tracedTask("      trace:\n        tool_used: [{ name: bash_command, min: 1 }]\n", UNTRACED));
  assert.equal(codeOf(unused, "check.trace-unused")?.severity, "warning");
  assert.equal(codeOf(unused, "check.trace-rules"), undefined);

  const atif = await preflightTask(await tracedTask("      trace:\n        tool_used: [{ name: bash_command, min: 1 }]\n        max_repeated_failures: 2\n", TRACER("atif")));
  assert.equal(codeOf(atif, "check.trace-rules")?.severity, "ok");
  assert.match(codeOf(atif, "check.trace-rules")?.message ?? "", /bash_command called ≥1.*applied to tracer/);
  assert.equal(codeOf(atif, "check.trace-unjudgeable")?.severity, "warning");
  assert.equal(codeOf(atif, "check.null")?.severity, "ok", "the probes run without a trace and still pass");
});

function suiteWith(taskRoot: string, trace: Record<string, unknown>): Suite {
  const check = `process.exit(require('fs').existsSync('out.txt') ? 0 : 1)`;
  return {
    step: "s", taskRoot, inputs: ["i"], candidates: ["c"],
    check: { id: "gate", kind: "command", argv: [process.execPath, "-e", check], versionFiles: [], timeoutMs: 10_000, trace },
  } as unknown as Suite;
}

async function trial(suite: Suite, def: Record<string, unknown>) {
  const evidence = path.join(suite.taskRoot, "runs", "r1", "checks", "c__i__t0");
  return generateOne({
    suite, producer: "codegen", promptTpl: "", inputSlug: "i", inputText: "go",
    def: def as never, temperature: 0, timeoutMs: 10_000, checkWorkDir: evidence, trace: () => {}, traceContext: {},
  });
}

test("a run grades the path: a rule the trace satisfies passes, one it breaks fails and names itself", async () => {
  const taskRoot = await fs.mkdtemp(path.join(os.tmpdir(), "trace-rules-run-"));
  const traced = { id: "c", adapter: "agent-cli", cli: { argv: [process.execPath, "-e", TRACED_AGENT], trace: "atif" } };

  const ok = await trial(suiteWith(taskRoot, { tool_used: [{ name: "bash_command", min: 1 }], max_tool_calls: 30 }), traced);
  assert.equal(ok.checkState, "pass", ok.checkOutput);
  assert.match(ok.checkOutput ?? "", /trace: bash_command called 21 times \(min 1\); 23 tool calls \(max 30\)/);
  assert.match(ok.checkVersion ?? "", /\+trace-[0-9a-f]{8}$/);

  const broke = await trial(suiteWith(taskRoot, { tool_used: [{ name: "mark_task_complete", max: 1 }] }), traced);
  assert.equal(broke.checkState, "fail");
  assert.equal(broke.checkReason, "trace rule: mark_task_complete called 2 times, max 1");

  const untraced = await trial(suiteWith(taskRoot, { tool_used: [{ name: "bash_command", min: 1 }] }), { id: "c", adapter: "agent-cli", cli: { argv: [process.execPath, "-e", TRACED_AGENT] } });
  assert.equal(untraced.checkState, "pass", "no cli.trace: graded on the deliverable alone");
  assert.match(untraced.checkOutput ?? "", /trace rules not applied \(no cli.trace\)/);

  const promised = await trial(suiteWith(taskRoot, { tool_used: [{ name: "bash_command", min: 1 }] }), { id: "c", adapter: "agent-cli", cli: { argv: [process.execPath, "-e", "require('fs').writeFileSync('out.txt', 'done')"], trace: "atif" } });
  assert.equal(promised.checkState, "not_evaluated", "a declared trace that never arrived leaves the path unjudged");
});

test("--reuse regrades a trial when only the trace rules changed", async () => {
  const spec = await tracedTask("      trace:\n        tool_used: [{ name: bash_command, min: 1 }]\n", TRACER("atif"));
  await runSuite(spec, false, { yes: true, onEvent: () => {} });

  const yaml = await fs.readFile(spec, "utf-8");
  await fs.writeFile(spec, yaml.replace("tool_used: [{ name: bash_command, min: 1 }]", "tool_used: [{ name: bash_command, max: 5 }]"));
  const events: { reusedFrom?: string; check?: string }[] = [];
  const saved = process.env.EVAL_REUSE;
  process.env.EVAL_REUSE = "1";
  try {
    await runSuite(spec, false, { yes: true, onEvent: (e) => { if (e.type === "trial") events.push(e); } });
  } finally {
    if (saved === undefined) delete process.env.EVAL_REUSE;
    else process.env.EVAL_REUSE = saved;
  }

  const [t] = events;
  assert.ok(t?.reusedFrom, "the agent did not run again");
  assert.equal(t?.check, "fail", "the new rule (max 5 bash calls) was applied to the kept trace");
});

test("--reuse does not keep an old verdict for an agent whose files were not kept: it says the trial cannot be regraded", async () => {
  // Arrange - one run, then its kept files go missing and the check changes.
  const spec = await tracedTask("", UNTRACED);
  await runSuite(spec, false, { yes: true, onEvent: () => {} });
  const runs = path.join(path.dirname(spec), "runs");
  const [run] = await fs.readdir(runs);
  await fs.rm(path.join(runs, run, "checks"), { recursive: true, force: true });
  await fs.appendFile(path.join(path.dirname(spec), "checks", "gate.cjs"), "// v2\n");

  // Act
  const events: { reusedFrom?: string; check?: string }[] = [];
  const saved = process.env.EVAL_REUSE;
  process.env.EVAL_REUSE = "1";
  try {
    await runSuite(spec, false, { yes: true, onEvent: (e) => { if (e.type === "trial") events.push(e); } });
  } finally {
    if (saved === undefined) delete process.env.EVAL_REUSE;
    else process.env.EVAL_REUSE = saved;
  }

  // Assert - reused, and marked ungradable instead of passing on the old check.
  const [t] = events;
  assert.ok(t?.reusedFrom, "the agent did not run again");
  assert.equal(t?.check, "evaluator_error");
});
