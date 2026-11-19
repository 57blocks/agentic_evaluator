/**
 * The per-input comparison in one run: a row per input, a column per
 * candidate, each cell the required check's passes k/n and the measures'
 * per-input means. Inputs where the candidates differ come first; each row
 * opens to that input's trials with what the check said.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { inputComparison } from "../src/canon/input-compare.js";
import { renderInputComparison } from "../src/report-compare.js";
import { loadBundle, renderRunReport } from "../src/report-v2.js";
import { INSTALL_ROOT } from "../src/paths.js";
import type { TrialRow } from "../src/canon/rows.js";

function row(candidate: string, input: string, trial: number, state: string, extra: { reason?: string; evidence?: string; measures?: Record<string, number>; completion?: string } = {}): TrialRow {
  return {
    candidate,
    input,
    trial,
    completion_state: extra.completion ?? "success",
    task_outcome: state === "pass" ? "success" : state === "fail" ? "failure" : "undetermined",
    checks: {
      caught: {
        state,
        version: "v1",
        ...(extra.evidence ? { evidence: extra.evidence } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
        ...(extra.measures ? { measures: extra.measures } : {}),
      },
    },
    judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0.1, source: "estimated" },
    ms: 1000,
    reused_from: null,
  } as unknown as TrialRow;
}

const TRIALS = [
  // a: everyone fails — the same for all candidates
  row("v0", "a", 0, "fail"), row("v0", "a", 1, "fail"), row("head", "a", 0, "fail"), row("head", "a", 1, "fail"),
  // b: v0 catches it once, head never
  row("v0", "b", 0, "pass", { reason: "names the Mayotte floor", measures: { comments: 3 } }),
  row("v0", "b", 1, "fail", { reason: "no comment on the file", measures: { comments: 1 } }),
  row("head", "b", 0, "fail", { evidence: "0 comment(s)", measures: { comments: 0 } }),
  row("head", "b", 1, "evaluator_error", { reason: "judge timed out" }),
  // c: both catch it every time
  row("v0", "c", 0, "pass"), row("head", "c", 0, "pass"),
];

test("rows where the candidates differ come first; the rest keep input order", () => {
  const rows = inputComparison(TRIALS, ["v0", "head"]);
  assert.deepEqual(rows.map((r) => r.input), ["b", "a", "c"]);
  assert.deepEqual(rows.map((r) => r.differs), [true, false, false]);
});

test("a cell counts graded trials only, and averages each measure over the input's graded trials", () => {
  const b = inputComparison(TRIALS, ["v0", "head"]).find((r) => r.input === "b")!;
  const [v0, head] = b.cells;
  assert.deepEqual([v0!.pass, v0!.graded, v0!.trials.length], [1, 2, 2]);
  assert.deepEqual(v0!.measures, { comments: 2 });
  assert.deepEqual([head!.pass, head!.graded, head!.trials.length], [0, 1, 2], "the evaluator error is listed but not graded");
  assert.deepEqual(head!.measures, { comments: 0 });
});

test("each trial says what the check said: state, reason and evidence", () => {
  const b = inputComparison(TRIALS, ["v0", "head"]).find((r) => r.input === "b")!;
  const [v0, head] = b.cells;
  assert.match(v0!.trials[0]!.summary, /pass — names the Mayotte floor/);
  assert.equal(head!.trials[0]!.checks[0]!.evidence, "0 comment(s)");
  assert.match(head!.trials[1]!.summary, /evaluator_error — judge timed out/);
});

test("a candidate with no trial on an input has an empty cell, and does not make the row differ", () => {
  const rows = inputComparison([row("v0", "x", 0, "pass")], ["v0", "head"]);
  assert.equal(rows[0]!.differs, false);
  assert.equal(rows[0]!.cells[1]!.trials.length, 0);
});

test("the comparison renders one expandable row per input, escaped, with the deliverable's opening", () => {
  // Arrange
  const trials = [...TRIALS, row("v0", "<script>", 0, "pass", { reason: "<b>bold</b>" }), row("head", "<script>", 0, "fail")];
  const outputs = [{ candidate: "v0", input: "b", trial: 0, text: "The Mayotte floor is switched off.", totalChars: 34 }];

  // Act
  const html = renderInputComparison(inputComparison(trials, ["v0", "head"]), ["v0", "head"], outputs);

  // Assert
  assert.match(html, /Per input/);
  assert.equal((html.match(/<details class="cmp-row/g) ?? []).length, 4);
  assert.match(html, /2 of 4 inputs/);
  assert.match(html, /1\/2/);
  assert.match(html, /comments 2\.00/);
  assert.match(html, /The Mayotte floor is switched off\./);
  assert.doesNotMatch(html, /<script>|<b>bold<\/b>/);
});

test("no trials, no section", () => {
  assert.equal(renderInputComparison([], ["v0"], []), "");
});

test("a run's report carries the per-input comparison", async () => {
  const bundle = await loadBundle(path.join(INSTALL_ROOT, "fixtures", "prd-w38"));
  const html = renderRunReport(bundle);
  assert.match(html, /Per input/);
  assert.match(html, /<details class="cmp-row/);
});
