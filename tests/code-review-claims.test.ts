/**
 * The noisiest false alarms of a code review (PRD §6): on clean items, which
 * findings the matcher counted as a defect claim, read from the decision
 * record each trial left (findings-match.json), ranked by item.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claimBoard, claimsOfRecord, loadDefectClaims, renderClaims } from "../src/code-review/claims.js";
import type { TrialRow } from "../src/canon/rows.js";

const RECORD = {
  version: "findings-match-3+opts-abc",
  kind: "clean",
  findings: [
    { file: "src/a.ts", start_line: 3, end_line: 5, message: "this drops the last row" },
    { file: "src/a.ts", start_line: 9, end_line: 9, message: "nit: rename" },
    { message: "the migration can lose data" },
    { file: "src/b.ts", start_line: 1, end_line: 1, message: "blocking by flag", blocking: true },
  ],
  bases: ["llm-claim", "llm-no-claim", "llm-claim", "blocking"],
  claims: 3,
};

test("a clean item's claims are the findings its record counts as claiming a defect, with where and what", () => {
  assert.deepEqual(claimsOfRecord(RECORD), [
    { where: "src/a.ts:3-5", message: "this drops the last row", basis: "llm-claim" },
    { where: "PR-level", message: "the migration can lose data", basis: "llm-claim" },
    { where: "src/b.ts:1", message: "blocking by flag", basis: "blocking" },
  ]);
  assert.deepEqual(claimsOfRecord({ ...RECORD, kind: "defect" }), [], "a defect item has no clean claims");
  assert.deepEqual(claimsOfRecord({ kind: "clean" }), [], "a record without findings gives none, never a throw");
  assert.deepEqual(claimsOfRecord("nonsense"), []);
});

const trial = (candidate: string, input: string, n: number, version = "findings-match-3+opts-abc"): TrialRow =>
  ({ candidate, input, trial: n, checks: { caught: { state: "fail", version } } }) as unknown as TrialRow;

async function runWith(records: Record<string, unknown>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cr-claims-"));
  for (const [name, record] of Object.entries(records)) {
    await fs.mkdir(path.join(dir, "checks", name), { recursive: true });
    await fs.writeFile(path.join(dir, "checks", name, "findings-match.json"), typeof record === "string" ? record : JSON.stringify(record));
  }
  return dir;
}

test("claims are loaded per trial from the run's checks/, and only for a findings-match check", async () => {
  const dir = await runWith({ "a__c1__t0": RECORD, "a__c1__t1": "{not json", "b__c1__t0": { ...RECORD, bases: ["llm-no-claim", "llm-no-claim", "llm-no-claim", "not-blocking"] } });

  const claims = await loadDefectClaims(dir, [trial("a", "c1", 0), trial("a", "c1", 1), trial("a", "c2", 0), trial("b", "c1", 0)]);

  assert.deepEqual(claims.map((c) => [c.candidate, c.input, c.trial, c.where]), [["a", "c1", 0, "src/a.ts:3-5"], ["a", "c1", 0, "PR-level"], ["a", "c1", 0, "src/b.ts:1"]]);
  assert.deepEqual(await loadDefectClaims(dir, [trial("a", "c1", 0, "command-1")]), [], "another kind of check: nothing is read");

  // A trial reused with its check unchanged has no checks/ of its own: its record is in the run it was reused from.
  const later = path.join(path.dirname(dir), `${path.basename(dir)}-later`);
  await fs.mkdir(later);
  const reused = { ...trial("a", "c1", 0), reused_from: `tasks/demo/runs/${path.basename(dir)}` } as TrialRow;
  assert.equal((await loadDefectClaims(later, [reused])).length, 3);
});

test("the board ranks clean items by how many claims they drew, and the section lists what was said", async () => {
  const claims = [
    { candidate: "a", input: "c1", trial: 0, where: "src/a.ts:3-5", message: "this drops <the> last row", basis: "llm-claim" as const },
    { candidate: "a", input: "c2", trial: 0, where: "PR-level", message: "x".repeat(900), basis: "llm-claim" as const },
    { candidate: "b", input: "c2", trial: 1, where: "src/b.ts:1", message: "second", basis: "blocking" as const },
  ];

  const board = claimBoard(claims, ["a", "b"]);

  assert.deepEqual(board.map((r) => [r.input, r.total, r.counts]), [["c2", 2, { a: 1, b: 1 }], ["c1", 1, { a: 1, b: 0 }]]);
  const html = renderClaims(board, ["a", "b"]);
  assert.match(html, /<h2>Defect claims on clean items/);
  assert.ok(html.indexOf(">c2<") < html.indexOf(">c1<"), "noisiest first");
  assert.match(html, /this drops &lt;the&gt; last row/);
  assert.match(html, /a · t0 · src\/a\.ts:3-5/);
  assert.doesNotMatch(html, /x{700}/, "a long comment is cut");
  assert.equal(renderClaims([], ["a"]), "");
});
