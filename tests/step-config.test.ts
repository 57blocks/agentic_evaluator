/** Per-step judging and concurrency, and resuming a run that died (docs/design/agb-flow-gaps.md C1-C3, C5). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkflow } from "../src/spec/load-spec.js";
import { resolveConcurrency } from "../src/core/plan.js";
import { runSuite } from "../src/core/execute.js";
import { JOURNAL_FILE } from "../src/core/generate.js";
import type { RunEvent } from "../src/core/events.js";

const SAMPLE = path.resolve(import.meta.dirname, "..", "examples", "tasks", "chain-offline");

/** chain-offline in a workspace of its own (a dir holding tasks/). */
async function sampleWorkspace(edit: (yaml: string) => string = (y) => y): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "ws-"));
  const task = path.join(ws, "tasks", "chain");
  await fs.cp(SAMPLE, task, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  const spec = path.join(task, "spec.yaml");
  await fs.writeFile(spec, edit(await fs.readFile(spec, "utf-8")));
  return spec;
}

test("a step's judge block overrides evaluators.judge for that step only", async () => {
  const spec = await sampleWorkspace((y) =>
    y.replace(
      "      input_from: draft\n",
      "      input_from: draft\n      judge:\n        rubric_file: rubrics/review.md\n        methods: [absolute-1-5]\n        show: [\"src/**\"]\n        dimensions: [clarity]\n",
    ),
  );

  const [draft, review] = await loadWorkflow(spec);

  assert.equal(review!.rubricFile, "rubrics/review.md");
  assert.deepEqual(review!.judgeMethods, ["absolute-1-5"]);
  assert.deepEqual(review!.judgeShow, ["src/**"]);
  assert.deepEqual(review!.dimensions, ["clarity"]);
  assert.equal(draft!.rubricFile, "rubrics/codegen.md");
  assert.deepEqual(draft!.judgeMethods, []);
  assert.equal(draft!.judgeShow, undefined);
});

test("concurrency: --concurrency wins, then the step's, then execution's", async () => {
  const spec = await sampleWorkspace((y) => y.replace("      input_from: draft\n", "      input_from: draft\n      concurrency: 2\n"));
  const [draft, review] = await loadWorkflow(spec);
  const saved = process.env.EVAL_CONCURRENCY;
  try {
    delete process.env.EVAL_CONCURRENCY;
    assert.equal(resolveConcurrency(review!), 2);
    assert.equal(resolveConcurrency(draft!), draft!.concurrency ?? 4);
    process.env.EVAL_CONCURRENCY = "7";
    assert.equal(resolveConcurrency(review!), 7, "the command line overrides the spec");
  } finally {
    if (saved === undefined) delete process.env.EVAL_CONCURRENCY;
    else process.env.EVAL_CONCURRENCY = saved;
  }
});

test("a run that died is resumed: --reuse finds the trials it journaled", async () => {
  const spec = await sampleWorkspace();
  const first: RunEvent[] = [];
  await runSuite(spec, false, { yes: true, onEvent: (e) => first.push(e) });
  const runsRoot = path.join(path.dirname(spec), "runs");
  const [runId] = await fs.readdir(runsRoot);
  // What a crash before the rows are written leaves: the journal, no rows.
  for (const step of ["draft", "review"]) {
    const dir = path.join(runsRoot, runId!, step);
    assert.ok((await fs.readFile(path.join(dir, JOURNAL_FILE), "utf-8")).trim().length > 0);
    await fs.rm(path.join(dir, "scores.jsonl"));
  }

  const second: RunEvent[] = [];
  const saved = process.env.EVAL_REUSE;
  process.env.EVAL_REUSE = "1";
  try {
    await runSuite(spec, false, { yes: true, onEvent: (e) => second.push(e) });
  } finally {
    if (saved === undefined) delete process.env.EVAL_REUSE;
    else process.env.EVAL_REUSE = saved;
  }

  // The steps' own trials: those before the end-to-end arms start (the arms
  // run the chain afresh and are not reused).
  const independent = (events: RunEvent[]) => {
    const armsAt = events.findIndex((e) => e.type === "e2e.arm.start");
    return events
      .slice(0, armsAt === -1 ? undefined : armsAt)
      .filter((e): e is Extract<RunEvent, { type: "trial" }> => e.type === "trial");
  };
  const ran = independent(first).length;
  const reused = independent(second).filter((e) => e.reusedFrom !== undefined);
  assert.ok(ran > 0);
  assert.equal(reused.length, ran, "every independent trial came back from the journal");
});
