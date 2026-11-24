/**
 * A check's headline numbers: the few measures its report leads with, each
 * with its count or interval, instead of every measure in one line. A check
 * declares them (`report.headline`); `kind: findings-match` has its own.
 * Slices are grouped the same way (`report.slice_groups`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkReportFor, headlineDifferences, headlineValue, sliceGroups, type HeadlineDecl } from "../src/canon/headline.js";
import { wilson, tInterval95 } from "../src/canon/stats.js";
import type { MeasureRow } from "../src/canon/measures.js";

const row = (candidate: string, input: string, measures: Record<string, number>, state: "pass" | "fail" | "evaluator_error" = "fail"): MeasureRow =>
  ({ candidate, input, trial: 0, cost: { source: "estimated" }, checks: { caught: { state, measures } } }) as unknown as MeasureRow;

const CAUGHT: HeadlineDecl = { label: "Defects caught", measure: "caught", of: "defects" };

test("a share is the measure summed over graded trials, out of another summed, with Wilson's interval per input", () => {
  // Arrange — two inputs, two trials each: 1 of 2 defects, then 2 of 2; and 0 of 1 twice.
  const rows = [
    row("a", "pr1", { caught: 1, defects: 2 }),
    row("a", "pr1", { caught: 2, defects: 2 }, "pass"),
    row("a", "pr2", { caught: 0, defects: 1 }),
    row("a", "pr2", { caught: 0, defects: 1 }),
    row("b", "pr1", { caught: 2, defects: 2 }, "pass"),
  ];

  // Act
  const v = headlineValue(rows, "a", CAUGHT);

  // Assert
  assert.ok(v && v.kind === "share");
  assert.equal(v.numerator, 3);
  assert.equal(v.denominator, 6);
  assert.equal(v.value, 0.5);
  assert.equal(v.inputs, 2);
  const ci = wilson(0.5 * 2, 2)!;
  assert.equal(v.low, ci.low);
  assert.equal(v.high, ci.high);
});

test("a plain headline is the mean over inputs of each input's mean, with its t-interval", () => {
  const rows = [row("a", "c1", { defect_claims: 2 }), row("a", "c1", { defect_claims: 0 }), row("a", "c2", { defect_claims: 3 })];

  const v = headlineValue(rows, "a", { label: "Defect claims per clean PR", measure: "defect_claims" });

  assert.ok(v && v.kind === "mean");
  assert.equal(v.value, 2);
  assert.equal(v.inputs, 2);
  const ci = tInterval95([1, 3])!;
  assert.equal(v.low, ci.low);
  assert.equal(v.high, ci.high);
});

test("several measures are summed, so precision is matched over matched plus unmatched", () => {
  const rows = [row("a", "pr1", { matched_deterministic: 1, matched_llm: 1, unmatched_findings: 2 })];

  const v = headlineValue(rows, "a", {
    label: "Precision",
    measure: ["matched_deterministic", "matched_llm"],
    of: ["matched_deterministic", "matched_llm", "unmatched_findings"],
  });

  assert.ok(v && v.kind === "share");
  assert.equal(v.numerator, 2);
  assert.equal(v.denominator, 4);
});

test("a headline nobody reported, an ungraded trial, an input outside the slice and a zero denominator give no value", () => {
  const rows = [row("a", "pr1", { caught: 1, defects: 1 }, "evaluator_error"), row("a", "pr2", { caught: 0, defects: 0 }), row("a", "c1", { defect_claims: 1 })];

  assert.equal(headlineValue(rows, "a", CAUGHT), null, "nothing caught out of nothing is not 0%");
  assert.equal(headlineValue(rows, "a", { label: "x", measure: "absent" }), null);
  assert.equal(headlineValue(rows, "a", { label: "x", measure: "defect_claims" }, new Set(["pr2"])), null);
});

test("candidates are compared input by input with an exact sign test", () => {
  // Arrange — a beats b on six inputs and ties on one.
  const rows = [
    ...[1, 2, 3, 4, 5, 6].flatMap((i) => [row("a", `pr${i}`, { caught: 1, defects: 1 }, "pass"), row("b", `pr${i}`, { caught: 0, defects: 1 })]),
    row("a", "pr7", { caught: 1, defects: 1 }, "pass"),
    row("b", "pr7", { caught: 1, defects: 1 }, "pass"),
    row("c", "pr7", { caught: 1, defects: 1 }, "pass"),
  ];

  // Act
  const pairs = headlineDifferences(rows, ["a", "b", "c"], CAUGHT);

  // Assert
  const ab = pairs.find((p) => p.a === "a" && p.b === "b")!;
  assert.deepEqual([ab.a_better, ab.b_better, ab.same, ab.compared], [6, 0, 1, 7]);
  assert.equal(ab.significant, true);
  const ac = pairs.find((p) => p.a === "a" && p.b === "c")!;
  assert.deepEqual([ac.a_better, ac.b_better, ac.same, ac.significant], [0, 0, 1, false]);
  assert.equal(pairs.length, 3);
});

test("slices follow the declared groups in the declared order; the rest come last as Other", () => {
  const labels = {
    pr1: { tags: ["escaped", "logic", "high", "knowable", "lines:1-200"], split: "dev" },
    pr2: { tags: ["clean", "lines:1-200"] },
    pr3: { tags: ["escaped", "crash", "low", "not-knowable"] },
  };
  const groups = [
    { title: "Knowable", tags: ["knowable", "partly-knowable", "not-knowable"] },
    { title: "Severity", tags: ["critical", "high", "medium", "low"] },
  ];

  const out = sliceGroups(labels, groups);

  assert.deepEqual(
    out.map((g) => [g.title, g.slices.map((s) => s.label)]),
    [
      ["Knowable", ["knowable", "not-knowable"]],
      ["Severity", ["high", "low"]],
      ["Other", ["escaped", "logic", "lines:1-200", "clean", "crash", "split: dev"]],
    ],
  );
  assert.deepEqual([...out[0]!.slices[0]!.inputs], ["pr1"]);
  assert.deepEqual(sliceGroups(labels, undefined).map((g) => g.title), [null], "no groups declared: one untitled group, as before");
  assert.deepEqual(sliceGroups(null, groups), []);
});

test("a check's report is what the run froze, else what its kind leads with, else nothing", () => {
  const declared = { headline: [CAUGHT] };

  assert.equal(checkReportFor(declared, "findings-match-2+opts-abc"), declared);
  const builtIn = checkReportFor(undefined, "findings-match-2+opts-abc");
  assert.deepEqual(builtIn?.headline.map((h) => h.label), ["Knowable defects caught", "Defects caught", "Defect claims per clean item", "Precision on defect items", "Findings per review"]);
  // Category, severity and knowability are per defect, so they are the parts' groups, not the items'.
  assert.deepEqual(builtIn?.slice_groups?.map((g) => g.title), ["Source"]);
  assert.deepEqual(builtIn?.parts?.tag_groups?.map((g) => g.title), ["Could a reviewer have known", "Category", "Severity"]);
  assert.deepEqual(builtIn?.input_groups?.map((g) => g.tag), ["escaped", "seeded", "clean"]);
  assert.equal(checkReportFor(undefined, "command-abc"), null);
  assert.equal(checkReportFor(null, null), null);
});

/* ── the board and the scorecard that draws it ───────────────────────────── */

import { headlineBoard } from "../src/canon/headline.js";
import { renderScorecard } from "../src/report-scorecard.js";
import type { TrialRow } from "../src/canon/rows.js";

const LABELS = {
  pr1: { tags: ["escaped", "logic", "knowable"] },
  pr2: { tags: ["escaped", "crash", "not-knowable"] },
  c1: { tags: ["clean", "lines:1-200"] },
};
const REPORT = {
  headline: [
    { label: "Defects caught", measure: "caught", of: "defects", by_slice: true },
    { label: "Defect claims per clean item", measure: "defect_claims" },
  ],
  slice_groups: [{ title: "Could a reviewer have known", tags: ["knowable", "not-knowable"] }],
};
const BOARD_ROWS = ["a", "b"].flatMap((c) => [
  row(c, "pr1", { caught: c === "a" ? 1 : 0, defects: 1, findings: 3 }, c === "a" ? "pass" : "fail"),
  row(c, "pr2", { caught: 0, defects: 1, findings: 2 }),
  row(c, "c1", { defect_claims: 1, findings: 1 }),
]);

test("the board holds each headline for every candidate, its differences, and its slices where it asks for them", () => {
  const board = headlineBoard(REPORT, LABELS, BOARD_ROWS, ["a", "b"]);

  assert.equal(board.length, 2);
  const [caught, claims] = board;
  assert.equal(caught!.all.a?.kind === "share" && caught!.all.a.numerator, 1);
  assert.equal(caught!.all.b?.kind === "share" && caught!.all.b.denominator, 2);
  assert.equal(caught!.differences.length, 1);
  // Slices: only those where the headline was reported — the clean tags hold no defect.
  assert.deepEqual(
    caught!.groups.map((g) => [g.title, g.rows.map((r) => r.label)]),
    [
      ["Could a reviewer have known", ["knowable", "not-knowable"]],
      ["Other", ["escaped", "logic", "crash"]],
    ],
  );
  assert.equal(caught!.groups[0]!.rows[0]!.inputs, 1);
  assert.deepEqual(claims!.groups, [], "not asked for by slice");

  // A headline may be over one tag's inputs only; one no candidate has a value for is left out.
  const tagged = headlineBoard(
    { headline: [{ label: "Knowable caught", measure: "caught", of: "defects", tag: "knowable" }, { label: "Seeded caught", measure: "caught", of: "defects", tag: "seeded" }] },
    LABELS,
    BOARD_ROWS,
    ["a", "b"],
  );
  assert.deepEqual(tagged.map((h) => h.decl.label), ["Knowable caught"]);
  assert.equal(tagged[0]!.all.a?.kind === "share" && tagged[0]!.all.a.denominator, 1);
  assert.deepEqual([tagged[0]!.differences[0]!.compared, tagged[0]!.differences[0]!.a_better], [1, 1]);

  // Its slices stay inside the tag too: "escaped" holds pr1 and pr2, but only pr1 is knowable.
  const sliced = headlineBoard({ headline: [{ label: "Knowable caught", measure: "caught", of: "defects", tag: "knowable", by_slice: true }] }, LABELS, BOARD_ROWS, ["a", "b"]);
  const escaped = sliced[0]!.groups.flatMap((g) => g.rows).find((r) => r.label === "escaped")!;
  assert.equal(escaped.cells.a?.kind === "share" && escaped.cells.a.denominator, 1);
  assert.equal(sliced[0]!.groups.flatMap((g) => g.rows).some((r) => r.label === "crash"), false, "a slice with no tagged input is left out");
  assert.deepEqual(headlineBoard(null, LABELS, BOARD_ROWS, ["a", "b"]), []);
});

test("a scorecard with a check report leads with the headline numbers and drops the one-line dump of every measure", () => {
  // Act
  const html = renderScorecard(LABELS, BOARD_ROWS as unknown as TrialRow[], [], ["a", "b"], REPORT);

  // Assert — a column per headline, counts and a percentage for a share
  assert.match(html, /<th class="num wrap">Defects caught/);
  assert.match(html, /1\/2 · <b>50%<\/b>/);
  assert.match(html, /0\/2 · <b>0%<\/b>/);
  assert.match(html, /<b>1\.00<\/b>/);
  assert.doesNotMatch(html, /caught 0\.50 · defects/, "the dump of every measure is gone");
  // who differs, in words
  assert.match(html, /Defects caught: no difference shown/);
  assert.match(html, /an input with several tags is counted under each/);
  // grouped slices, the rest folded away
  assert.match(html, /Defects caught, by slice/);
  assert.ok(html.indexOf("Could a reviewer have known") < html.indexOf(">knowable<"));
  assert.match(html, /<details><summary>Other slices/);
});

test("a scorecard without a check report reads as before", () => {
  const html = renderScorecard(LABELS, BOARD_ROWS as unknown as TrialRow[], [], ["a", "b"], null);

  assert.match(html, /caught 0\.50 · defects 1\.00/);
  assert.doesNotMatch(html, /by slice/);
});

/* ── the per-input table, in the check's groups ──────────────────────────── */

import { inputComparison } from "../src/canon/input-compare.js";
import { renderInputComparison } from "../src/report-compare.js";
import { inputGroups } from "../src/canon/headline.js";

test("inputs are listed under the check's groups, each saying what a pass means there", () => {
  // Arrange — a pass is "every defect caught" on a defect item and "no defect claimed" on a clean one.
  const decl = [
    { tag: "escaped", title: "Escaped-defect items", pass: "every known defect caught" },
    { tag: "clean", title: "Clean items", pass: "no finding claims a defect" },
  ];
  const labels = { ...LABELS, odd: { tags: ["unlabelled"] } };
  const trials = [...BOARD_ROWS, row("a", "odd", { findings: 1 }, "pass")].map((r) => ({ ...r, completion_state: "success" })) as unknown as TrialRow[];

  // Act
  const groups = inputGroups(labels, decl);
  const html = renderInputComparison(inputComparison(trials, ["a", "b"]), ["a", "b"], [], undefined, groups);

  // Assert
  assert.deepEqual(groups.map((g) => [g.title, [...g.inputs]]), [["Escaped-defect items", ["pr1", "pr2"]], ["Clean items", ["c1"]]]);
  const escaped = html.indexOf("Escaped-defect items");
  const clean = html.indexOf("Clean items");
  const other = html.indexOf("Other inputs");
  assert.ok(escaped > 0 && escaped < clean && clean < other, "groups in declared order, the rest last");
  assert.match(html, /a pass: every known defect caught/);
  assert.match(html, /a pass: no finding claims a defect/);
  assert.ok(html.indexOf(">pr1<") < clean && html.indexOf(">c1<") > clean && html.indexOf(">odd<") > other);
  assert.deepEqual(inputGroups(null, decl), []);
  assert.doesNotMatch(renderInputComparison(inputComparison(trials, ["a", "b"]), ["a", "b"], []), /Other inputs/, "no groups: one table, as before");
});
