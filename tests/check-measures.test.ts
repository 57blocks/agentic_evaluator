/**
 * A command check may report named counts beside its verdict:
 * `{"measures": {"comments": 3, "defect_claims": 1}}` on stdout. They are
 * descriptive only — no gate, no ranking — and are aggregated per candidate
 * and per slice with the input as the unit: the mean over each input's
 * graded trials first, then the mean over inputs, with a 95% t-interval over
 * the per-input means.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommandCheck } from "../src/check.js";
import { ratesFor } from "../src/canon/rates.js";
import { measureStats } from "../src/canon/measures.js";
import { measureSlices } from "../src/report-slices.js";
import { tInterval95 } from "../src/canon/stats.js";
import type { TrialRow } from "../src/canon/rows.js";
import { runSuite } from "../src/core/execute.js";
import { loadBundle, renderRunReport } from "../src/report-v2.js";
import { buildStepReport, candidateViews } from "../src/report-model.js";
import { diffRuns, type RunSide } from "../src/canon/run-diff.js";
import { diffLines } from "../src/cli/diff-lines.js";

const NODE = process.execPath;

async function check(stdout: unknown, exit = 0) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-check-measures-"));
  try {
    return await runCommandCheck({
      argv: [NODE, "-e", `console.log(${JSON.stringify(typeof stdout === "string" ? stdout : JSON.stringify(stdout))}); process.exit(${exit})`],
      versionFiles: [],
      timeoutMs: 20_000,
      files: [],
      output: "the deliverable",
      input: "the input",
      meta: { step: "review", candidate: "v0", input: "pr1", trial: 0 },
      workDir: dir,
      taskRoot: process.cwd(),
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("named measures on the check's stdout are kept with the result, passing or failing", async () => {
  const passed = await check({ evidence: "caught", measures: { comments: 3, defect_claims: 1 } });
  assert.equal(passed.state, "pass");
  assert.deepEqual(passed.measures, { comments: 3, defect_claims: 1 });

  const failed = await check({ evidence: "missed", measures: { comments: 0 } }, 1);
  assert.equal(failed.state, "fail");
  assert.deepEqual(failed.measures, { comments: 0 });
});

test("a measure with a bad name or a value that is not a finite number is dropped, never an evaluator error", async () => {
  // Arrange — 1e400 parses to Infinity; names must be lower snake case, 1–40 characters.
  const raw = `{"evidence":"ok","measures":{"comments":2.5,"Comments":1,"1st":1,"a-b":1,"${"x".repeat(41)}":1,"ok_name":"3","nil":null,"inf":1e400,"obj":{"n":1},"neg":-2}}`;

  // Act
  const result = await check(raw);

  // Assert
  assert.equal(result.state, "pass");
  assert.deepEqual(result.measures, { comments: 2.5, neg: -2 });
});

test("measures that are not an object, or that keep nothing, are absent", async () => {
  for (const bad of [[1, 2], "3", 4, null, {}, { Bad: 1 }]) {
    const result = await check({ evidence: "ok", measures: bad });
    assert.equal(result.state, "pass", `measures ${JSON.stringify(bad)} changed the verdict`);
    assert.equal(result.measures, undefined, `measures ${JSON.stringify(bad)} were kept`);
  }
  const none = await check({ evidence: "ok" });
  assert.equal(none.measures, undefined);
});

function row(candidate: string, input: string, trial: number, measures?: Record<string, number>, state = "pass"): TrialRow {
  return {
    candidate,
    input,
    trial,
    completion_state: "success",
    task_outcome: state === "pass" ? "success" : state === "fail" ? "failure" : "undetermined",
    checks: { caught: { state, version: "v1", ...(measures ? { measures } : {}) } },
    judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0.1, source: "estimated" },
    ms: 1000,
    reused_from: null,
  } as unknown as TrialRow;
}

test("a measure is averaged per input first, then over inputs, with a t-interval over the per-input means", () => {
  // Arrange — x: 1 and 3 (mean 2); y: 5. The trial mean would be 3; the input mean is 3.5.
  const rows = [row("a", "x", 0, { comments: 1 }), row("a", "x", 1, { comments: 3 }, "fail"), row("a", "y", 0, { comments: 5 })];

  // Act
  const stats = measureStats(rows, "a");

  // Assert
  assert.equal(stats.comments?.mean, 3.5);
  assert.equal(stats.comments?.n, 2);
  assert.equal(stats.comments?.trials, 3);
  // sd of [2, 5] is 2.1213, se 1.5, t(1) 12.706.
  assert.ok(Math.abs((stats.comments?.low ?? 0) - (3.5 - 12.706 * 1.5)) < 1e-3);
  assert.ok(Math.abs((stats.comments?.high ?? 0) - (3.5 + 12.706 * 1.5)) < 1e-3);
});

test("each measure has its own n: one only some inputs report is averaged over those inputs", () => {
  const rows = [
    row("a", "escaped-1", 0, { comments: 2 }),
    row("a", "clean-1", 0, { comments: 4, defect_claims: 1 }),
    row("a", "clean-2", 0, { comments: 6, defect_claims: 3 }),
  ];
  const stats = measureStats(rows, "a");
  assert.equal(stats.comments?.n, 3);
  assert.equal(stats.comments?.mean, 4);
  assert.equal(stats.defect_claims?.n, 2);
  assert.equal(stats.defect_claims?.mean, 2);
});

test("ungraded trials are left out, and one input gives a mean without an interval", () => {
  const rows = [row("a", "x", 0, { comments: 2 }), row("a", "x", 1, { comments: 100 }, "evaluator_error"), row("a", "y", 0, { comments: 50 }, "not_evaluated")];
  const stats = measureStats(rows, "a");
  assert.equal(stats.comments?.mean, 2);
  assert.equal(stats.comments?.n, 1);
  assert.equal(stats.comments?.low, null);
  assert.equal(stats.comments?.high, null);
});

test("with equal trials per input the per-input mean equals the mean over every trial", () => {
  // Three trials on each of four inputs: the review-run shape (28 × 3).
  const counts = [[3, 2, 4], [1, 1, 1], [5, 3, 4], [0, 2, 1]];
  const rows = counts.flatMap((ts, i) => ts.map((c, t) => row("v0", `pr${i}`, t, { comments: c }, t === 0 ? "pass" : "fail")));
  const flat = counts.flat();
  assert.ok(Math.abs((measureStats(rows, "v0").comments?.mean ?? 0) - flat.reduce((s, v) => s + v, 0) / flat.length) < 1e-12);
});

test("the 95% t critical value matches the table, and runs on into large samples", () => {
  assert.equal(tInterval95([1]), null);
  const two = tInterval95([2, 5])!;
  assert.ok(Math.abs(two.high - two.low - 2 * 12.706 * 1.5) < 1e-3);
  // df 30 → 2.042; df 120 → 1.980.
  const spread = (n: number) => {
    const values: number[] = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0 : 1));
    const ci = tInterval95(values)!;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
    return (ci.high - mean) / (sd / Math.sqrt(n));
  };
  assert.ok(Math.abs(spread(31) - 2.042) < 2e-3);
  assert.ok(Math.abs(spread(121) - 1.98) < 2e-3);
});

test("rates carry the measures only when a check reported some, so older summaries read the same", () => {
  const measured = ratesFor("a", [row("a", "x", 0, { comments: 2 }), row("a", "y", 0, { comments: 4 })]);
  assert.equal(measured.required_check_measures?.comments?.mean, 3);
  const plain = ratesFor("a", [row("a", "x", 0), row("a", "y", 0)]);
  assert.equal("required_check_measures" in plain, false);
});

test("measures per slice: every input first, then each tag, then each split, per candidate", () => {
  // Arrange
  const labels = {
    e1: { tags: ["escaped"], split: null },
    c1: { tags: ["clean"], split: "holdout" },
    c2: { tags: ["clean"], split: null },
  };
  const rows = [
    row("v0", "e1", 0, { comments: 3 }), row("v0", "c1", 0, { comments: 1, defect_claims: 1 }), row("v0", "c2", 0, { comments: 2, defect_claims: 0 }),
    row("head", "e1", 0, { comments: 1 }), row("head", "c1", 0, { comments: 1, defect_claims: 0 }), row("head", "c2", 0, { comments: 1, defect_claims: 0 }),
  ];

  // Act
  const slices = measureSlices(labels as never, rows, ["v0", "head"]);

  // Assert
  assert.deepEqual(slices.map((s) => s.label), ["all", "escaped", "clean", "split: holdout"]);
  assert.equal(slices[0]!.byCandidate.v0!.comments!.mean, 2);
  assert.equal(slices[1]!.byCandidate.v0!.comments!.mean, 3);
  assert.equal(slices[1]!.byCandidate.v0!.defect_claims, undefined, "no escaped input reports defect claims");
  assert.equal(slices[2]!.byCandidate.v0!.defect_claims!.mean, 0.5);
  assert.equal(slices[2]!.byCandidate.v0!.defect_claims!.n, 2);
  assert.deepEqual(measureSlices(null, rows, ["v0"]).map((s) => s.label), ["all"]);
  assert.deepEqual(measureSlices(null, [row("v0", "x", 0)], ["v0"]), [], "no measure anywhere: no slices");
});

/* ── through a real run: generate, canon rows, summary, report, reuse ───── */

const SAMPLE = path.resolve(import.meta.dirname, "..", "examples", "tasks", "custom-check");

/** A check that passes notes with a breaking-changes section and counts their lines and bullets (plus `bonus`). */
const gate = (bonus: number) =>
  `const fs = require('fs');
const notes = fs.existsSync('RELEASE_NOTES.md') ? fs.readFileSync('RELEASE_NOTES.md', 'utf8') : '';
const lines = notes.split('\\n').filter((l) => l.trim() !== '').length;
const bullets = notes.split('\\n').filter((l) => l.startsWith('- ')).length;
console.log(JSON.stringify({ evidence: lines + ' lines', measures: { lines: lines + ${bonus}, bullets } }));
process.exit(notes.includes('## Breaking changes') ? 0 : 1);
`;

async function measuredTask(): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "check-measures-"));
  const task = path.join(ws, "tasks", "measured");
  await fs.cp(SAMPLE, task, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  const spec = path.join(task, "spec.yaml");
  const yaml = (await fs.readFile(spec, "utf-8"))
    .replace("argv: [node, checks/release-notes.mjs]", `argv: [${JSON.stringify(NODE)}, checks/gate.cjs]`)
    .replace("version_files: [checks/release-notes.mjs]", "version_files: [checks/gate.cjs]");
  await fs.writeFile(spec, yaml);
  await fs.writeFile(path.join(task, "checks", "gate.cjs"), gate(0));
  return spec;
}

async function withReuse<T>(fn: () => Promise<T>): Promise<T> {
  const saved = process.env.EVAL_REUSE;
  process.env.EVAL_REUSE = "1";
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.EVAL_REUSE;
    else process.env.EVAL_REUSE = saved;
  }
}

const rowsOf = async (dir: string): Promise<TrialRow[]> =>
  (await fs.readFile(path.join(dir, "scores.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l) as TrialRow);

test("a run records the check's measures on each row and in the summary, and the report shows them", async () => {
  // Arrange
  const spec = await measuredTask();

  // Act
  const result = await runSuite(spec, false, { yes: true, onEvent: () => {} });

  // Assert
  assert.ok(result);
  const rows = await rowsOf(result.dir);
  const careful = rows.find((r) => r.candidate === "careful")!;
  const sloppy = rows.find((r) => r.candidate === "sloppy")!;
  assert.equal(careful.checks["release-notes"]?.state, "pass");
  assert.equal(sloppy.checks["release-notes"]?.state, "fail");
  const lines = careful.checks["release-notes"]?.measures?.lines;
  assert.ok(typeof lines === "number" && lines > 0);
  assert.ok((careful.checks["release-notes"]?.measures?.bullets ?? 0) > (sloppy.checks["release-notes"]?.measures?.bullets ?? 0));

  const summary = JSON.parse(await fs.readFile(path.join(result.dir, "summary.json"), "utf-8"));
  const rates = summary.candidates.find((c: { candidate: string }) => c.candidate === "careful");
  assert.equal(rates.required_check_measures.lines.mean, lines);

  const bundle = await loadBundle(result.dir);
  assert.equal(candidateViews(bundle).find((v) => v.id === "careful")?.checkMeasures.lines?.mean, lines);
  assert.equal(buildStepReport(bundle).measures[0]?.label, "all");
  const html = renderRunReport(bundle);
  assert.match(html, /Check measures/);
  assert.match(html, /bullets/);
});

test("--reuse keeps a trial's measures when the check is unchanged, and replaces them when it regrades", async () => {
  // Arrange — one run, then the same run reused.
  const spec = await measuredTask();
  const first = await runSuite(spec, false, { yes: true, onEvent: () => {} });
  const before = (await rowsOf(first!.dir)).find((r) => r.candidate === "careful")!.checks["release-notes"]!.measures!;

  // Act — unchanged check
  const kept = await withReuse(() => runSuite(spec, false, { yes: true, onEvent: () => {} }));
  const keptRow = (await rowsOf(kept!.dir)).find((r) => r.candidate === "careful")!;

  // Assert
  assert.ok(keptRow.reused_from, "the trial was generated again");
  assert.deepEqual(keptRow.checks["release-notes"]?.measures, before);

  // Act — in a fresh workspace, the check changed after the run: regraded on the kept work dir
  const spec2 = await measuredTask();
  await runSuite(spec2, false, { yes: true, onEvent: () => {} });
  await fs.writeFile(path.join(path.dirname(spec2), "checks", "gate.cjs"), gate(100));
  const regraded = await withReuse(() => runSuite(spec2, false, { yes: true, onEvent: () => {} }));
  const regradedRow = (await rowsOf(regraded!.dir)).find((r) => r.candidate === "careful")!;

  // Assert
  assert.ok(regradedRow.reused_from);
  assert.equal(regradedRow.checks["release-notes"]?.measures?.lines, (before.lines ?? 0) + 100);
});

test("a report of a run without measures has no measures section", async () => {
  const spec = await measuredTask();
  await fs.writeFile(path.join(path.dirname(spec), "checks", "gate.cjs"), "process.exit(0);\n");
  const result = await runSuite(spec, false, { yes: true, onEvent: () => {} });
  const bundle = await loadBundle(result!.dir);
  assert.equal("required_check_measures" in bundle.summary.candidates[0]!, false);
  assert.deepEqual(buildStepReport(bundle).measures, []);
  assert.doesNotMatch(renderRunReport(bundle), /Check measures/);
});

/* ── agenteval diff ──────────────────────────────────────────────────────── */

function side(run: string, rows: TrialRow[]): RunSide {
  return {
    run,
    step: "review",
    manifest: { test_set: { inputs: { x: "hx", y: "hy" } }, candidates: { v0: {}, head: {} } },
    recommendation: null,
    rates: [],
    rows,
    outputs: new Map(),
  };
}

test("diff shows each candidate's measure means in both runs", () => {
  const a = side("r1", [row("v0", "x", 0, { comments: 3 }), row("v0", "y", 0, { comments: 2 }), row("head", "x", 0, { comments: 2 }), row("head", "y", 0, { comments: 2 })]);
  const b = side("r2", [row("v0", "x", 0, { comments: 1 }), row("v0", "y", 0, { comments: 2 }), row("head", "x", 0), row("head", "y", 0)]);

  const d = diffRuns(a, b);

  const v0 = d.measures.find((m) => m.candidate === "v0" && m.measure === "comments");
  assert.equal(v0?.a?.mean, 2.5);
  assert.equal(v0?.b?.mean, 1.5);
  const head = d.measures.find((m) => m.candidate === "head" && m.measure === "comments");
  assert.equal(head?.a?.mean, 2);
  assert.equal(head?.b, null, "head reported no comments in the second run");
  const text = diffLines(d, { why: false }).join("\n");
  assert.match(text, /check measures/);
  assert.match(text, /comments/);
  assert.match(text, /2\.50 → 1\.50/);
});

test("diff of runs without measures says nothing about them", () => {
  const d = diffRuns(side("r1", [row("v0", "x", 0)]), side("r2", [row("v0", "x", 0)]));
  assert.deepEqual(d.measures, []);
  assert.doesNotMatch(diffLines(d, { why: false }).join("\n"), /measures/);
});

test("a scorecard run of a command check that declares a report leads with its headlines, and lists the spec's caveats", async () => {
  // Arrange — the check declares what to lead with; the spec says what to keep in mind.
  const spec = await measuredTask();
  const yaml = (await fs.readFile(spec, "utf-8"))
    .replace("      operating_mode: lowest-cost\n", "      operating_mode: lowest-cost\n      decision: scorecard\n")
    .replace(/^run_name: (.*)$/m, "run_name: $1\ncaveats:\n  - The check counts lines, not whether they are true.")
    .replace("      kind: command\n", "      kind: command\n      report:\n        headline:\n          - { label: Bullets among lines, measure: bullets, of: lines }\n          - { label: Lines per answer, measure: lines }\n");
  await fs.writeFile(spec, yaml);

  // Act
  const result = await runSuite(spec, false, { yes: true, onEvent: () => {} });

  // Assert
  assert.ok(result);
  const bundle = await loadBundle(result.dir);
  const html = renderRunReport(bundle);
  assert.match(html, /<th class="num wrap">Bullets among lines<\/th><th class="num wrap">Lines per answer<\/th>/);
  assert.match(html, /\d+\/\d+ · <b>\d+%<\/b>/);
  assert.doesNotMatch(html, /<span class="sub">bullets \d/, "the scorecard no longer lists every measure on a line");
  assert.match(html, /<h3>Read these numbers with care<\/h3>\s*<ul class="gaps"><li>The check counts lines, not whether they are true\.<\/li><\/ul>/);
  assert.doesNotMatch(html, /predates these caveats/, "this run froze them itself");
  const model = buildStepReport(bundle);
  assert.deepEqual(model.headline.map((h) => h.decl.label), ["Bullets among lines", "Lines per answer"]);
  assert.deepEqual(model.caveats, ["The check counts lines, not whether they are true."]);
});
