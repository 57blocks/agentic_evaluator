/** Human verdicts in a run's report: loaded apart from evaluations, shown beside the judge. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadBundle, renderRunReport } from "../src/report-v2.js";
import { buildStepReport } from "../src/report-model.js";
import { blindLayout, reviewQueue, verdictRow, type ReviewEntry } from "../src/canon/review.js";

const FIXTURE = path.resolve(import.meta.dirname, "..", "fixtures", "codegen-w38");

/** The fixture run plus one reviewer who preferred sonnet-5 over deepseek on code-utils. */
async function reviewedRun(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "review-report-"));
  await fs.cp(FIXTURE, dir, { recursive: true });
  const trials = (await fs.readFile(path.join(dir, "scores.jsonl"), "utf-8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const item = reviewQueue(trials, { includeFailed: true }).find((i) => i.input === "code-utils" && i.a === "deepseek-v4-pro" && i.b === "sonnet-5")!;
  const layout = blindLayout("run", "xing", item);
  const sonnetOn = layout.left === "b" ? "left" : "right";
  const entry: ReviewEntry = verdictRow({ run: "run", step: "codegen", rubricSha: "abc", reviewer: "xing", item, layout, overall: sonnetOn });
  await fs.mkdir(path.join(dir, "reviews"));
  await fs.writeFile(path.join(dir, "reviews", "xing.jsonl"), `${JSON.stringify(entry)}\n`);
  return dir;
}

test("reviews load beside evaluations, never into them", async () => {
  const b = await loadBundle(await reviewedRun());

  assert.equal(b.reviews?.length, 1);
  assert.ok(b.evaluations.every((e) => e.evaluator !== "human-pairwise"));
});

test("each candidate's human record and the judge's agreement are in the report model", async () => {
  const report = buildStepReport(await loadBundle(await reviewedRun()));

  const human = Object.fromEntries(report.candidates.map((c) => [c.id, c.human]));
  assert.equal(human["sonnet-5"]?.wins, 1);
  assert.equal(human["deepseek-v4-pro"]?.losses, 1);
  assert.equal(human["kimi-k3"]?.comparisons, 0);
  assert.deepEqual(report.review?.reviewers, ["xing"]);
  assert.equal(report.review?.reviewed, 1);
  // The judge stored this pair as (sonnet-5, deepseek) and preferred sonnet-5: the human agrees.
  assert.deepEqual(report.review?.agreement?.overall, { agree: 1, total: 1 });
  assert.ok(report.gaps.some((g) => /human review: 1 of \d+ pairs/.test(g.text)), JSON.stringify(report.gaps.map((g) => g.text)));
});

test("a run nobody reviewed has no human column and no review block", async () => {
  const report = buildStepReport(await loadBundle(FIXTURE));

  assert.equal(report.review, null);
  assert.ok(report.candidates.every((c) => c.human === null));
  assert.doesNotMatch(renderRunReport(await loadBundle(FIXTURE)), /Human win rate/);
});

test("report.html shows the human win rate and the agreement line", async () => {
  const html = renderRunReport(await loadBundle(await reviewedRun()));

  assert.match(html, /Human win rate/);
  assert.match(html, /judge agrees with the human on 1 of 1 pair/);
});
