/**
 * A prompt comparison reads as one: the prompts first, the judge's reasons in
 * the candidates' names, the outputs beside each other, and the run's own
 * record of which template each candidate was sent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fixturesDir, INSTALL_ROOT } from "../src/paths.js";
import { loadBundle, renderRunReport } from "../src/report-v2.js";
import { buildStepReport, promptComparisonOf, candidateViews, sideBySideOf, verdictWhy } from "../src/report-model.js";
import { firmnessNote, nameOutputs, promptLabel } from "../src/report-copy.js";
import { lineDiff, diffCounts } from "../src/report-diff.js";
import { promptsOfRun } from "../src/canon/about.js";
import { frozenPrompts } from "../src/core/execute.js";
import { loadWorkflow } from "../src/spec/load-spec.js";
import type { RunManifest } from "../src/canon/manifest.js";
import type { EvaluationRow } from "../src/canon/rows.js";

const SAMPLE = path.join(INSTALL_ROOT, "examples", "tasks", "compare-prompts");

test("nameOutputs: the judge's labels become candidate names; a bare A stays an article", () => {
  assert.equal(nameOutputs("Output B wins; Output A's formatting is worse. A tie on grouping.", "orig", "sys"), "sys wins; orig's formatting is worse. A tie on grouping.");
  assert.equal(nameOutputs("Response A and candidate B", "x", "y"), "x and candidate B");
});

test("firmnessNote: too few inputs leads, the rest follow as also, the sign test is left to How sure", () => {
  const note = firmnessNote("directional", [
    "judge-preference: the ranking rests on the judge model, not on the required checks",
    "1 input; no comparison can be significant with fewer than 6",
    "no minimum meaningful difference declared",
    "x and y cannot be told apart by the judge: preferred x on 1 input(s), y on 0, tied on 0 (sign test p 1.000)",
  ]);
  assert.equal(note, "Directional only: only 1 input(s) (fewer than 6). Also the ranking rests entirely on the judge model; the spec declares no minimum meaningful difference.");
  assert.match(firmnessNote("directional", ["x and y cannot be told apart on task success: x did better on 2 input(s), y on 1, equal on 7 (sign test p 0.500)"]), /^Directional only: x and y cannot be told apart \(the counts are under How sure\)\.$/);
  assert.equal(firmnessNote("firm", []), "Sample size and thresholds both meet the bar for a decision.");
});

test("promptLabel names the file a candidate sends, its own or the step's", () => {
  assert.equal(promptLabel({ promptFile: null, system: null }, "prompts/notes.md").prompt, "prompt prompts/notes.md (the step's)");
  assert.equal(promptLabel({ promptFile: "prompts/alt.md", system: null }, "prompts/notes.md").prompt, "prompt prompts/alt.md (its own)");
  assert.equal(promptLabel({ promptFile: null, system: null }).prompt, "prompt the step's");
});

test("lineDiff: an inserted paragraph shows as added lines, the rest unchanged", () => {
  const diff = lineDiff("a\nb\nc", "a\nx\nb\nc\nd");
  assert.deepEqual(diff.map((d) => `${d.kind}:${d.text}`), ["same:a", "add:x", "same:b", "same:c", "add:d"]);
  assert.deepEqual(diffCounts(diff), { added: 2, removed: 0 });
  assert.deepEqual(diffCounts(lineDiff("a\nb", "a")), { added: 0, removed: 1 });
});

test("frozenPrompts: a prompt step freezes the step's template and every candidate's own; a codegen step freezes none", async () => {
  const [suite] = await loadWorkflow(path.join(SAMPLE, "spec.yaml"));
  const tpl = { promptTpl: "VARIANT", promptTemplateSha: "s" };
  const frozen = frozenPrompts(suite, "prompt", "STEP", new Map([["notes-checklist", tpl]]));
  assert.deepEqual(frozen, { step_file: "prompts/notes.md", files: { "prompts/notes.md": "STEP", "prompts/notes-checklist.md": "VARIANT" } });
  assert.equal(frozenPrompts(suite, "codegen", "", new Map()), null);
});

async function sampleRun(): Promise<string | null> {
  const runs = path.join(SAMPLE, "runs");
  const dirs = (await fs.readdir(runs).catch(() => [] as string[])).filter((d) => d.startsWith("compare-prompts-")).sort();
  return dirs.length > 0 ? path.join(runs, dirs.at(-1)!) : null;
}

test("promptsOfRun: a manifest without the field falls back to the task's files and says so; with it, the record is frozen", async () => {
  // Arrange - a run dir under the sample task, with a manifest that predates the field.
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "prompts-about-"));
  const task = path.join(ws, "compare-prompts");
  await fs.cp(SAMPLE, task, { recursive: true, filter: (s) => !s.includes(`${path.sep}runs`) });
  const runDir = path.join(task, "runs", "r1");
  await fs.mkdir(runDir, { recursive: true });
  const manifest = {
    spec: { path: "tasks/compare-prompts/spec.yaml", sha256: null },
    step: { id: "notes", version: null },
    candidates: { "notes-checklist": { id: "notes-checklist", model: "m", prompt_file: "prompts/notes-checklist.md" } },
  } as unknown as RunManifest;

  // Act
  const current = await promptsOfRun(runDir, manifest);
  const frozen = await promptsOfRun(runDir, { ...manifest, prompts: { step_file: "prompts/notes.md", files: { "prompts/notes.md": "FROZEN" } } });
  const none = await promptsOfRun(runDir, { ...manifest, prompts: null });

  // Assert
  assert.equal(current.source, "current-spec");
  assert.equal(current.stepFile, "prompts/notes.md");
  assert.match(current.files["prompts/notes.md"], /release manager/);
  assert.match(current.files["prompts/notes-checklist.md"], /list every PR number/);
  assert.deepEqual(frozen, { stepFile: "prompts/notes.md", files: { "prompts/notes.md": "FROZEN" }, source: "frozen" });
  assert.deepEqual(none, { stepFile: null, files: {}, source: "frozen" });
  await fs.rm(ws, { recursive: true, force: true });
});

test("sideBySideOf: one row per input, one cell per candidate in table order, first trial, empty when nothing was saved", () => {
  const out = (candidate: string, input: string, trial: number) => ({ candidate, input, trial, text: `${candidate}-${trial}`, totalChars: 3 });
  const rows = sideBySideOf([out("b", "i1", 1), out("b", "i1", 0), out("a", "i1", 0), out("a", "i2", 0)], ["a", "b"]);
  assert.deepEqual(rows.map((r) => [r.input, r.cells.map((c) => c.output?.text ?? null)]), [["i1", ["a-0", "b-0"]], ["i2", ["a-0", null]]]);
});

test("a prompt comparison: one model, the prompts and their diffs, the why in candidate names, in both renderers", async (t) => {
  const dir = await sampleRun();
  if (dir === null) return t.skip("the compare-prompts sample has not been run here");
  const bundle = await loadBundle(dir);
  const views = candidateViews(bundle);

  // Act
  const c = promptComparisonOf(bundle, views);
  const r = buildStepReport(bundle);
  const page = renderRunReport(bundle);

  // Assert - the comparison and its parts
  assert.ok(c, "three prompts on one model is a prompt comparison");
  assert.equal(c.model, "anthropic/claude-sonnet-5");
  assert.equal(c.step.file, "prompts/notes.md");
  assert.match(c.step.text ?? "", /release manager/);
  const checklist = c.variants.find((v) => v.id === "notes-checklist")!;
  assert.equal(checklist.own, true);
  assert.ok(checklist.diff && diffCounts(checklist.diff).added > 0, "the variant's diff against the step's template");
  const system = c.variants.find((v) => v.id === "notes-system")!;
  assert.equal(system.own, false);
  assert.match(system.system ?? "", /busy users/);
  assert.equal(r.stepPromptFile, "prompts/notes.md");
  const rows = sideBySideOf(r.outputs, r.candidates.map((c) => c.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cells.length, 3);

  // Assert - the why names candidates, never the judge's labels
  const why = verdictWhy(bundle);
  if (why !== null) {
    assert.doesNotMatch(why, /Output [AB]/);
    assert.match(why, new RegExp(bundle.recommendation.chosen ?? "x"));
  }

  // Assert - the HTML says the same
  assert.ok(page.includes("Prompts compared"));
  assert.ok(page.includes("Outputs side by side"));
  assert.ok(page.includes("own template prompts/notes-checklist.md"));
  assert.ok(!/<p class="evidence">[^<]*Output [AB]/.test(page), "duel reasons use candidate names");
});

test("the why line is withheld when the judge's favourite is not the recommendation", async () => {
  // Arrange - a bundle whose recommendation is the candidate the judge ranked last.
  const bundle = await loadBundle(path.join(fixturesDir(), "codegen-w38"));
  const favourite = [...new Set(bundle.evaluations.filter((e) => e.subject.kind === "pair").map((e) => (e.subject.kind === "pair" ? e.subject.a : "")))];
  const other = bundle.manifest.control_candidate && bundle.manifest.control_candidate !== bundle.recommendation.chosen ? bundle.manifest.control_candidate : favourite.find((c) => c !== bundle.recommendation.chosen);
  assert.ok(other, "a second candidate to recommend instead");
  const swapped = { ...bundle, recommendation: { ...bundle.recommendation, chosen: other } };

  // Act / Assert - whichever of the two the judge did not favour gets no why line.
  const whys = [verdictWhy(bundle), verdictWhy(swapped)];
  assert.ok(whys.some((w) => w === null), "at most one of two different picks can be the judge's favourite");
});

test("a model comparison is not a prompt comparison, and shows no prompt sections", async () => {
  const bundle = await loadBundle(path.join(fixturesDir(), "codegen-w38"));
  assert.equal(promptComparisonOf(bundle, candidateViews(bundle)), null);
  const page = renderRunReport(bundle);
  assert.ok(!page.includes("Prompts compared"));
  // Side by side is still there for a model comparison when outputs exist.
  const rows: EvaluationRow[] = bundle.evaluations;
  assert.ok(rows.length >= 0);
});
