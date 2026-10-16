/**
 * Fixture inputs (`test_set.fixture_dir`) and work-dir handoff between chained
 * steps (`handoff: workdir`): docs/design/agb-flow-gaps.md A1, A2.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentCliAdapter } from "../src/adapters/resolve.js";
import type { CandidateDef } from "../src/canon/types.js";
import { sha256 } from "../src/canon/hash.js";
import { inputIdentity } from "../src/core/fixture.js";
import { preflightTask, type PreflightReport } from "../src/core/preflight.js";
import { runChainArm, type E2eGeneration } from "../src/e2e-control.js";
import { loadWorkflow } from "../src/spec/load-spec.js";
import type { Suite } from "../src/types.js";

const tmp = (prefix: string): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), prefix));

/** An agent that records what it started from: its env and the files already there. */
const RECORDER = [
  "const fs = require('fs');",
  "const seen = { step: process.env.EVAL_STEP, input: process.env.EVAL_INPUT, chained: process.env.EVAL_CHAINED, files: fs.readdirSync('.').sort() };",
  "fs.writeFileSync('seen.json', JSON.stringify(seen));",
].join(" ");

function request(extra: Partial<{ fixtureDir: string; seedFiles: { path: string; content: string }[] }>) {
  const cli: CandidateDef["cli"] = { argv: [process.execPath, "-e", RECORDER] };
  return { stepId: "qa", candidateId: "rec", inputId: "demo", inputText: "plan the tests", promptTemplate: "", temperature: 0, timeoutMs: 10_000, cli, ...extra };
}

async function seen(workDir: string): Promise<{ step: string; input: string; chained: string; files: string[] }> {
  return JSON.parse(await fs.readFile(path.join(workDir, "seen.json"), "utf-8"));
}

test("an agent starts from its input's fixture, and is told which step and input it is", async () => {
  const fixture = await tmp("fixture-");
  await fs.mkdir(path.join(fixture, "docs"));
  await fs.writeFile(path.join(fixture, "docs", "PRD.md"), "# PRD\n");
  const workDir = await tmp("work-");

  const r = await agentCliAdapter.execute(request({ fixtureDir: fixture }), { workDir, taskRoot: workDir });

  assert.deepEqual(await seen(workDir), { step: "qa", input: "demo", chained: "0", files: [".eval-input.txt", "docs"] });
  assert.ok(r.artifacts.some((f) => f.path === "docs/PRD.md"), "the fixture is part of what the agent left");
});

test("a handed-over step starts from the previous step's files, not its fixture", async () => {
  const fixture = await tmp("fixture-");
  await fs.writeFile(path.join(fixture, "from-fixture.txt"), "no\n");
  const workDir = await tmp("work-");

  await agentCliAdapter.execute(
    request({ fixtureDir: fixture, seedFiles: [{ path: ".ab/tasks.json", content: "{}" }] }),
    { workDir, taskRoot: workDir },
  );

  const s = await seen(workDir);
  assert.equal(s.chained, "1");
  assert.deepEqual(s.files, [".ab", ".eval-input.txt"]);
  assert.equal(await fs.readFile(path.join(workDir, ".ab", "tasks.json"), "utf-8"), "{}");
});

test("a handed-over file cannot land outside the work dir", async () => {
  const workDir = await tmp("work-");

  await assert.rejects(
    agentCliAdapter.execute(request({ seedFiles: [{ path: "../escape.txt", content: "x" }] }), { workDir, taskRoot: workDir }),
    /escapes the work dir/,
  );
});

test("a fixture's contents are part of the trial's identity", async () => {
  const fixture = await tmp("fixture-");
  await fs.writeFile(path.join(fixture, "a.txt"), "one");
  const before = await inputIdentity("text", fixture);
  await fs.writeFile(path.join(fixture, "a.txt"), "two");

  assert.notEqual(await inputIdentity("text", fixture), before);
  assert.equal(await inputIdentity("text", null), "text");
});

const gen = (artifacts: { path: string; content: string }[]): E2eGeneration => ({
  completion_state: "success",
  text: "done",
  artifacts,
  cost_usd: 0,
  ms: 1,
  checks: [{ evaluator: "c", version: "1", state: "pass" }],
});

function chain(handoff?: "text" | "workdir"): Suite[] {
  const base = { requiredChecks: ["c"], successCriteria: { mandatory_checks: "all" } } as unknown as Suite;
  return [
    { ...base, step: "detail" },
    { ...base, step: "qa", inputFrom: "detail", ...(handoff ? { handoff } : {}) },
  ];
}

test("handoff: workdir gives the next step the previous step's files and keeps the root input as its text", async () => {
  const calls: { step: string; text: string; seed?: readonly { path: string }[] }[] = [];

  const report = await runChainArm({
    armId: "control",
    armKind: "control",
    assignment: { detail: "a", qa: "a" },
    chain: chain("workdir"),
    rootInputs: [{ slug: "demo", text: "build demo" }],
    trials: 1,
    generate: async (step, _c, _slug, text, _trial, seed) => {
      calls.push({ step: step.step, text, seed });
      return gen([{ path: `${step.step}.json`, content: "{}" }]);
    },
  });

  assert.equal(report.totals.success, 1);
  assert.deepEqual(calls.map((c) => [c.step, c.text, c.seed?.map((f) => f.path)]), [
    ["detail", "build demo", undefined],
    ["qa", "build demo", ["detail.json"]],
  ]);
  assert.notEqual(report.cases[0].steps[1].input_sha, sha256("build demo"), "the handed-over files are part of the step's input");
});

test("without handoff: workdir a chained step still gets the previous output as text", async () => {
  const calls: { text: string; seed?: unknown }[] = [];

  await runChainArm({
    armId: "control",
    armKind: "control",
    assignment: { detail: "a", qa: "a" },
    chain: chain(),
    rootInputs: [{ slug: "demo", text: "build demo" }],
    trials: 1,
    generate: async (_step, _c, _slug, text, _trial, seed) => {
      calls.push({ text, seed });
      return gen([{ path: "detail.json", content: "{}" }]);
    },
  });

  assert.equal(calls[1].text, "```file:detail.json\n{}\n```");
  assert.equal(calls[1].seed, undefined);
});

/** The free custom-check sample with a fixture-driven step. */
async function fixtureTask(opts: { fixture: boolean }): Promise<string> {
  const sample = path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check");
  const dir = await tmp("fixture-task-");
  await fs.cp(sample, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  const spec = path.join(dir, "spec.yaml");
  const yaml = await fs.readFile(spec, "utf-8");
  await fs.writeFile(spec, yaml.replace("        inputs: [changelog]\n", "        inputs: [changelog]\n        fixture_dir: fixture\n"));
  if (opts.fixture) {
    await fs.mkdir(path.join(dir, "fixture", "changelog"), { recursive: true });
    await fs.writeFile(path.join(dir, "fixture", "changelog", "STARTED.md"), "the starting state\n");
  }
  // Fails an answer that did nothing; crashes when the fixture is not there.
  await fs.writeFile(
    path.join(dir, "checks", "release-notes.mjs"),
    "const fs = require('fs'); if (!fs.existsSync('STARTED.md')) process.exit(3); process.exit(fs.existsSync('RELEASE_NOTES.md') ? 0 : 1);\n",
  );
  await fs.rename(path.join(dir, "checks", "release-notes.mjs"), path.join(dir, "checks", "release-notes.cjs"));
  await fs.writeFile(spec, (await fs.readFile(spec, "utf-8")).replaceAll("checks/release-notes.mjs", "checks/release-notes.cjs"));
  return spec;
}

const codeOf = (r: PreflightReport, code: string) => r.steps.flatMap((s) => s.findings).find((f) => f.code === code);

test("fixture_dir and handoff load into the step", async () => {
  const [suite] = await loadWorkflow(await fixtureTask({ fixture: true }));

  assert.equal(suite.fixtureDir, "fixture");
  assert.equal(suite.handoff, undefined);
});

test("check-task's empty answer is the untouched fixture, and a missing fixture blocks", async () => {
  const ok = await preflightTask(await fixtureTask({ fixture: true }));
  assert.equal(codeOf(ok, "check.null")?.severity, "ok", codeOf(ok, "check.null")?.message);
  assert.equal(codeOf(ok, "inputs.fixture-missing"), undefined);

  const missing = await preflightTask(await fixtureTask({ fixture: false }));
  assert.equal(codeOf(missing, "inputs.fixture-missing")?.severity, "blocking");
});

/** The free chain-offline sample (draft → review) with a second root input and an e2e block. */
async function chainTask(e2e: string): Promise<string> {
  const sample = path.resolve(import.meta.dirname, "..", "examples", "tasks", "chain-offline");
  const dir = await tmp("chain-task-");
  await fs.cp(sample, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  await fs.writeFile(path.join(dir, "inputs", "big-project.txt"), "a large input\n");
  const spec = path.join(dir, "spec.yaml");
  let yaml = await fs.readFile(spec, "utf-8");
  yaml = yaml.replace("        inputs: [code-utils]\n", "        inputs: [code-utils, big-project]\n");
  yaml = yaml.replace("  control_candidate: fake-fail\n", `  control_candidate: fake-fail\n${e2e}`);
  await fs.writeFile(spec, yaml);
  return spec;
}

test("workflow.e2e picks the chain's root inputs and the check that grades its end product", async () => {
  const suites = await loadWorkflow(await chainTask("  e2e:\n    inputs: [code-utils]\n    final_checks: [tsc-noemit]\n"));
  const { e2eArmChain, e2eRootInputs, planE2e } = await import("../src/core/plan.js");

  assert.deepEqual(e2eRootInputs(suites[0]!), ["code-utils"]);
  assert.equal(planE2e(suites)?.perArm, 2, "one input × one trial × two steps");
  const arm = e2eArmChain(suites);
  assert.equal(arm[1]!.check?.id, "tsc-noemit");
  assert.deepEqual(arm[1]!.requiredChecks, ["tsc-noemit"]);
  assert.equal(arm[0], suites[0], "only the last step is regraded");
});

test("without workflow.e2e the chain runs on every root input with the last step's own check", async () => {
  const suites = await loadWorkflow(await chainTask(""));
  const { e2eArmChain, e2eRootInputs } = await import("../src/core/plan.js");

  assert.deepEqual(e2eRootInputs(suites[0]!), ["code-utils", "big-project"]);
  assert.deepEqual(e2eArmChain(suites), suites);
});

test("workflow.e2e rejects inputs the chain does not start from, and undeclared checks", async () => {
  await assert.rejects(loadWorkflow(await chainTask("  e2e:\n    inputs: [elsewhere]\n")), /e2e\.inputs elsewhere are not inputs of "draft"/);
  await assert.rejects(loadWorkflow(await chainTask("  e2e:\n    final_checks: [app-gates]\n")), /final_checks app-gates have no evaluator definition/);
});

test("workflow.e2e without a chain is rejected", async () => {
  const spec = await chainTask("  e2e:\n    inputs: [code-utils]\n");
  await fs.writeFile(spec, (await fs.readFile(spec, "utf-8")).replace("      input_from: draft\n", ""));

  await assert.rejects(loadWorkflow(spec), /workflow\.e2e needs a chain/);
});

test("a spec can share blocks with YAML merge keys, and keep them under any x- key", async () => {
  const spec = await chainTask("");
  let yaml = await fs.readFile(spec, "utf-8");
  yaml = yaml.replace("candidates:\n", "x-shared:\n  env: &env\n    SHARED: \"1\"\n\ncandidates:\n");
  yaml = yaml.replace("      argv: [node, agents/fake-codegen-agent.mjs, --mode, fail]\n", "      argv: [node, agents/fake-codegen-agent.mjs, --mode, fail]\n      env: { <<: *env, OWN: \"2\" }\n");
  await fs.writeFile(spec, yaml);

  const [suite] = await loadWorkflow(spec);

  assert.deepEqual(suite!.candidateDefs?.["fake-fail"]?.cli?.env, { SHARED: "1", OWN: "2" });
});

test("check-task blocks on a missing env var and a cap the step never sets, and warns on unpriced tokens", async () => {
  const spec = await chainTask("");
  let yaml = await fs.readFile(spec, "utf-8");
  yaml = yaml.replace(
    "      argv: [node, agents/fake-codegen-agent.mjs, --mode, fail]\n      reports_usage: true\n",
    "      argv: [node, agents/fake-codegen-agent.mjs, --mode, fail, \"{{max_cost_usd}}\"]\n      reports_usage: tokens\n      env: { KEY: \"${NOT_SET_ANYWHERE_XYZ}\" }\n",
  );
  await fs.writeFile(spec, yaml);

  const report = await preflightTask(spec);
  const codes = report.steps[0]!.findings.map((f) => `${f.severity}:${f.code}`);

  assert.ok(codes.includes("blocking:candidate.env-missing"), codes.join(" "));
  assert.ok(codes.includes("blocking:candidate.no-cost-cap"), codes.join(" "));
  assert.ok(codes.includes("warning:candidate.unpriced"), codes.join(" "));
});

test("workflow.e2e.steps raises a chained step's cap and time limit in the arms only", async () => {
  const suites = await loadWorkflow(
    await chainTask("  e2e:\n    steps:\n      review: { max_cost_per_trial_usd: 80, maximum_completion_time_seconds: 18000 }\n"),
  );
  const { e2eArmChain } = await import("../src/core/plan.js");

  const arm = e2eArmChain(suites);

  assert.equal(arm[1]!.maxCostPerTrialUsd, 80);
  assert.equal(arm[1]!.timeoutMs, 18_000_000);
  assert.equal(suites[1]!.maxCostPerTrialUsd, undefined, "the step's own evaluation is unchanged");
  await assert.rejects(loadWorkflow(await chainTask("  e2e:\n    steps:\n      nowhere: { max_cost_per_trial_usd: 1 }\n")), /e2e\.steps nowhere are not steps of the chain/);
});
