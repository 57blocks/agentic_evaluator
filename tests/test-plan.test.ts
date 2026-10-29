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
  assert.equal(step.task, "the model writes code files from the input");
  assert.deepEqual(step.inputs.map((i) => i.id), ["code-utils", "code-component", "code-schema"]);
  assert.match(step.inputs[0].title ?? "", /TypeScript utility module/);
  assert.equal(step.candidates.find((c) => c.isControl)?.id, "sonnet-5");
  assert.match(step.checks[0].how, /tsc --noEmit/);
  assert.deepEqual(step.gates, ["required-check pass rate ≥ 100%", "reliability ≥ 100%"]);
  assert.equal(step.mode.label, "lowest cost");
  assert.equal(step.scale.generations, step.candidates.length * step.inputs.length * step.trials);
});

test("a run reads out what it actually tested, from its own manifest", async () => {
  const step = planFromRun(await loadBundle(path.join(fixturesDir(), "codegen-w38")));

  assert.equal(step.id, "codegen");
  assert.equal(step.candidates.length, 3);
  // Input text is not in the run directory; the plan says nothing rather than guess.
  assert.ok(step.inputs.every((i) => i.title === null));
  assert.deepEqual(step.gates, ["required-check pass rate ≥ 100%", "reliability ≥ 100%"]);
  assert.ok(step.judge && step.judge.dimensions.length > 0);
});

test("an input's title skips comments and heading marks", () => {
  assert.equal(inputTitle("<!-- FROZEN FIXTURE -->\n\n# PRD: To-Do App\n\nbody"), "PRD: To-Do App");
  assert.equal(inputTitle("\n\nImplement X.\nmore"), "Implement X.");
  assert.ok(inputTitle("a".repeat(200)).endsWith("…"));
});

test("an agent candidate says whether it ran isolated", () => {
  assert.match(candidateVia({ id: "a", adapter: "agent-cli", cli: { argv: ["node", "a.mjs"] } }), /run directly on this machine/);
  assert.match(candidateVia({ id: "b", adapter: "agent-cli", cli: { argv: ["x"], image: "node:22" } }), /docker \(node:22\)/);
  assert.match(candidateVia({ id: "c", model: "m", provider_route: "openrouter" }), /called via openrouter/);
});

test("a prompt variant's route names its own template and whether it carries a system prompt", async () => {
  // Arrange
  const suites = await loadWorkflow(path.join(INSTALL_ROOT, "examples", "tasks", "compare-prompts", "spec.yaml"));
  const defs = suites[0].candidateDefs ?? {};

  // Act / Assert
  assert.equal(candidateVia(defs["notes-original"]), "called via openrouter, temperature 0.3");
  assert.equal(candidateVia(defs["notes-checklist"]), "called via openrouter, temperature 0.3, its own prompt prompts/notes-checklist.md");
  assert.equal(candidateVia(defs["notes-system"]), "called via openrouter, temperature 0.3, with a system prompt");
});
