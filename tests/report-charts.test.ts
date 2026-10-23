import { test } from "node:test";
import assert from "node:assert/strict";
import { dimensionKeys, profiles, renderScoreDistribution, renderScoreSummary, scoreDistribution } from "../src/report-charts.js";
import type { TrialRow } from "../src/canon/rows.js";

const DIMS = ["a", "b", "c"];

function trial(
  candidate: string,
  trialIndex: number,
  dims: Record<string, number> | null,
  overall: number | null,
  over: Partial<TrialRow> = {},
): TrialRow {
  return {
    candidate,
    trial: trialIndex,
    input: "case-1",
    completion_state: "success",
    truncated: false,
    task_outcome: "undetermined",
    judge: { pairwise: null, absolute_overall: overall, absolute_dimensions: dims },
    ...over,
  } as unknown as TrialRow;
}

const ROWS: TrialRow[] = [
  trial("alpha", 0, { a: 4, b: 4, c: 5 }, 4),
  trial("alpha", 1, { a: 5, b: 4, c: 5 }, 4),
  trial("beta", 0, { a: 2, b: 3, c: 3 }, 3),
];

test("profiles average each dimension per candidate and keep the trial count", () => {
  const [alpha, beta] = profiles(ROWS);
  assert.deepEqual(dimensionKeys(ROWS), DIMS);
  assert.equal(alpha.scores.a, 4.5);
  assert.equal(alpha.trials, 2);
  assert.equal(beta.scores.a, 2);
});

test("a dimension nobody scored stays null, never zero", () => {
  const [p] = profiles([trial("alpha", 0, { a: 4 }, 4), trial("alpha", 1, { b: 3 }, 3)]);
  assert.equal(p.scores.a, 4);
  assert.equal(p.scores.b, 3);
  const [q] = profiles([trial("solo", 0, null, null)]);
  assert.equal(q.overall, null);
});

test("the distribution counts each score per dimension and keeps unscored trials apart", () => {
  // Arrange: a bimodal candidate — the mean (3.0) hides that it is all 1s and 5s.
  const trials = [
    trial("split", 0, { basis: 5 }, 5),
    trial("split", 1, { basis: 1 }, 1),
    trial("split", 2, null, null, { completion_state: "timeout" }),
  ];

  // Act
  const [basis] = scoreDistribution(trials);

  // Assert
  assert.equal(basis.dim, "basis");
  const [row] = basis.rows;
  assert.deepEqual(row.counts, [1, 0, 0, 0, 1]);
  assert.equal(row.unscored, 1);
  assert.equal(row.n, 3);
  assert.equal(row.mean, 3);
});

test("every dimension lists candidates in one order: most right answers first, not best-written", () => {
  // Arrange: "fluent" writes better notes, "right" gets more answers right.
  const trials = [
    trial("fluent", 0, { x: 5, y: 5 }, 5),
    trial("right", 0, { x: 3, y: 4 }, 3.5),
    trial("unchecked", 0, { x: 5, y: 5 }, 5),
  ];
  const checks = new Map([["fluent", { pass: 5, executed: 10 }], ["right", { pass: 9, executed: 10 }]]);

  // Act
  const blocks = scoreDistribution(trials, checks);

  // Assert: a candidate the check never ran on goes last.
  assert.deepEqual(blocks.map((b) => b.rows.map((r) => r.candidate)), [["right", "fluent", "unchecked"], ["right", "fluent", "unchecked"]]);
});

test("without check results, the judge's mean orders the rows", () => {
  const blocks = scoreDistribution([trial("low", 0, { x: 2 }, 2), trial("high", 0, { x: 5 }, 5)]);
  assert.deepEqual(blocks[0].rows.map((r) => r.candidate), ["high", "low"]);
});

test("a dimension where every candidate scored alike is flagged as saturated", () => {
  const trials = [
    trial("a", 0, { completeness: 5, testability: 3 }, 4),
    trial("b", 0, { completeness: 5, testability: 4 }, 4),
  ];

  const [completeness, testability] = scoreDistribution(trials);

  assert.equal(completeness.saturated, true);
  assert.equal(testability.saturated, false);
});

test("the chart puts the required-check pass rate on the same row as the judge score", () => {
  const html = renderScoreDistribution(ROWS, new Map([["alpha", { pass: 1, executed: 2 }]]));

  assert.match(html, /alpha[\s\S]*?4\.5[\s\S]*?1 \/ 2/);
  assert.match(html, /beta[\s\S]*?—/, "a candidate with no check numbers shows a dash, not 0");
});

test("every segment says what it is on hover, and a table carries the exact counts", () => {
  const html = renderScoreDistribution(ROWS, new Map());

  assert.match(html, /title="alpha · a = 5: 1 of 2 trials \(50%\)"/);
  assert.match(html, /<details>[\s\S]*<table/);
});

test("candidate names are escaped", () => {
  const html = renderScoreDistribution([trial("<script>", 0, { a: 4 }, 4)], new Map());
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("nothing scored draws nothing", () => {
  assert.equal(renderScoreDistribution([trial("alpha", 0, null, null)], new Map()), "");
});

test("the summary prints every mean in the distribution's row order, with the required check", () => {
  // Arrange: beta writes worse notes but gets more answers right.
  const checks = new Map([["alpha", { pass: 1, executed: 2 }], ["beta", { pass: 2, executed: 2 }]]);

  // Act
  const html = renderScoreSummary(ROWS, checks);

  // Assert
  assert.ok(html.indexOf(">beta<") < html.indexOf(">alpha<"), "rows follow the required check, as the bars do");
  assert.match(html, />4\.5</);
  assert.match(html, />2\.0</);
  assert.match(html, /2 \/ 2/);
});

test("the summary flags a dimension where every candidate scored alike", () => {
  const trials = [
    trial("a", 0, { completeness: 5, testability: 3 }, 4),
    trial("b", 0, { completeness: 5, testability: 4 }, 4),
  ];

  const html = renderScoreSummary(trials, new Map());

  assert.match(html, /completeness <span class="viz-flag">no spread<\/span>/);
  assert.doesNotMatch(html, /testability <span class="viz-flag">/);
});
