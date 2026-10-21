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

test("--no-e2e evaluates each step and skips the chain, saying so in GAPS.md", async () => {
  const spec = await sampleWorkspace();
  const events: RunEvent[] = [];

  await runSuite(spec, false, { yes: true, skipE2e: true, onEvent: (e) => events.push(e) });

  assert.ok(events.some((e) => e.type === "trial"), "the steps ran");
  assert.ok(!events.some((e) => e.type === "workflow.planned" || e.type === "e2e.arm.start"), "the chain did not");
  const runsRoot = path.join(path.dirname(spec), "runs");
  const [runId] = await fs.readdir(runsRoot);
  assert.match(await fs.readFile(path.join(runsRoot, runId!, "GAPS.md"), "utf-8"), /end-to-end validation not run/);
});

test("--reuse re-grades kept trials when the check changed, without generating again", async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "ws-"));
  const task = path.join(ws, "tasks", "notes");
  await fs.cp(path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check"), task, { recursive: true, filter: (s) => !s.includes(`${path.sep}runs`) });
  const spec = path.join(task, "spec.yaml");
  await runSuite(spec, false, { yes: true });
  // The check changes: now nothing passes.
  await fs.writeFile(path.join(task, "checks", "release-notes.mjs"), "process.stdout.write(JSON.stringify({ evidence: 'stricter now' })); process.exit(1);\n");

  const events: RunEvent[] = [];
  const saved = process.env.EVAL_REUSE;
  process.env.EVAL_REUSE = "1";
  try {
    await runSuite(spec, false, { yes: true, onEvent: (e) => events.push(e) });
  } finally {
    if (saved === undefined) delete process.env.EVAL_REUSE;
    else process.env.EVAL_REUSE = saved;
  }

  const trials = events.filter((e): e is Extract<RunEvent, { type: "trial" }> => e.type === "trial");
  assert.ok(trials.length > 0 && trials.every((e) => e.reusedFrom !== undefined), "nothing was generated again");
  assert.ok(trials.every((e) => e.check === "fail"), `every kept trial was graded by the new check: ${trials.map((e) => e.check).join(", ")}`);
});

test("--step runs only the named steps, and rejects one the spec does not have", async () => {
  const spec = await sampleWorkspace();
  const events: RunEvent[] = [];

  await runSuite(spec, false, { yes: true, steps: ["review"], onEvent: (e) => events.push(e) });

  const steps = new Set(events.filter((e): e is Extract<RunEvent, { type: "trial" }> => e.type === "trial").map((e) => e.step));
  assert.deepEqual([...steps], ["review"]);
  assert.ok(!events.some((e) => e.type === "e2e.arm.start"));
  await assert.rejects(runSuite(spec, false, { yes: true, steps: ["nope"] }), /no step nope/);
});

test("a command candidate's version_files are part of its trial identity", async () => {
  const spec = await sampleWorkspace((y) => y.replace("      reports_usage: true\n", "      reports_usage: true\n      version_files: [agents/fake-codegen-agent.mjs]\n"));
  const { trialAdapterFields } = await import("../src/adapters/resolve.js");
  const sha = async () => {
    const [draft] = await loadWorkflow(spec);
    const def = Object.values(draft!.candidateDefs!).find((d) => d.cli?.version_files);
    return trialAdapterFields(def!, "codegen").adapterConfigSha;
  };

  const before = await sha();
  const agent = path.join(path.dirname(spec), "agents", "fake-codegen-agent.mjs");
  await fs.appendFile(agent, "\n// changed\n");

  assert.notEqual(await sha(), before);
});

test("--candidate runs only the named candidates", async () => {
  const spec = await sampleWorkspace();
  const events: RunEvent[] = [];

  await runSuite(spec, false, { yes: true, candidates: ["fake-pass"], onEvent: (e) => events.push(e) });

  const who = new Set(events.filter((e): e is Extract<RunEvent, { type: "trial" }> => e.type === "trial").map((e) => e.candidate));
  assert.deepEqual([...who], ["fake-pass"]);
  await assert.rejects(runSuite(spec, false, { yes: true, candidates: ["nobody"] }), /no candidate nobody/);
});

test("combine builds one run from a full run and a later partial one, the later superseding per trial", async () => {
  const { combineRuns } = await import("../src/core/combine.js");
  const spec = await sampleWorkspace();
  const runsRoot = path.join(path.dirname(spec), "runs");
  await runSuite(spec, false, { yes: true, skipE2e: true });
  const [full] = await fs.readdir(runsRoot);
  await new Promise((r) => setTimeout(r, 20));
  await runSuite(spec, false, { yes: true, candidates: ["fake-pass"] });
  const partial = (await fs.readdir(runsRoot)).find((d) => d !== full)!;

  const result = await combineRuns(spec, [full!, partial], { html: true });

  assert.deepEqual(result.steps.map((s) => s.id), ["draft", "review"]);
  const rows = (step: string) => fs.readFile(path.join(result.dir, step, "scores.jsonl"), "utf-8").then((t) => t.trim().split("\n").map((l) => JSON.parse(l)));
  const draft = await rows("draft");
  assert.deepEqual(draft.map((r: { candidate: string }) => r.candidate).sort(), ["fake-fail", "fake-pass"], "every candidate is there");
  const provenance = JSON.parse(await fs.readFile(path.join(result.dir, "draft", "combined-from.json"), "utf-8"));
  const fromOf = (c: string) => provenance.trials.find((t: { trial: string }) => t.trial.startsWith(c))?.from;
  assert.equal(fromOf("fake-pass"), partial, "the later run supersedes");
  assert.equal(fromOf("fake-fail"), full, "the rest stays from the first");
  await fs.stat(path.join(result.dir, "report.html"));
  assert.match(await fs.readFile(path.join(result.dir, "draft", "GAPS.md"), "utf-8"), /combined run/);
});

test("combine chooses by the spec's current eligibility, not the one the source runs recorded", async () => {
  const { combineRuns } = await import("../src/core/combine.js");
  const spec = await sampleWorkspace();
  const runsRoot = path.join(path.dirname(spec), "runs");
  await runSuite(spec, false, { yes: true, skipE2e: true });
  const [full] = await fs.readdir(runsRoot);
  await new Promise((r) => setTimeout(r, 20));
  await runSuite(spec, false, { yes: true, candidates: ["fake-pass"] });
  const partial = (await fs.readdir(runsRoot)).find((d) => d !== full)!;
  // Loosen the draft step's threshold after both runs finished.
  const yaml = await fs.readFile(spec, "utf-8");
  await fs.writeFile(spec, yaml.replace("        minimum_required_check_pass_rate: 1.0\n      maximum_completion_time_seconds: 30\n    - id: review", "        minimum_required_check_pass_rate: 0.5\n      maximum_completion_time_seconds: 30\n    - id: review"));

  const result = await combineRuns(spec, [full!, partial], {});

  const recommendation = JSON.parse(await fs.readFile(path.join(result.dir, "draft", "recommendation.json"), "utf-8"));
  assert.equal(recommendation.eligibility.minimum_required_check_pass_rate, 0.5);
  const manifest = JSON.parse(await fs.readFile(path.join(result.dir, "draft", "manifest.json"), "utf-8"));
  assert.equal(manifest.eligibility.minimum_required_check_pass_rate, 0.5, "the combined run records the threshold it chose by");
});

test("judge compares a finished run's kept outputs and the recommendation follows, generating nothing", async () => {
  const { judgeRun } = await import("../src/core/judge-run.js");
  const spec = await sampleWorkspace();
  await runSuite(spec, false, { yes: true, skipE2e: true });
  const runsRoot = path.join(path.dirname(spec), "runs");
  const [run] = await fs.readdir(runsRoot);
  let calls = 0;
  const fake = (async (p: { inputSlug: string; a: string; b: string }) => {
    calls += 1;
    const winner = p.a === "fake-fail" ? "a" : "b";
    return {
      inputSlug: p.inputSlug, a: p.a, b: p.b,
      overall: { forward: winner, reverse: winner, resolved: winner, reason: "fake-fail's is clearer" },
      dimensions: {},
      usage: { calls: 2, costUsd: 0.01, retryCostUsd: 0, costSource: "reported", ms: 1 },
    };
  }) as never;

  const result = await judgeRun(spec, run!, { steps: ["draft"], judge: fake });

  assert.equal(calls, 1, "one pair: both candidates' outputs on the one input");
  assert.deepEqual(result.steps.map((s) => [s.id, s.pairs]), [["draft", 1]]);
  const dir = path.join(runsRoot, run!, "draft");
  const evals = (await fs.readFile(path.join(dir, "evaluations.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(evals.filter((e: { evaluator: string }) => e.evaluator === "pairwise-swap").length, 1);
  assert.match(await fs.readFile(path.join(dir, "GAPS.md"), "utf-8"), /judged after the run/);
});

test("on a step with fixtures the judge reads only what the candidate added or changed", async () => {
  const { answerText } = await import("../src/core/judge-run.js");
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "fixture-"));
  const trial = await fs.mkdtemp(path.join(os.tmpdir(), "trial-"));
  await fs.mkdir(path.join(fixture, "src"));
  await fs.mkdir(path.join(trial, "src"));
  await fs.writeFile(path.join(fixture, "src", "old.ts"), "export const old = 1;\n");
  await fs.writeFile(path.join(trial, "src", "old.ts"), "export const old = 1;\n");
  await fs.writeFile(path.join(trial, "src", "new.ts"), "export const added = 2;\n");
  await fs.writeFile(path.join(trial, "README.md"), "# notes\n");
  await fs.writeFile(path.join(trial, "AGENT_OUTPUT.log"), "agent chatter\n");

  const text = await answerText(trial, ["src/**", "README.md"], fixture);

  assert.match(text, /file:src\/new\.ts/);
  assert.match(text, /file:README\.md/);
  assert.doesNotMatch(text, /old\.ts|agent chatter/);
});

/** custom-check with its careful agent exiting 1 after doing the work, under a given exit_code policy. */
async function exitingAgent(policy: "fail" | "ignore" | null): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "ws-"));
  const task = path.join(ws, "tasks", "notes");
  await fs.cp(path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check"), task, { recursive: true, filter: (s) => !s.includes(`${path.sep}runs`) });
  await fs.writeFile(path.join(task, "agents", "then-exit-1.mjs"), 'await import("./notes-agent.mjs");\nprocess.exitCode = 1;\n');
  const spec = path.join(task, "spec.yaml");
  const yaml = await fs.readFile(spec, "utf-8");
  await fs.writeFile(spec, yaml.replace("argv: [node, agents/notes-agent.mjs]\n", `argv: [node, agents/then-exit-1.mjs]\n${policy ? `      exit_code: ${policy}\n` : ""}`));
  return spec;
}

test("exit_code: ignore lets the check decide a trial whose command exited non-zero after doing the work", async () => {
  const outcomes = async (policy: "fail" | "ignore" | null) => {
    const spec = await exitingAgent(policy);
    await runSuite(spec, false, { yes: true });
    const runsRoot = path.join(path.dirname(spec), "runs");
    const [run] = await fs.readdir(runsRoot);
    const rows = (await fs.readFile(path.join(runsRoot, run!, "scores.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
    return rows.find((r: { candidate: string }) => r.candidate === "careful");
  };

  const ignored = await outcomes("ignore");
  assert.equal(ignored.completion_state, "success");
  assert.equal(ignored.task_outcome, "success");
  assert.equal(ignored.finish_reason, "exit 1", "the exit code is kept as evidence");
  const failed = await outcomes(null);
  assert.equal(failed.completion_state, "malformed");
  assert.equal(failed.task_outcome, "failure");
});

test("rows recorded under the default are re-decided when the spec now ignores the exit code", async () => {
  const { applyExitPolicy } = await import("../src/core/exit-policy.js");
  const row = {
    candidate: "careful", completion_state: "malformed", finish_reason: "exit 1", task_outcome: "failure", outcome_reasons: ["exited 1"], rule_version: "x",
    checks: { "release-notes": { state: "pass", version: "v1" } },
  } as never;
  const suite = { candidateDefs: { careful: { id: "careful", cli: { argv: ["x"], exit_code: "ignore" } } }, successCriteria: { mandatory_checks: "all" }, requiredChecks: ["release-notes"] } as never;

  const [after] = applyExitPolicy([row], suite);

  assert.equal(after!.completion_state, "success");
  assert.equal(after!.task_outcome, "success");
  const [untouched] = applyExitPolicy([row], { ...(suite as object), candidateDefs: {} } as never);
  assert.equal(untouched!.task_outcome, "failure");
});

test("a step's exit_code wins over the candidate's", async () => {
  const { ignoresExit } = await import("../src/core/exit-policy.js");
  const def = { id: "c", cli: { argv: ["x"], exit_code: "ignore" as const } };

  assert.equal(ignoresExit(def), true);
  assert.equal(ignoresExit(def, { exitCode: "fail" }), false);
  assert.equal(ignoresExit({ id: "d", cli: { argv: ["x"] } }, { exitCode: "ignore" }), true);
});
