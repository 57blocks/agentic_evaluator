/** The `evaluators.human` block: loaded into the step, validated, and preflighted. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkflow } from "../src/spec/load-spec.js";
import { preflightTask } from "../src/core/preflight.js";

const SAMPLE = path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check");

async function sampleWith(human: string | null): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "review-spec-"));
  await fs.cp(SAMPLE, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  if (human !== null) {
    const spec = path.join(dir, "spec.yaml");
    const yaml = await fs.readFile(spec, "utf-8");
    await fs.writeFile(spec, yaml.replace("  judge:\n", `${human}\n  judge:\n`));
  }
  return path.join(dir, "spec.yaml");
}

test("a human block is loaded into the step, its dimensions defaulting to judged_dimensions", async () => {
  const spec = await sampleWith("  human:\n    rubric_file: rubrics/notes.md\n    method: pairwise\n    show: [RELEASE_NOTES.md]");

  const [suite] = await loadWorkflow(spec);

  assert.deepEqual(suite.human, { rubricFile: "rubrics/notes.md", method: "pairwise", show: ["RELEASE_NOTES.md"], dimensions: suite.dimensions ?? [] });
});

test("declared dimensions win over judged_dimensions", async () => {
  const spec = await sampleWith("  human:\n    rubric_file: rubrics/notes.md\n    dimensions: [clarity, completeness]");

  const [suite] = await loadWorkflow(spec);

  assert.deepEqual(suite.human?.dimensions, ["clarity", "completeness"]);
  assert.equal(suite.human?.method, "pairwise");
});

test("an unknown review method is rejected by the schema", async () => {
  const spec = await sampleWith("  human:\n    rubric_file: rubrics/notes.md\n    method: vibes");

  await assert.rejects(loadWorkflow(spec), /method/);
});

test("no human block, no human config", async () => {
  const [suite] = await loadWorkflow(await sampleWith(null));

  assert.equal(suite.human, undefined);
});

test("check-task blocks on a missing review rubric and warns when show matches no reference file", async () => {
  const spec = await sampleWith("  human:\n    rubric_file: rubrics/missing.md\n    show: [nothing-*.md]");
  const ref = path.join(path.dirname(spec), "references", "changelog");
  await fs.mkdir(ref, { recursive: true });
  await fs.writeFile(path.join(ref, "RELEASE_NOTES.md"), "# v2\n");

  const report = await preflightTask(spec);
  const codes = report.steps.flatMap((s) => s.findings).map((f) => `${f.severity}:${f.code}`);

  assert.ok(codes.includes("blocking:review.rubric-missing"), codes.join(" "));
  assert.ok(codes.includes("warning:review.show-empty"), codes.join(" "));
});
