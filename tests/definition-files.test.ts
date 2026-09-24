/**
 * Which definition file belongs to which step, and what it is for.
 *
 * The task page used to list a task's files alphabetically; on a multi-step
 * task the prompts, rubrics and inputs of every step ran together. Grouping
 * comes from what the spec actually references, never from directory names.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { INSTALL_ROOT } from "../src/paths.js";
import { loadWorkflow } from "../src/spec/load-spec.js";
import { attributeFiles } from "../src/demo/definition-files.js";

const PRD_CHAIN_FILES = [
  "README.md",
  "checks/task-coverage.mjs",
  "inputs/code-utils.txt",
  "inputs/todo-app.tb.txt",
  "inputs/todo-app.txt",
  "prompts/prd.md",
  "prompts/taskbreakdown.md",
  "rubrics/codegen.md",
  "rubrics/prd.md",
  "rubrics/taskbreakdown.md",
  "scaffold/tsconfig.json",
  "spec.yaml",
];

async function prdChain() {
  const suites = await loadWorkflow(path.join(INSTALL_ROOT, "tasks", "prd-chain-trial", "spec.yaml"));
  return attributeFiles(suites, PRD_CHAIN_FILES);
}

function filesOf(groups: Awaited<ReturnType<typeof prdChain>>, step: string): Array<[string, string]> {
  const group = groups.steps.find((s) => s.id === step);
  assert.ok(group, `no group for step ${step}`);
  return group.files.map((f) => [f.path, f.role]);
}

test("each step lists the files it references, in reading order: input, prompt, rubric, check", async () => {
  // Act
  const groups = await prdChain();

  // Assert
  assert.equal(groups.spec, "spec.yaml");
  assert.deepEqual(groups.steps.map((s) => s.id), ["prd", "taskbreakdown", "codegen"]);
  assert.deepEqual(filesOf(groups, "taskbreakdown"), [
    ["inputs/todo-app.tb.txt", "input"],
    ["prompts/taskbreakdown.md", "prompt"],
    ["rubrics/taskbreakdown.md", "rubric"],
    ["checks/task-coverage.mjs", "check"],
  ]);
});

test("a codegen step does not claim the prompt it inherits but never reads", async () => {
  // Act
  const groups = await prdChain();

  // Assert - codegen inherits x-harness.prompt_file (prompts/prd.md); the producer ignores it.
  assert.deepEqual(filesOf(groups, "codegen"), [
    ["inputs/code-utils.txt", "input"],
    ["rubrics/codegen.md", "rubric"],
    ["scaffold/tsconfig.json", "scaffold"],
  ]);
});

test("files no step references are kept, under other, and the spec is not one of them", async () => {
  // Act
  const groups = await prdChain();

  // Assert - no step references a README.
  assert.deepEqual(groups.other, ["README.md"]);
});

test("agent commands and a check's version files are attributed; words in argv are not files", async () => {
  // Arrange
  const suites = await loadWorkflow(path.join(INSTALL_ROOT, "examples", "tasks", "custom-check", "spec.yaml"));
  const files = [
    "agents/notes-agent.mjs",
    "checks/release-notes.mjs",
    "inputs/changelog.txt",
    "rubrics/notes.md",
    "spec.yaml",
  ];

  // Act
  const groups = attributeFiles(suites, files);

  // Assert
  assert.deepEqual(groups.steps[0].files.map((f) => [f.path, f.role]), [
    ["inputs/changelog.txt", "input"],
    ["rubrics/notes.md", "rubric"],
    ["checks/release-notes.mjs", "check"],
    ["agents/notes-agent.mjs", "agent"],
  ]);
  assert.deepEqual(groups.other, []);
});

test("a file two steps share appears under both", async () => {
  // Arrange
  const suites = await loadWorkflow(path.join(INSTALL_ROOT, "examples", "tasks", "chain-offline", "spec.yaml"));
  const files = ["agents/fake-codegen-agent.mjs", "inputs/code-utils.txt", "rubrics/codegen.md", "scaffold/tsconfig.json", "spec.yaml"];

  // Act
  const groups = attributeFiles(suites, files);

  // Assert
  for (const step of groups.steps) {
    assert.ok(step.files.some((f) => f.path === "inputs/code-utils.txt"), `${step.id} lost the shared input`);
    assert.ok(step.files.some((f) => f.path === "agents/fake-codegen-agent.mjs"), `${step.id} lost the shared agent`);
  }
});
