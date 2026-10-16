/** A report says what it evaluated: the spec's description, what the check grades, and results per input tag. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileSpec, parseSpec } from "../src/spec/load-spec.js";
import { aboutOfRun, parseLabels } from "../src/canon/about.js";
import { sliceRows } from "../src/report-slices.js";
import type { TrialRow } from "../src/canon/rows.js";
import type { RunManifest } from "../src/canon/manifest.js";

const SPEC = `
protocol_version: "0.3"
run_name: demo
description: Which model triages a denied claim correctly.
workflow:
  steps:
    - id: triage
      version: "1"
      test_set: { id: t, inputs: [a, b], labels_file: checks/manifest.json }
      candidate_ids: [m1]
      required_checks: [triage-check]
candidates:
  - { id: m1, model: x/y }
evaluators:
  required_checks:
    triage-check:
      kind: command
      argv: [node, checks/c.mjs]
      description: Root cause, next action and deadline must match the key.
  judge: { model: g/j, rubric_file: r.md }
execution: { trials_per_case: 1 }
x-harness: { producer: prompt, prompt_file: p.md }
`;

test("spec: description, a check's description and a labels file compile onto the suite", () => {
  const suite = compileSpec(parseSpec(SPEC, "spec.yaml"), "spec.yaml", "sha", "/task");
  assert.equal(suite.description, "Which model triages a denied claim correctly.");
  assert.equal(suite.checkDescription, "Root cause, next action and deadline must match the key.");
  assert.equal(suite.labelsFile, "checks/manifest.json");
});

test("spec: an empty description is rejected", () => {
  assert.throws(() => parseSpec(SPEC.replace("Which model triages a denied claim correctly.", '""'), "spec.yaml"));
});

test("labels: tags and split per input; anything else is refused with the input named", () => {
  assert.deepEqual(parseLabels({ a: { tags: ["hard"], split: "dev", archetype: "x" } }, "m.json"), { a: { tags: ["hard"], split: "dev" } });
  assert.throws(() => parseLabels({ a: { tags: "hard" } }, "m.json"), /"a".*tags/);
  assert.throws(() => parseLabels([], "m.json"), /m\.json/);
});

const row = (candidate: string, input: string, state: string): TrialRow =>
  ({ candidate, input, checks: { c: { state, version: "v" } } }) as unknown as TrialRow;

test("slices: pass/graded per candidate for each tag and split, ungraded trials left out", () => {
  const labels = { a: { tags: ["normal"], split: "dev" }, b: { tags: ["hard", "trap-x"], split: "holdout" }, c: { tags: ["hard"], split: "holdout" } };
  const trials = [row("m1", "a", "pass"), row("m1", "b", "fail"), row("m1", "c", "pass"), row("m2", "a", "pass"), row("m2", "b", "pass"), row("m2", "c", "evaluator_error")];
  const rows = sliceRows(labels, trials, ["m1", "m2"], "c");
  const hard = rows.find((r) => r.label === "hard")!;
  assert.equal(hard.inputs, 2);
  assert.deepEqual(hard.cells, { m1: { pass: 1, graded: 2 }, m2: { pass: 1, graded: 1 } });
  assert.deepEqual(rows.find((r) => r.label === "split: holdout")!.cells.m1, { pass: 1, graded: 2 });
  assert.deepEqual(rows.map((r) => r.label), ["normal", "hard", "trap-x", "split: dev", "split: holdout"]);
});

test("slices: none without labels or without a required check", () => {
  assert.deepEqual(sliceRows(null, [row("m1", "a", "pass")], ["m1"], "c"), []);
  assert.deepEqual(sliceRows({ a: { tags: ["x"] } }, [row("m1", "a", "pass")], ["m1"], null), []);
});

async function taskWithRun(manifest: Partial<RunManifest>): Promise<string> {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "about-"));
  await fs.writeFile(path.join(task, "spec.yaml"), SPEC);
  await fs.mkdir(path.join(task, "checks"), { recursive: true });
  await fs.writeFile(path.join(task, "checks", "manifest.json"), JSON.stringify({ a: { tags: ["normal"], split: "dev" } }));
  const run = path.join(task, "runs", "demo-1");
  await fs.mkdir(run, { recursive: true });
  return run;
}

test("about: a run that froze its description reports it as frozen", async () => {
  const manifest = { spec: { path: "tasks/demo/spec.yaml", sha256: "s" }, step: { id: "triage", version: "1" }, description: "Frozen text.", test_set: { id: "t", inputs: {}, labels: { a: { tags: ["x"] } } }, evaluators: { check_description: "Frozen check." } } as unknown as RunManifest;
  const about = await aboutOfRun(await taskWithRun(manifest), manifest);
  assert.deepEqual(about, { description: "Frozen text.", checkDescription: "Frozen check.", labels: { a: { tags: ["x"] } }, source: "frozen" });
});

test("manifest: a new run freezes the description, the check's description and the labels", async () => {
  const { buildManifest } = await import("../src/canon/manifest.js");
  const run = await taskWithRun({});
  const taskRoot = path.resolve(run, "..", "..");
  const suite = { ...compileSpec(parseSpec(SPEC, "spec.yaml"), "spec.yaml", "sha", taskRoot) };
  const m = await buildManifest(suite, { runId: "r", startedAt: "2026-10-16T00:00:00Z", concurrency: 1, inputShas: {}, rubricSha: "", producerTemplateSha: "", judgeTemplateSha: "", scoreTemplateSha: "", checkVersion: null });
  assert.equal(m.description, "Which model triages a denied claim correctly.");
  assert.equal(m.evaluators.check_description, "Root cause, next action and deadline must match the key.");
  assert.deepEqual(m.test_set.labels, { a: { tags: ["normal"], split: "dev" } });
});

test("about: an older run reads the current spec, and says so", async () => {
  const manifest = { spec: { path: "tasks/demo/spec.yaml", sha256: "s" }, step: { id: "triage", version: "1" }, test_set: { id: "t", inputs: {} }, evaluators: {} } as unknown as RunManifest;
  const about = await aboutOfRun(await taskWithRun(manifest), manifest);
  assert.equal(about.source, "current-spec");
  assert.equal(about.description, "Which model triages a denied claim correctly.");
  assert.equal(about.checkDescription, "Root cause, next action and deadline must match the key.");
  assert.deepEqual(about.labels, { a: { tags: ["normal"], split: "dev" } });
});
