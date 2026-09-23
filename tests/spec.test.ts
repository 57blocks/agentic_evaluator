import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { compileSpec, compileWorkflow, loadSpec, loadWorkflow, parseSpec, SpecError, type EvalSpec } from "../src/spec/load-spec.js";
import path from "node:path";
import { sha256 } from "../src/canon/hash.js";

const CODEGEN = "tasks/codegen-w38/spec.yaml";
/** Where a patched copy of the spec would live — its assets resolve there. */
const TASK_ROOT = path.dirname(path.resolve(CODEGEN));
const CANDIDATE_IDS = "candidate_ids: [sonnet-5, deepseek-v4-pro, kimi-k3]";

async function parsePatched(replacements: readonly (readonly [string, string])[]): Promise<{ spec: EvalSpec; sha: string }> {
  let text = await fs.readFile(CODEGEN, "utf-8");
  for (const [from, to] of replacements) text = text.replace(from, to);
  return { spec: parseSpec(text, "x.yaml"), sha: sha256(text) };
}

test("codegen spec compiles to a Suite with candidate ids, not model ids", async () => {
  const suite = await loadSpec(CODEGEN);
  assert.equal(suite.suiteId, "codegen-w38");
  assert.equal(suite.step, "codegen");
  assert.deepEqual(suite.candidates, ["sonnet-5", "deepseek-v4-pro", "kimi-k3"]);
  assert.equal(suite.candidateDefs?.["sonnet-5"].model, "anthropic/claude-sonnet-5");
  assert.equal(suite.candidateDefs?.["sonnet-5"].adapter, "codegen");
  assert.equal(suite.judge, "google/gemini-3.1-pro-preview");
  assert.deepEqual(suite.requiredChecks, ["tsc-noemit"]);
  assert.deepEqual(suite.check, { id: "tsc-noemit", kind: "tsc", scaffoldDir: "scaffold" });
  assert.equal(suite.trials, 3);
  assert.equal(suite.timeoutMs, 180_000);
  assert.equal(suite.mmd, null);
  assert.equal(suite.specSha?.length, 64);
  assert.equal(suite.eligibility?.minimum_reliability, 1);
  assert.equal(suite.eligibility?.minimum_required_check_pass_rate, 1);
  assert.equal(suite.operatingMode, "lowest-cost");
});

test("prd spec has no required checks and no tsc gate", async () => {
  const suite = await loadSpec("tasks/prd-w38/spec.yaml");
  assert.deepEqual(suite.requiredChecks, []);
  assert.equal(suite.check, undefined);
  assert.equal(suite.producer, "prompt");
  assert.equal(suite.promptFile, "prompts/prd.md");
  assert.equal(suite.candidateDefs?.[suite.candidates[0]]?.adapter, "model-api");
});

test("prd spec is an independent prd → taskbreakdown → codegen pipeline", async () => {
  const suites = await loadWorkflow("tasks/prd-w38/spec.yaml");
  assert.deepEqual(suites.map((s) => s.step), ["prd", "taskbreakdown", "codegen"]);
  const tb = suites[1];
  assert.equal(tb.producer, "prompt");
  assert.equal(tb.promptFile, "prompts/taskbreakdown.md");
  assert.equal(tb.rubricFile, "rubrics/taskbreakdown.md");
  assert.deepEqual(tb.inputs, ["todo-app.tb", "chat-app.tb"]);
  assert.deepEqual(tb.requiredChecks, []);
  assert.deepEqual(tb.dimensions, ["granularity", "dependencies", "verifiability", "faithfulness", "actionability"]);
  const code = suites[2];
  assert.equal(code.producer, "codegen");
  assert.equal(code.rubricFile, "rubrics/codegen.md");
  assert.deepEqual(code.inputs, ["code-utils", "code-component", "code-schema"]);
  assert.deepEqual(code.requiredChecks, ["tsc-noemit"]);
  assert.deepEqual(code.check, { id: "tsc-noemit", kind: "tsc", scaffoldDir: "scaffold" });
  assert.equal(code.operatingMode, "lowest-cost");
  assert.equal(code.candidateDefs?.["sonnet-5"].adapter, "codegen");
  assert.equal(suites[0].candidateDefs?.["sonnet-5"].adapter, "model-api");
});

test("schema rejects an unknown top-level field", async () => {
  const text = (await fs.readFile(CODEGEN, "utf-8")) + "\nunexpected: 1\n";
  assert.throws(() => parseSpec(text, "x.yaml"), SpecError);
});

test("semantic check rejects a step referencing an undeclared candidate", async () => {
  const { spec, sha } = await parsePatched([[CANDIDATE_IDS, "candidate_ids: [sonnet-5, ghost]"]]);
  assert.throws(() => compileSpec(spec, "x.yaml", sha, TASK_ROOT), /unknown candidate ids ghost/);
});

test("semantic check rejects a judge from the same vendor as a candidate", async () => {
  const { spec, sha } = await parsePatched([["model: google/gemini-3.1-pro-preview", "model: anthropic/claude-opus-4.8"]]);
  assert.throws(() => compileSpec(spec, "x.yaml", sha, TASK_ROOT), /shares a vendor/);
});

test("same-vendor judge is allowed only with the explicit override", async () => {
  const { spec, sha } = await parsePatched([
    ["model: google/gemini-3.1-pro-preview", "model: anthropic/claude-opus-4.8"],
    ["default_temperature: 0.2", "default_temperature: 0.2\n  allow_same_vendor_judge: true"],
  ]);
  assert.equal(compileSpec(spec, "x.yaml", sha, TASK_ROOT).judge, "anthropic/claude-opus-4.8");
});

const KIMI_BLOCK = `  - id: kimi-k3
    model: moonshotai/kimi-k3
    provider_route: openrouter
    generation_settings: { temperature: 0.2 }`;

test("agent-cli candidate may omit model and keeps codegen defaults on the others", async () => {
  const { spec, sha } = await parsePatched([
    [
      KIMI_BLOCK,
      `  - id: fake-cli
    adapter: agent-cli
    cli:
      argv: [node, tests/helpers/fake-agent-cli.mjs]`,
    ],
    [CANDIDATE_IDS, "candidate_ids: [sonnet-5, deepseek-v4-pro, fake-cli]"],
  ]);
  const suite = compileSpec(spec, "x.yaml", sha, TASK_ROOT);
  assert.equal(suite.candidateDefs?.["fake-cli"].adapter, "agent-cli");
  assert.equal(suite.candidateDefs?.["fake-cli"].model, undefined);
  assert.equal(suite.candidateDefs?.["sonnet-5"].adapter, "codegen");
});

test("agent-cli without cli.argv is rejected", async () => {
  const { spec, sha } = await parsePatched([
    [KIMI_BLOCK, "  - id: fake-cli\n    adapter: agent-cli"],
    [CANDIDATE_IDS, "candidate_ids: [sonnet-5, deepseek-v4-pro, fake-cli]"],
  ]);
  assert.throws(() => compileSpec(spec, "x.yaml", sha, TASK_ROOT), /needs cli.argv/);
});

test("model-api candidate without a model is rejected", async () => {
  const { spec, sha } = await parsePatched([
    [KIMI_BLOCK, "  - id: ghost\n    adapter: model-api"],
    [CANDIDATE_IDS, "candidate_ids: [sonnet-5, deepseek-v4-pro, ghost]"],
  ]);
  assert.throws(() => compileSpec(spec, "x.yaml", sha, TASK_ROOT), /needs a model/);
});

test("same-vendor check ignores agent-cli candidates that have no model", async () => {
  const { spec, sha } = await parsePatched([
    [KIMI_BLOCK, "  - id: fake-cli\n    adapter: agent-cli\n    cli:\n      argv: [node]"],
    [CANDIDATE_IDS, "candidate_ids: [sonnet-5, deepseek-v4-pro, fake-cli]"],
    ["model: google/gemini-3.1-pro-preview", "model: anthropic/claude-opus-4.8"],
  ]);
  assert.throws(
    () => compileSpec(spec, "x.yaml", sha, TASK_ROOT),
    (err: unknown) => {
      assert.ok(err instanceof SpecError);
      assert.match(err.message, /sonnet-5/);
      assert.doesNotMatch(err.message, /fake-cli/);
      return true;
    },
  );
});

test("duplicate step ids are rejected", () => {
  const text = `
protocol_version: "0.4"
run_name: two-step
workflow:
  steps:
    - id: codegen
      version: "1"
      test_set: { id: code-v1, inputs: [code-utils] }
      candidate_ids: [sonnet-5]
    - id: codegen
      version: "1"
      test_set: { id: code-v1, inputs: [code-utils] }
      candidate_ids: [sonnet-5]
candidates:
  - id: sonnet-5
    model: anthropic/claude-sonnet-5
evaluators:
  judge: { model: google/gemini-3.1-pro-preview, rubric_file: rubrics/codegen.md }
execution:
  trials_per_case: 1
x-harness:
  producer: codegen
`;
  const spec = parseSpec(text, "x.yaml");
  assert.throws(() => compileWorkflow(spec, "x.yaml", sha256(text), TASK_ROOT), /duplicate step ids/);
});

test("multi-step spec compiles independently per step", () => {
  const text = `
protocol_version: "0.4"
run_name: two-step
workflow:
  steps:
    - id: prd
      version: "1"
      producer: prompt
      prompt_file: prompts/prd.md
      rubric_file: rubrics/prd.md
      test_set: { id: briefs-v1, inputs: [todo-app] }
      candidate_ids: [sonnet-5]
    - id: codegen
      version: "1"
      producer: codegen
      test_set: { id: code-v1, inputs: [code-utils] }
      candidate_ids: [sonnet-5, fake-cli]
      required_checks: [tsc-noemit]
candidates:
  - id: sonnet-5
    model: anthropic/claude-sonnet-5
    provider_route: openrouter
  - id: fake-cli
    adapter: agent-cli
    cli: { argv: [node, scripts/fake-codegen-agent.mjs] }
evaluators:
  required_checks:
    tsc-noemit: { kind: tsc, scaffold_dir: scaffold }
  judge:
    model: google/gemini-3.1-pro-preview
    rubric_file: rubrics/codegen.md
execution:
  trials_per_case: 1
x-harness:
  producer: codegen
  default_temperature: 0.2
`;
  const spec = parseSpec(text, "x.yaml");
  const suites = compileWorkflow(spec, "x.yaml", sha256(text), TASK_ROOT);
  assert.equal(suites.length, 2);
  assert.equal(suites[0].step, "prd");
  assert.equal(suites[0].producer, "prompt");
  assert.equal(suites[0].promptFile, "prompts/prd.md");
  assert.equal(suites[0].rubricFile, "rubrics/prd.md");
  assert.deepEqual(suites[0].candidates, ["sonnet-5"]);
  assert.equal(suites[0].candidateDefs?.["sonnet-5"].adapter, "model-api");
  assert.equal(suites[1].step, "codegen");
  assert.equal(suites[1].producer, "codegen");
  assert.equal(suites[1].rubricFile, "rubrics/codegen.md");
  assert.deepEqual(suites[1].candidates, ["sonnet-5", "fake-cli"]);
  assert.equal(suites[1].candidateDefs?.["sonnet-5"].adapter, "codegen");
  assert.equal(suites[1].candidateDefs?.["fake-cli"].adapter, "agent-cli");
  assert.equal(compileSpec(spec, "x.yaml", sha256(text), TASK_ROOT).step, "prd");
});

test("prompt step without prompt_file is rejected", () => {
  const text = `
protocol_version: "0.4"
run_name: two-step
workflow:
  steps:
    - id: prd
      version: "1"
      producer: prompt
      test_set: { id: briefs-v1, inputs: [todo-app] }
      candidate_ids: [sonnet-5]
candidates:
  - id: sonnet-5
    model: anthropic/claude-sonnet-5
evaluators:
  judge: { model: google/gemini-3.1-pro-preview, rubric_file: rubrics/prd.md }
execution:
  trials_per_case: 1
x-harness:
  producer: codegen
`;
  const spec = parseSpec(text, "x.yaml");
  assert.throws(() => compileWorkflow(spec, "x.yaml", sha256(text), TASK_ROOT), /producer "prompt" needs prompt_file/);
});

test("a command check compiles with its argv, version files and timeout", async () => {
  const { spec, sha } = await parsePatched([
    [
      "  required_checks:\n    tsc-noemit:",
      "  required_checks:\n    task-coverage:\n      kind: command\n      argv: [\"node\", \"checks/task-coverage.mjs\"]\n      version_files: [checks/task-coverage.mjs]\n      timeout_seconds: 30\n    tsc-noemit:",
    ],
    ["required_checks: [tsc-noemit]", "required_checks: [task-coverage]"],
  ]);

  const suite = compileSpec(spec, "x.yaml", sha, TASK_ROOT);

  assert.deepEqual(suite.check, {
    id: "task-coverage",
    kind: "command",
    argv: ["node", "checks/task-coverage.mjs"],
    versionFiles: ["checks/task-coverage.mjs"],
    timeoutMs: 30_000,
  });
});

test("a command check without argv is rejected at load time", async () => {
  const { spec, sha } = await parsePatched([
    ["      kind: tsc\n      scaffold_dir: scaffold", "      kind: command"],
  ]);
  assert.throws(() => compileSpec(spec, "x.yaml", sha, TASK_ROOT), /must declare argv/);
});

test("two required checks on one step are rejected rather than silently gated on one", async () => {
  const { spec, sha } = await parsePatched([
    [
      "  required_checks:\n    tsc-noemit:",
      "  required_checks:\n    task-coverage:\n      kind: command\n      argv: [\"node\", \"checks/task-coverage.mjs\"]\n    tsc-noemit:",
    ],
    ["required_checks: [tsc-noemit]", "required_checks: [tsc-noemit, task-coverage]"],
  ]);
  assert.throws(() => compileSpec(spec, "x.yaml", sha, TASK_ROOT), /one per step is supported/);
});

test("judge methods compile onto the suite and default to both", async () => {
  const both = await loadSpec(CODEGEN);
  assert.deepEqual(both.judgeMethods, ["pairwise-swap", "absolute-1-5"]);

  const { spec, sha } = await parsePatched([
    ["    methods: [pairwise-swap, absolute-1-5]", "    methods: [pairwise-swap]"],
  ]);
  assert.deepEqual(compileSpec(spec, "x.yaml", sha, TASK_ROOT).judgeMethods, ["pairwise-swap"]);
});

test("an empty methods list turns judging off; only an absent one means both", async () => {
  // Arrange - the spec declares a judge (the schema requires one) but no method.
  const { spec, sha } = await parsePatched([
    ["    methods: [pairwise-swap, absolute-1-5]", "    methods: []"],
  ]);

  // Act
  const suite = compileSpec(spec, "x.yaml", sha, TASK_ROOT);

  // Assert - declaring nothing is not the same as declaring none. Collapsing
  // the two billed a full judging pass on a run that asked for no judging.
  assert.deepEqual(suite.judgeMethods, []);
});
