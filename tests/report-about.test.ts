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
      description: Decide why a claim was denied and what to do next.
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
  assert.equal(suite.stepDescription, "Decide why a claim was denied and what to do next.");
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
  assert.deepEqual(about, { description: "Frozen text.", stepDescription: null, checkDescription: "Frozen check.", labels: { a: { tags: ["x"] } }, source: "frozen", checkReport: null, caveats: [] });
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
  assert.equal(m.step.description, "Decide why a claim was denied and what to do next.");
});

test("about: a workflow step's run dir (<task>/runs/<run>/<step>) finds the spec one level further up", async () => {
  const manifest = { spec: { path: "tasks/demo/spec.yaml", sha256: "s" }, step: { id: "triage", version: "1" }, test_set: { id: "t", inputs: {} }, evaluators: {} } as unknown as RunManifest;
  const stepDir = path.join(await taskWithRun(manifest), "triage");
  await fs.mkdir(stepDir);
  const about = await aboutOfRun(stepDir, manifest);
  assert.equal(about.source, "current-spec");
  assert.equal(about.description, "Which model triages a denied claim correctly.");
});

test("about: a workflow run takes its description from its first step's manifest", async () => {
  const { aboutOfWorkflow } = await import("../src/canon/about.js");
  const manifest = { spec: { path: "tasks/demo/spec.yaml", sha256: "s" }, step: { id: "triage", version: "1" }, test_set: { id: "t", inputs: {} }, evaluators: {} };
  const root = await taskWithRun(manifest as unknown as RunManifest);
  await fs.mkdir(path.join(root, "triage"));
  await fs.writeFile(path.join(root, "triage", "manifest.json"), JSON.stringify(manifest));
  const about = await aboutOfWorkflow(root, ["missing-step", "triage"]);
  assert.equal(about?.description, "Which model triages a denied claim correctly.");
  assert.equal(await aboutOfWorkflow(root, ["missing-step"]), null);
  const { stepDescriptionsOf } = await import("../src/canon/about.js");
  assert.deepEqual(await stepDescriptionsOf(root, ["missing-step", "triage"]), [{ id: "triage", description: "Decide why a claim was denied and what to do next." }]);
});

test("about: an older run reads the current spec, and says so", async () => {
  const manifest = { spec: { path: "tasks/demo/spec.yaml", sha256: "s" }, step: { id: "triage", version: "1" }, test_set: { id: "t", inputs: {} }, evaluators: {} } as unknown as RunManifest;
  const about = await aboutOfRun(await taskWithRun(manifest), manifest);
  assert.equal(about.source, "current-spec");
  assert.equal(about.description, "Which model triages a denied claim correctly.");
  assert.equal(about.checkDescription, "Root cause, next action and deadline must match the key.");
  assert.equal(about.stepDescription, "Decide why a claim was denied and what to do next.");
  assert.deepEqual(about.labels, { a: { tags: ["normal"], split: "dev" } });
});

/* ── what the check leads with, and what to read the numbers with ─────────── */

const REPORTING = SPEC.replace("description: Which model", "caveats:\n  - The judge is not calibrated against people.\n  - Labels were confirmed by a model.\ndescription: Which model").replace(
  "      description: Root cause",
  "      report:\n        headline:\n          - { label: Fields right, measure: fields_right, of: fields, by_slice: true }\n          - { label: Notes, measure: [notes, asides], tag: hard }\n        slice_groups:\n          - { title: Difficulty, tags: [normal, hard] }\n        parts:\n          title: Every field\n          tag_groups:\n            - { title: Difficulty, tags: [normal, hard] }\n        input_groups:\n          - { tag: normal, title: Ordinary claims, pass: every field right }\n      description: Root cause",
);
const DECLARED = {
  headline: [{ label: "Fields right", measure: "fields_right", of: "fields", by_slice: true }, { label: "Notes", measure: ["notes", "asides"], tag: "hard" }],
  slice_groups: [{ title: "Difficulty", tags: ["normal", "hard"] }],
  parts: { title: "Every field", tag_groups: [{ title: "Difficulty", tags: ["normal", "hard"] }] },
  input_groups: [{ tag: "normal", title: "Ordinary claims", pass: "every field right" }],
};

test("spec: a check's report and the spec's caveats compile onto the suite", () => {
  const suite = compileSpec(parseSpec(REPORTING, "spec.yaml"), "spec.yaml", "sha", "/task");
  assert.deepEqual(suite.checkReport, DECLARED);
  assert.deepEqual(suite.caveats, ["The judge is not calibrated against people.", "Labels were confirmed by a model."]);
  assert.equal(compileSpec(parseSpec(SPEC, "spec.yaml"), "spec.yaml", "sha", "/task").checkReport, undefined);
});

test("spec: a report with no headline, a headline with no label, or an empty caveat is rejected", () => {
  assert.throws(() => parseSpec(REPORTING.replace(/        headline:\n.*\n.*\n/, ""), "spec.yaml"), /headline/);
  assert.throws(() => parseSpec(REPORTING.replace("label: Notes, ", ""), "spec.yaml"), /label/);
  assert.throws(() => parseSpec(REPORTING.replace("          title: Every field\n", ""), "spec.yaml"), /title/);
  assert.throws(() => parseSpec(REPORTING.replace(", pass: every field right", ""), "spec.yaml"), /pass/);
  assert.throws(() => parseSpec(REPORTING.replace("Labels were confirmed by a model.", '""'), "spec.yaml"));
});

test("manifest: a new run freezes the check's report and the caveats", async () => {
  const { buildManifest } = await import("../src/canon/manifest.js");
  const run = await taskWithRun({});
  const suite = compileSpec(parseSpec(REPORTING, "spec.yaml"), "spec.yaml", "sha", path.resolve(run, "..", ".."));
  const m = await buildManifest(suite, { runId: "r", startedAt: "2026-10-16T00:00:00Z", concurrency: 1, inputShas: {}, rubricSha: "", producerTemplateSha: "", judgeTemplateSha: "", scoreTemplateSha: "", checkVersion: null });
  assert.deepEqual(m.evaluators.check_report, DECLARED);
  assert.deepEqual(m.caveats, ["The judge is not calibrated against people.", "Labels were confirmed by a model."]);
});

test("about: the check's report is the one the run froze; a built-in kind has its own; caveats come frozen", async () => {
  const base = { spec: { path: "tasks/demo/spec.yaml", sha256: "s" }, step: { id: "triage", version: "1" }, description: "d", test_set: { id: "t", inputs: {} } };
  const declared = { ...base, caveats: ["Frozen caveat."], evaluators: { check_report: DECLARED, check_version: "command-1" } } as unknown as RunManifest;
  const about = await aboutOfRun(await taskWithRun(declared), declared);
  assert.deepEqual(about.checkReport, DECLARED);
  assert.deepEqual(about.caveats, ["Frozen caveat."]);
  assert.equal(about.caveatsFromCurrentSpec, undefined);

  const builtIn = { ...base, caveats: [], evaluators: { check_version: "findings-match-2+opts-abc" } } as unknown as RunManifest;
  assert.equal((await aboutOfRun(await taskWithRun(builtIn), builtIn)).checkReport?.headline[0]?.label, "Knowable defects caught");
});

test("about: a run frozen before caveats existed reads them from the current spec, and says so", async () => {
  const manifest = { spec: { path: "tasks/demo/spec.yaml", sha256: "s" }, step: { id: "triage", version: "1" }, description: "d", test_set: { id: "t", inputs: {} }, evaluators: {} } as unknown as RunManifest;
  const run = await taskWithRun(manifest);
  await fs.writeFile(path.resolve(run, "..", "..", "spec.yaml"), REPORTING);
  const about = await aboutOfRun(run, manifest);
  assert.equal(about.source, "frozen");
  assert.deepEqual(about.caveats, ["The judge is not calibrated against people.", "Labels were confirmed by a model."]);
  assert.equal(about.caveatsFromCurrentSpec, true);
});
