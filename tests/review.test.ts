/**
 * Human review, the pure part: which pairs a reviewer sees, how they are
 * blinded, how a verdict becomes evidence, and how it is read back against
 * the judge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { EvaluationRow, TrialRow } from "../src/canon/rows.js";
import {
  blindLayout,
  humanRecord,
  judgeAgreement,
  latestVerdicts,
  matchesShow,
  pairId,
  reviewQueue,
  verdictRow,
  type ReviewEntry,
} from "../src/canon/review.js";

function trial(candidate: string, input: string, t: number, ok: boolean, check: "pass" | "fail" = "pass"): TrialRow {
  return {
    run: "r1", step: "detail", candidate, model_ref: candidate, deployment_ref: null, input, trial: t, trial_hash: `${candidate}${input}${t}`,
    completion_state: ok ? "success" : "malformed", truncated: false,
    task_outcome: ok && check === "pass" ? "success" : "failure", outcome_reasons: [], rule_version: "v",
    checks: { gate: { state: check, version: "v" } }, judge: { pairwise: null, absolute_overall: null, absolute_dimensions: null },
    cost: { generation: 0, source: "none" }, tokens: { prompt: 0, completion: 0, cached: null }, ms: 1, ttft_ms: null, cache: null,
    finish_reason: "stop", isolation: null, error: null, legacy_status: ok ? "ok" : "error", legacy_check_passed: check === "pass", reused_from: null,
  };
}

const TRIALS = [
  trial("opus", "todo", 0, true), trial("sonnet", "todo", 0, true), trial("haiku", "todo", 0, true),
  trial("opus", "chess", 0, true), trial("sonnet", "chess", 0, true, "fail"), trial("haiku", "chess", 0, false),
];

test("the queue pairs every two candidates per input that both passed their check, in canonical order", () => {
  const q = reviewQueue(TRIALS);

  // chess: sonnet failed its check and haiku produced nothing, so opus has no partner.
  assert.deepEqual(q.map((i) => `${i.input}:${i.a}|${i.b}`), ["todo:haiku|opus", "todo:haiku|sonnet", "todo:opus|sonnet"]);
});

test("failed-check pairs come back on request, but a trial that produced nothing never does", () => {
  const q = reviewQueue(TRIALS, { includeFailed: true });

  assert.ok(q.some((i) => i.input === "chess" && i.a === "opus" && i.b === "sonnet"));
  assert.ok(!q.some((i) => i.input === "chess" && (i.a === "haiku" || i.b === "haiku")));
});

test("the first completed trial per candidate is the one reviewed, the same pairing the judge uses", () => {
  const q = reviewQueue([trial("opus", "todo", 0, false), trial("opus", "todo", 1, true), trial("sonnet", "todo", 0, true)]);

  assert.equal(q.length, 1);
  assert.deepEqual([q[0].trialA, q[0].trialB], [1, 0]);
});

test("a pair id names no candidate, and is stable", () => {
  const [item] = reviewQueue(TRIALS);

  const id = pairId("r1", item);

  assert.equal(id, pairId("r1", item));
  assert.doesNotMatch(id, /opus|sonnet|haiku|todo/);
});

test("the blind layout is fixed per reviewer and pair, and differs across them", () => {
  const items = reviewQueue(TRIALS);

  const one = items.map((i) => blindLayout("r1", "xing", i).left);
  const again = items.map((i) => blindLayout("r1", "xing", i).left);
  const sides = new Set(Array.from({ length: 40 }, (_, k) => blindLayout("r1", `reviewer-${k}`, items[0]).left));

  assert.deepEqual(one, again);
  assert.deepEqual([...sides].sort(), ["a", "b"]);
});

test("a verdict given on the screen's left/right lands on the right candidate", () => {
  const [item] = reviewQueue(TRIALS);
  const layout = blindLayout("r1", "xing", item);
  const leftCandidate = layout.left === "a" ? item.a : item.b;

  const row = verdictRow({ run: "r1", step: "detail", rubricSha: "abc", reviewer: "xing", item, layout, overall: "left", dimensions: { coverage: "right" }, note: "tighter" });

  assert.equal(row.evaluator, "human-pairwise");
  assert.equal(row.version, "rubric-abc");
  assert.deepEqual(row.subject, { kind: "pair", a: item.a, b: item.b, input: item.input });
  assert.equal(row.overall === "a" ? item.a : item.b, leftCandidate);
  assert.notEqual(row.dimensions?.coverage === "a" ? item.a : item.b, leftCandidate);
  assert.deepEqual(row.shown_as, { left: leftCandidate });
  assert.equal(row.evidence, "tighter");
});

test("re-judging a pair keeps the history and the latest verdict wins", () => {
  const [item] = reviewQueue(TRIALS);
  const layout = blindLayout("r1", "xing", item);
  const first = verdictRow({ run: "r1", step: "s", rubricSha: "x", reviewer: "xing", item, layout, overall: "left" });
  const second = verdictRow({ run: "r1", step: "s", rubricSha: "x", reviewer: "xing", item, layout, overall: "tie" });
  const entries: ReviewEntry[] = [first, second];

  const latest = latestVerdicts(entries);

  assert.equal(latest.length, 1);
  assert.equal(latest[0].overall, "tie");
});

test("a candidate's human record counts wins, losses and ties, both_bad as no preference", () => {
  const rows = [
    { a: "haiku", b: "opus", overall: "b" }, { a: "opus", b: "sonnet", overall: "a" },
    { a: "haiku", b: "sonnet", overall: "both_bad" }, { a: "opus", b: "sonnet", overall: "tie" },
  ].map((r, i) => ({ evaluator: "human-pairwise", subject: { kind: "pair" as const, a: r.a, b: r.b, input: `in${i}` }, overall: r.overall }) as unknown as EvaluationRow);

  assert.deepEqual(humanRecord("opus", rows), { wins: 2, losses: 0, ties: 1, comparisons: 3, rate: (2 + 0.5) / 3 * 100 });
  assert.deepEqual(humanRecord("haiku", rows), { wins: 0, losses: 1, ties: 1, comparisons: 2, rate: 25 });
});

test("agreement with the judge reads pairs in either orientation, per dimension", () => {
  const human = [
    { a: "opus", b: "sonnet", input: "todo", overall: "a", dimensions: { coverage: "a", size: "tie" } },
    { a: "haiku", b: "opus", input: "todo", overall: "b", dimensions: { coverage: "a" } },
  ].map((r) => ({ evaluator: "human-pairwise", state: "pass", subject: { kind: "pair", a: r.a, b: r.b, input: r.input }, overall: r.overall, dimensions: r.dimensions }) as unknown as EvaluationRow);
  const judge = [
    // stored the other way round: sonnet as a. Judge prefers opus → "b".
    { a: "sonnet", b: "opus", input: "todo", overall: "b", dimensions: { coverage: "b", size: "a" } },
    { a: "haiku", b: "opus", input: "todo", overall: "a", dimensions: { coverage: "a" } },
    { a: "haiku", b: "sonnet", input: "todo", overall: "a", dimensions: {} },
  ].map((r) => ({ evaluator: "pairwise-swap", state: "pass", subject: { kind: "pair", a: r.a, b: r.b, input: r.input }, overall: r.overall, dimensions: r.dimensions }) as unknown as EvaluationRow);

  const agreement = judgeAgreement(human, judge);

  assert.deepEqual(agreement.overall, { agree: 1, total: 2 });
  assert.deepEqual(agreement.dimensions.coverage, { agree: 2, total: 2 });
  assert.deepEqual(agreement.dimensions.size, { agree: 0, total: 1 });
});

test("show globs: * and ? stay in a segment, ** crosses them", () => {
  const cases: Array<[string, string, boolean]> = [
    [".ab/tasks.json", ".ab/tasks.json", true], ["UI_CONTRACT.md", "*.md", true], ["docs/PRD.md", "*.md", false],
    ["docs/PRD.md", "**/*.md", true], ["PRD.md", "**/*.md", true], ["a/b/c.ts", "a/**", true],
    ["x.json", "?.json", true], ["xy.json", "?.json", false], ["ab", "a.b", false],
  ];

  for (const [file, glob, want] of cases) assert.equal(matchesShow(file, [glob]), want, `${file} ~ ${glob}`);
});
