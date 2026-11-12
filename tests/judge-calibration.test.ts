import { test } from "node:test";
import assert from "node:assert/strict";
import { auc, calibrateJudge, LabelError, type CalibrationRow, type JudgeLabel } from "../src/canon/judge-calibration.js";

/** A graded trial with a judge score (overall, and one dimension at the same value unless said otherwise). */
function row(candidate: string, input: string, score: number | null, over: Partial<CalibrationRow> = {}): CalibrationRow {
  return {
    candidate,
    input,
    trial: 0,
    completion_state: "success",
    task_outcome: "success",
    judge: { pairwise: null, absolute_overall: score, absolute_dimensions: score === null ? null : { basis: score } },
    ...over,
  };
}

const label = (candidate: string, input: string, l: "right" | "wrong", over: Partial<JudgeLabel> = {}): JudgeLabel => ({ candidate, input, label: l, ...over });

/** n right answers scored `hi` and n wrong answers scored `lo`, one input each. */
function separated(n: number, hi: number, lo: number): { labels: JudgeLabel[]; rows: CalibrationRow[] } {
  const labels: JudgeLabel[] = [];
  const rows: CalibrationRow[] = [];
  for (let i = 0; i < n; i++) {
    labels.push(label("m", `r${i}`, "right"), label("m", `w${i}`, "wrong"));
    rows.push(row("m", `r${i}`, hi), row("m", `w${i}`, lo, { task_outcome: "failure" }));
  }
  return { labels, rows };
}

test("AUC: perfect separation is 1, reversed is 0, all ties are 0.5", () => {
  assert.equal(auc([5, 5, 4], [1, 2]), 1);
  assert.equal(auc([1, 2], [5, 4]), 0);
  assert.equal(auc([5, 5], [5, 5, 5]), 0.5);
  assert.equal(auc([], [1]), null);
});

test("a score that ranks every right answer above every wrong one separates them", () => {
  const { labels, rows } = separated(20, 5, 2);

  const overall = calibrateJudge(labels, rows).measures.find((m) => m.measure === "overall")!;

  assert.equal(overall.auc, 1);
  assert.equal(overall.verdict, "separates");
  assert.ok(overall.interval && overall.interval.low > 0.5);
  assert.equal(overall.wrongAtTop, 0);
});

test("a score that gives everything 5 does not separate, and says how many wrong answers got the top score", () => {
  const { labels, rows } = separated(20, 5, 5);

  const overall = calibrateJudge(labels, rows).measures.find((m) => m.measure === "overall")!;

  assert.equal(overall.auc, 0.5);
  assert.equal(overall.verdict, "does-not-separate");
  assert.equal(overall.wrongAtTop, 20);
  assert.deepEqual(overall.wrong.counts, { "5": 20 });
});

test("with too few labels on one side there is no verdict", () => {
  const { labels, rows } = separated(3, 5, 1);
  assert.equal(calibrateJudge(labels, rows).measures[0]?.verdict, "too-few");
});

test("each judged dimension is measured on its own, beside the overall score", () => {
  // Arrange: overall separates, the `clarity` dimension does not.
  const { labels, rows } = separated(10, 5, 2);
  const withDims = rows.map((r) => ({ ...r, judge: { ...r.judge, absolute_dimensions: { basis: r.judge.absolute_overall!, clarity: 4 } } }));

  // Act
  const measures = calibrateJudge(labels, withDims).measures;

  // Assert
  assert.deepEqual(measures.map((m) => m.measure), ["overall", "basis", "clarity"]);
  assert.equal(measures.find((m) => m.measure === "basis")?.auc, 1);
  assert.equal(measures.find((m) => m.measure === "clarity")?.auc, 0.5);
});

test("says how far the labels are from the check: none differing means they are the check's verdicts", () => {
  const { labels, rows } = separated(5, 5, 2);
  assert.deepEqual(calibrateJudge(labels, rows).check, { agree: 10, disagree: 0 });

  // A human override: the check failed an answer the reviewer called right.
  const overridden = [...rows, row("m", "x", 4, { task_outcome: "failure" })];
  assert.deepEqual(calibrateJudge([...labels, label("m", "x", "right")], overridden).check, { agree: 10, disagree: 1 });
});

test("counts labels with no row, answers that never came, and answers the judge did not score", () => {
  const { labels, rows } = separated(5, 5, 2);
  const extra = [
    label("m", "missing", "right"),
    label("m", "timed-out", "wrong"),
    label("m", "unscored", "right"),
  ];
  const more = [...rows, row("m", "timed-out", null, { completion_state: "timeout", task_outcome: "failure" }), row("m", "unscored", null)];

  const c = calibrateJudge([...labels, ...extra], more);

  assert.deepEqual(c.unmatched.map((l) => l.input), ["missing"]);
  assert.equal(c.noAnswer, 1);
  assert.equal(c.measures[0]?.unscored, 1);
  assert.equal(c.measures[0]?.right.n + c.measures[0]!.wrong.n, 10);
});

test("a label that names no trial is refused when the run has several", () => {
  const rows = [row("m", "i1", 5, { trial: 0 }), row("m", "i1", 4, { trial: 1 })];
  assert.throws(() => calibrateJudge([label("m", "i1", "right", { line: 7 })], rows), (err: unknown) => err instanceof LabelError && /line 7/.test(err.message) && /trial/.test(err.message));
  assert.doesNotThrow(() => calibrateJudge([label("m", "i1", "right", { trial: 1 })], rows));
});

test("results are broken down by the labels' group", () => {
  const a = separated(6, 5, 2);
  const b = separated(6, 5, 5);
  const labels = [...a.labels.map((l) => ({ ...l, group: "easy" })), ...b.labels.map((l) => ({ ...l, candidate: "n", group: "hard" }))];
  const rows = [...a.rows, ...b.rows.map((r) => ({ ...r, candidate: "n" }))];

  const groups = calibrateJudge(labels, rows).groups;

  assert.deepEqual(groups.map((g) => [g.group, g.measures[0]?.auc]), [
    ["easy", 1],
    ["hard", 0.5],
  ]);
});

test("the interval is the same on every call: the resampling is seeded", () => {
  const { labels, rows } = separated(15, 5, 4);
  rows[0] = { ...rows[0]!, judge: { ...rows[0]!.judge, absolute_overall: 3 } };
  const one = calibrateJudge(labels, rows).measures[0]?.interval;
  const two = calibrateJudge(labels, rows).measures[0]?.interval;
  assert.deepEqual(one, two);
});
