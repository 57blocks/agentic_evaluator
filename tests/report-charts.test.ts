import { test } from "node:test";
import assert from "node:assert/strict";
import { dimensionKeys, profiles, rampStep, renderHeatmap, renderRadar, renderTrialStrip } from "../src/report-charts.js";
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

test("the ramp spans the 1-5 domain and refuses a missing score", () => {
  assert.equal(rampStep(null), null);
  assert.notEqual(rampStep(1), rampStep(5));
  assert.equal(rampStep(0), rampStep(1), "below the domain clamps instead of falling off the ramp");
});

test("the radar plots at most three profiles and says what it dropped", () => {
  const many = ["a1", "a2", "a3", "a4"].flatMap((c) => [trial(c, 0, { a: 4, b: 4, c: 4 }, 4)]);
  const html = renderRadar(many);
  assert.match(html, /另有 1 个候选未画/);
  assert.equal((html.match(/viz-poly/g) ?? []).length, 3);
});

test("the radar skips a candidate with an incomplete profile", () => {
  const html = renderRadar([...ROWS, trial("gamma", 0, { a: 4 }, 4)]);
  assert.doesNotMatch(html, /gamma/);
});

test("fewer than three dimensions has no shape to draw", () => {
  assert.equal(renderRadar([trial("alpha", 0, { a: 4, b: 4 }, 4)]), "");
});

test("the heatmap prints every value, so colour is never the only channel", () => {
  const html = renderHeatmap(ROWS);
  assert.match(html, />4\.5</);
  assert.match(html, />2\.0</);
});

test("the trial strip marks a truncated or failed trial as not normal", () => {
  const html = renderTrialStrip([
    trial("alpha", 0, { a: 4 }, 4),
    trial("alpha", 1, { a: 4 }, 4, { truncated: true }),
    trial("beta", 0, null, null, { completion_state: "timeout" }),
  ]);
  assert.match(html, /viz-bad/);
  assert.match(html, /timeout（未打分）/);
});

test("candidate names are escaped", () => {
  const html = renderHeatmap([trial("<script>", 0, { a: 4, b: 4, c: 4 }, 4)]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});
