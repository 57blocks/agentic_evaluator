/**
 * A check may report its verdict in parts: named things it looked for on
 * this trial, each passed or not (`{"parts": [{"id": "D1", "pass": true}]}`)
 * — the known defects of a PR, the fields of a form. They are descriptive,
 * as measures are, and let the report show each part across candidates and
 * a pass rate per part tag, where an input's tags would count an input's
 * every part under each of them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommandCheck } from "../src/check.js";
import { MAX_PARTS, partBoard, partsOf } from "../src/canon/parts.js";
import { renderParts } from "../src/report-parts.js";
import { wilson } from "../src/canon/stats.js";
import type { TrialRow } from "../src/canon/rows.js";

test("parts are kept as id and pass, with a label and tags when given; anything else is dropped", () => {
  const kept = partsOf([
    { id: "D1", pass: true, label: "src/tax.ts:40 rate applied twice", tags: ["calculation", "high", 3] },
    { id: "D2", pass: false },
    { id: "", pass: true },
    { id: "D3", pass: "yes" },
    { id: "D1", pass: false },
    "D4",
  ]);

  assert.deepEqual(kept, [{ id: "D1", pass: true, label: "src/tax.ts:40 rate applied twice", tags: ["calculation", "high"] }, { id: "D2", pass: false }]);
  assert.equal(partsOf({ id: "D1" }), undefined, "not a list");
  assert.equal(partsOf([]), undefined);
  assert.equal(partsOf(Array.from({ length: MAX_PARTS + 5 }, (_, i) => ({ id: `p${i}`, pass: true })))?.length, MAX_PARTS);
  assert.equal(partsOf([{ id: "x", pass: true, label: "l".repeat(500) }])?.[0]?.label?.length, 200);
});

test("a command check's parts on stdout are kept with the result", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-check-parts-"));
  try {
    const r = await runCommandCheck({
      argv: [process.execPath, "-e", `console.log(JSON.stringify({ evidence: "1 of 2", parts: [{ id: "cause", pass: true }, { id: "deadline", pass: false, tags: ["hard"] }] })); process.exit(1)`],
      versionFiles: [],
      timeoutMs: 20_000,
      files: [],
      output: "the deliverable",
      input: "the input",
      meta: { step: "s", candidate: "c", input: "i", trial: 0 },
      workDir: dir,
      taskRoot: process.cwd(),
    });
    assert.equal(r.state, "fail");
    assert.deepEqual(r.parts, [{ id: "cause", pass: true }, { id: "deadline", pass: false, tags: ["hard"] }]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const row = (candidate: string, input: string, trial: number, parts: unknown, state = "fail"): TrialRow =>
  ({ candidate, input, trial, checks: { caught: { state, parts } } }) as unknown as TrialRow;

const D = (id: string, pass: boolean, tags: string[]) => ({ id, pass, label: `${id} label`, tags });

/** pr1 holds a knowable logic defect and a not-knowable crash; pr2 one knowable crash. */
const ROWS = [
  row("a", "pr1", 0, [D("D1", true, ["logic", "knowable"]), D("D2", false, ["crash", "not-knowable"])]),
  row("a", "pr1", 1, [D("D1", false, ["logic", "knowable"]), D("D2", false, ["crash", "not-knowable"])]),
  row("a", "pr2", 0, [D("D1", true, ["crash", "knowable"])], "pass"),
  row("b", "pr1", 0, [D("D1", false, ["logic", "knowable"]), D("D2", false, ["crash", "not-knowable"])]),
  row("b", "pr2", 0, [D("D1", true, ["crash", "knowable"])], "evaluator_error"),
  row("b", "c1", 0, undefined, "pass"),
];
const DECL = { title: "Every known defect", tag_groups: [{ title: "Known", tags: ["knowable", "not-knowable"] }, { title: "Category", tags: ["logic", "crash"] }] };

test("the board lists every part with each candidate's passes over graded trials, and a pass rate per part tag", () => {
  const board = partBoard(DECL, ROWS, ["a", "b"]);

  assert.ok(board);
  // Knowable parts first (the first group's order), the most often passed on top.
  assert.deepEqual(board.rows.map((r) => `${r.input} ${r.id}`), ["pr2 D1", "pr1 D1", "pr1 D2"]);
  const first = board.rows[1]!;
  assert.deepEqual(first.cells, { a: { pass: 1, graded: 2 }, b: { pass: 0, graded: 1 } });
  assert.equal(first.label, "D1 label");
  assert.deepEqual(board.rows[0]!.cells.b, { pass: 0, graded: 0 }, "an ungraded trial is not a miss");

  // Per tag, a part counts once under its own tags: crash is pr1 D2 and pr2 D1, not pr1 D1.
  assert.deepEqual(board.groups.map((g) => [g.title, g.rows.map((r) => r.label)]), [["Known", ["knowable", "not-knowable"]], ["Category", ["logic", "crash"]]]);
  const crash = board.groups[1]!.rows[1]!;
  assert.equal(crash.parts, 2);
  const a = crash.cells.a!;
  assert.deepEqual([a.kind === "share" && a.numerator, a.kind === "share" && a.denominator, a.inputs], [1, 3, 2]);
  const ci = wilson((1 / 3) * 2, 2)!;
  assert.deepEqual([a.low, a.high], [ci.low, ci.high]);
  assert.equal(board.groups[0]!.rows[0]!.cells.b?.kind === "share" && board.groups[0]!.rows[0]!.cells.b.denominator, 1);

  assert.equal(partBoard(DECL, [row("a", "c1", 0, undefined)], ["a"]), null, "no part reported: no board");
  assert.ok(partBoard(undefined, ROWS, ["a", "b"]), "a check that reports parts gets the grid without declaring anything");
});

test("the parts section draws the grid and the per-tag rates", () => {
  const html = renderParts(partBoard(DECL, ROWS, ["a", "b"]), ["a", "b"]);

  assert.match(html, /<h2>Every known defect/);
  assert.match(html, /pr1<\/td><td>D1 label/);
  assert.match(html, /<span class="pill warn">1\/2<\/span>/);
  assert.match(html, /<span class="pill miss">0\/1<\/span>/);
  assert.match(html, /1\/3 · <b>33%<\/b>/);
  assert.equal(renderParts(null, ["a"]), "");
});
