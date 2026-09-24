import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fixturesDir, INSTALL_ROOT } from "../src/paths.js";
import { loadWorkflow } from "../src/spec/load-spec.js";
import { loadBundle } from "../src/report-v2.js";
import { candidateVia, inputTitle, planFromRun, planFromSuites } from "../src/test-plan.js";

const SPEC = path.join(INSTALL_ROOT, "tasks", "codegen-w38", "spec.yaml");

test("a spec reads out as the task, the field, the check, the gates and the pick", async () => {
  const plan = await planFromSuites(await loadWorkflow(SPEC));
  const [step] = plan.steps;

  assert.equal(plan.budgetUsd, 10);
  assert.equal(step.task, "模型按输入写出代码文件");
  assert.deepEqual(step.inputs.map((i) => i.id), ["code-utils", "code-component", "code-schema"]);
  assert.match(step.inputs[0].title ?? "", /TypeScript utility module/);
  assert.equal(step.candidates.find((c) => c.isControl)?.id, "sonnet-5");
  assert.match(step.checks[0].how, /tsc --noEmit/);
  assert.deepEqual(step.gates, ["必过检查通过率 ≥ 100%", "任务成功率 ≥ 100%"]);
  assert.equal(step.mode.label, "成本最低");
  assert.equal(step.scale.generations, step.candidates.length * step.inputs.length * step.trials);
});

test("a run reads out what it actually tested, from its own manifest", async () => {
  const step = planFromRun(await loadBundle(path.join(fixturesDir(), "codegen-w38")));

  assert.equal(step.id, "codegen");
  assert.equal(step.candidates.length, 3);
  // Input text is not in the run directory; the plan says nothing rather than guess.
  assert.ok(step.inputs.every((i) => i.title === null));
  assert.deepEqual(step.gates, ["必过检查通过率 ≥ 100%", "任务成功率 ≥ 100%"]);
  assert.ok(step.judge && step.judge.dimensions.length > 0);
});

test("an input's title skips comments and heading marks", () => {
  assert.equal(inputTitle("<!-- FROZEN FIXTURE -->\n\n# PRD: To-Do App\n\nbody"), "PRD: To-Do App");
  assert.equal(inputTitle("\n\nImplement X.\nmore"), "Implement X.");
  assert.ok(inputTitle("a".repeat(200)).endsWith("…"));
});

test("an agent candidate says whether it ran isolated", () => {
  assert.match(candidateVia({ id: "a", adapter: "agent-cli", cli: { argv: ["node", "a.mjs"] } }), /直接在本机运行/);
  assert.match(candidateVia({ id: "b", adapter: "agent-cli", cli: { argv: ["x"], image: "node:22" } }), /docker（node:22）/);
  assert.match(candidateVia({ id: "c", model: "m", provider_route: "openrouter" }), /经 openrouter 调用/);
});
