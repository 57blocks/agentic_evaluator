/**
 * kind: findings-match — a code review's findings.json paired with the
 * item's known defects by file, line overlap and (optionally) category; an
 * LLM only for ambiguous locations and unflagged claims, stubbed here.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runFindingsMatchCheck, DECISIONS_FILE, type FindingsMatchConfig } from "../src/code-review/findings-match.js";
import { findingsMatchVersion } from "../src/code-review/version.js";
import { findingsPrecision, normalizePath, oracleFindings, parseExpected, parseFindings } from "../src/code-review/findings.js";
import { linesOverlap, type Ask } from "../src/code-review/match.js";
import type { CheckResult } from "../src/check.js";
import type { MeasureStats } from "../src/canon/measures.js";

const CHECK: FindingsMatchConfig = { id: "caught", kind: "findings-match", lineTolerance: 3, requireCategory: false };
const WITH_LLM: FindingsMatchConfig = { ...CHECK, llmFallback: { model: "google/gemini-3.1-pro-preview", endpoint: { route: "openrouter" } } };

const DEFECT = { file: "src/tax.ts", start_line: 40, end_line: 42, category: "calculation", severity: "high", description: "The rate is applied twice." };
const DEFECT_ITEM = { kind: "defect", source: "escaped", defects: [DEFECT] };
const CLEAN_ITEM = { kind: "clean", note: "no later fix" };

/** An Ask that must not be reached. */
const NEVER: Ask = async () => {
  throw new Error("the LLM was called");
};

/** An Ask that answers with each reply in turn, recording the prompts it got. */
function stub(...replies: Array<string | Error>): Ask & { calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = [];
  const ask = (async (system: string, user: string) => {
    calls.push({ system, user });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (r instanceof Error) throw r;
    return r;
  }) as Ask & { calls: typeof calls };
  ask.calls = calls;
  return ask;
}

async function grade(opts: {
  expected?: unknown;
  /** Written verbatim when a string; JSON otherwise; absent: no findings.json. */
  findings?: unknown;
  check?: FindingsMatchConfig;
  ask?: Ask;
  input?: string;
}): Promise<CheckResult & { decisions?: unknown; workText: string }> {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "eval-fm-task-"));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "eval-fm-work-"));
  const input = opts.input ?? "pr1";
  try {
    if (opts.expected !== undefined) {
      await fs.mkdir(path.join(task, "references"), { recursive: true });
      const text = typeof opts.expected === "string" ? opts.expected : `${JSON.stringify(opts.expected, null, 2)}\n`;
      await fs.writeFile(path.join(task, "references", `${input}.txt`), text);
    }
    if (opts.findings !== undefined) {
      await fs.writeFile(path.join(work, "findings.json"), typeof opts.findings === "string" ? opts.findings : JSON.stringify(opts.findings));
    }
    const result = await runFindingsMatchCheck({ check: opts.check ?? CHECK, files: [], workDir: work, taskRoot: task, step: "review", input, ...(opts.ask ? { ask: opts.ask } : {}) });
    const decisions = await fs.readFile(path.join(work, DECISIONS_FILE), "utf-8").then((t) => JSON.parse(t) as unknown, () => undefined);
    const names = await fs.readdir(work);
    const workText = (await Promise.all(names.map((n) => fs.readFile(path.join(work, n), "utf-8")))).join("\n");
    return { ...result, workText, ...(decisions === undefined ? {} : { decisions }) };
  } finally {
    await fs.rm(task, { recursive: true, force: true });
    await fs.rm(work, { recursive: true, force: true });
  }
}

const finding = (over: Record<string, unknown> = {}) => ({ file: "src/tax.ts", start_line: 41, message: "rate applied twice here", blocking: true, ...over });

/* ── location ────────────────────────────────────────────────────────────── */

test("a finding whose lines overlap the defect's catches it deterministically", async () => {
  const r = await grade({ expected: DEFECT_ITEM, findings: [finding()], ask: NEVER, check: WITH_LLM });
  assert.equal(r.state, "pass");
  assert.match(r.output, /caught deterministically by #1/);
  assert.deepEqual(r.measures, { findings: 1, invalid_findings: 0, defects: 1, caught: 1, matched_deterministic: 1, matched_llm: 0, unmatched_findings: 0 });
});

test("line tolerance widens the defect's range on both sides, and no further", () => {
  const d = { ...DEFECT, start_line: 40, end_line: 42 };
  const at = (start_line: number, end_line = start_line) => ({ message: "m", file: d.file, start_line, end_line });
  assert.equal(linesOverlap(at(45), d, 3), true);
  assert.equal(linesOverlap(at(46), d, 3), false);
  assert.equal(linesOverlap(at(37), d, 3), true);
  assert.equal(linesOverlap(at(36), d, 3), false);
  assert.equal(linesOverlap(at(30, 50), d, 0), true, "a finding spanning the defect overlaps it");
  assert.equal(linesOverlap(at(43), d, 0), false);
  assert.equal(linesOverlap(at(42), d, 0), true);
});

test("a finding on the defect's file but off its lines is ambiguous: without a fallback it misses, and says so", async () => {
  const r = await grade({ expected: DEFECT_ITEM, findings: [finding({ start_line: 80 })] });
  assert.equal(r.state, "fail");
  assert.equal(r.reason, "missed the defect");
  assert.match(r.output, /1 ambiguous finding \(#1\) not judged: no llm_fallback/);
  assert.equal(r.measures?.unmatched_findings, 1);
});

test("an ambiguous finding goes to the fallback, and a match it makes is recorded as the LLM's", async () => {
  const ask = stub('{"matches": [{"finding": 1, "defect": 1}], "reason": "same double rate"}');
  const r = await grade({ expected: DEFECT_ITEM, findings: [finding({ start_line: 80 })], check: WITH_LLM, ask });
  assert.equal(r.state, "pass");
  assert.equal(ask.calls.length, 1);
  assert.match(ask.calls[0]!.user, /D1 src\/tax\.ts:40-42 \[calculation, high\]\nThe rate is applied twice\./);
  assert.match(ask.calls[0]!.user, /#1 src\/tax\.ts:80/);
  assert.match(r.output, /caught by the LLM \(google\/gemini-3\.1-pro-preview\) by #1/);
  assert.equal(r.measures?.matched_llm, 1);
  assert.equal(r.measures?.matched_deterministic, 0);
});

test("a PR-level finding (no file) is ambiguous; the fallback may match it, or not", async () => {
  const global = { message: "the CSG base abatement is applied twice", blocking: true };
  const yes = await grade({ expected: DEFECT_ITEM, findings: [global], check: WITH_LLM, ask: stub('{"matches":[{"finding":"#1","defect":"D1"}],"reason":"r"}') });
  assert.equal(yes.state, "pass");
  const no = await grade({ expected: DEFECT_ITEM, findings: [global], check: WITH_LLM, ask: stub('{"matches":[],"reason":"different issue"}') });
  assert.equal(no.state, "fail");
  assert.match(no.output, /unmatched: #1 \(PR-level\)/);
});

test("a finding on another file never matches and never reaches the fallback", async () => {
  const r = await grade({ expected: DEFECT_ITEM, findings: [finding({ file: "src/other.ts" })], check: WITH_LLM, ask: NEVER });
  assert.equal(r.state, "fail");
  assert.equal(r.measures?.unmatched_findings, 1);
});

test("the fallback is asked only about ambiguous pairs, and a match it names outside them is ignored", async () => {
  const ask = stub('{"matches":[{"finding":1,"defect":1},{"finding":2,"defect":1}],"reason":"r"}');
  const r = await grade({
    expected: DEFECT_ITEM,
    findings: [finding({ file: "src/other.ts" }), finding({ start_line: 90 })],
    check: WITH_LLM,
    ask,
  });
  assert.doesNotMatch(ask.calls[0]!.user, /#1 /, "the other-file finding was not shown");
  assert.equal(r.state, "pass");
  assert.equal(r.measures?.matched_llm, 1);
  assert.equal(r.measures?.unmatched_findings, 1);
});

test("no fallback call when every finding and every defect is already matched on location", async () => {
  const two = { kind: "defect", defects: [DEFECT, { ...DEFECT, start_line: 80, end_line: 80, description: "wrong cap" }] };
  // Each finding is off the other defect's lines (ambiguous there), but both sides are matched already.
  const r = await grade({ expected: two, findings: [finding(), finding({ start_line: 80 })], check: WITH_LLM, ask: NEVER });
  assert.equal(r.state, "pass");
  assert.equal(r.measures?.matched_deterministic, 2);
});

test("a finding matched on location is still offered for a defect it did not catch", async () => {
  const two = { kind: "defect", defects: [DEFECT, { ...DEFECT, start_line: 80, end_line: 80, description: "wrong cap" }] };
  const ask = stub('{"matches":[{"finding":1,"defect":2}],"reason":"r"}');
  const r = await grade({ expected: two, findings: [finding()], check: WITH_LLM, ask });
  assert.equal(ask.calls.length, 1);
  assert.equal(r.state, "pass");
  assert.match(r.output, /D2 src\/tax\.ts:80 \[calculation, high\]: caught by the LLM/);
  assert.equal(r.measures?.matched_deterministic, 1, "a finding counts once, deterministic first");
  assert.equal(r.measures?.matched_llm, 0);
});

test("paths are compared after NFC and without a leading ./", async () => {
  const nfc = "modele-ti/règles/cotisations.publicodes";
  const nfd = `./${nfc.normalize("NFD")}`;
  assert.notEqual(nfd.slice(2), nfc);
  assert.equal(normalizePath(nfd), nfc);
  const r = await grade({ expected: { kind: "defect", defects: [{ ...DEFECT, file: nfc }] }, findings: [finding({ file: nfd })] });
  assert.equal(r.state, "pass");
});

/* ── category ────────────────────────────────────────────────────────────── */

test("category is ignored by default; with require_category it must agree, case aside", async () => {
  const off = await grade({ expected: DEFECT_ITEM, findings: [finding({ category: "style" })] });
  assert.equal(off.state, "pass");
  const strict = { ...CHECK, requireCategory: true };
  const wrong = await grade({ expected: DEFECT_ITEM, findings: [finding({ category: "style" })], check: strict });
  assert.equal(wrong.state, "fail");
  const missing = await grade({ expected: DEFECT_ITEM, findings: [finding()], check: strict });
  assert.equal(missing.state, "fail", "no category does not agree with one");
  const right = await grade({ expected: DEFECT_ITEM, findings: [finding({ category: "Calculation" })], check: strict });
  assert.equal(right.state, "pass");
});

/* ── several defects, precision ──────────────────────────────────────────── */

test("an item passes only when every defect is caught; a partial catch says so", async () => {
  const two = { kind: "defect", defects: [DEFECT, { ...DEFECT, file: "src/pay.ts", start_line: 10, end_line: 10, description: "off by one" }] };
  const r = await grade({ expected: two, findings: [finding(), finding({ file: "src/style.ts", blocking: false })] });
  assert.equal(r.state, "fail");
  assert.equal(r.reason, "caught 1 of 2 defects (partial)");
  assert.match(r.output, /D2 src\/pay\.ts:10 \[calculation, high\]: missed/);
  assert.deepEqual(r.measures, { findings: 2, invalid_findings: 0, defects: 2, caught: 1, matched_deterministic: 1, matched_llm: 0, unmatched_findings: 1 });
});

test("precision is matched findings over all findings on defect items, from the measure means", () => {
  const s = (mean: number) => ({ mean, n: 4, trials: 12, low: null, high: null });
  const m: MeasureStats = { findings: s(5), matched_deterministic: s(1.5), matched_llm: s(0.5), unmatched_findings: s(2) };
  assert.equal(findingsPrecision(m), 0.5);
  assert.equal(findingsPrecision({ findings: s(2), defect_claims: s(1) }), null, "clean items alone have no precision");
  assert.equal(findingsPrecision({ matched_deterministic: s(0), matched_llm: s(0), unmatched_findings: s(0) }), null);
});

/* ── clean items ─────────────────────────────────────────────────────────── */

test("a clean item passes with no blocking finding and fails on one", async () => {
  const pass = await grade({ expected: CLEAN_ITEM, findings: [finding({ blocking: false })], ask: NEVER, check: WITH_LLM });
  assert.equal(pass.state, "pass");
  assert.deepEqual(pass.measures, { findings: 1, invalid_findings: 0, defect_claims: 0 });
  const fail = await grade({ expected: CLEAN_ITEM, findings: [finding(), finding({ blocking: false })], ask: NEVER, check: WITH_LLM });
  assert.equal(fail.state, "fail");
  assert.equal(fail.reason, "clean item, 1 defect claim");
  const empty = await grade({ expected: CLEAN_ITEM, findings: [] });
  assert.equal(empty.state, "pass");
  assert.equal(empty.reason, "clean item, no finding");
});

test("on a clean item, a finding with no blocking flag counts as a claim without a fallback, and the evidence says so", async () => {
  const r = await grade({ expected: CLEAN_ITEM, findings: [finding({ blocking: undefined })] });
  assert.equal(r.state, "fail");
  assert.match(r.output, /no blocking flag and no llm_fallback: counted as a claim/);
});

test("with a fallback, only unflagged findings are classified, and its claims decide", async () => {
  const ask = stub('{"claims": [2], "reason": "#2 says the total is wrong"}');
  const findings = [finding({ blocking: false }), finding({ blocking: undefined, message: "the total is wrong" }), finding({ blocking: undefined, message: "nit: naming" })];
  const r = await grade({ expected: CLEAN_ITEM, findings, check: WITH_LLM, ask });
  assert.equal(ask.calls.length, 1);
  assert.doesNotMatch(ask.calls[0]!.user, /#1 /);
  assert.equal(r.state, "fail");
  assert.equal(r.measures?.defect_claims, 1);
  assert.match(r.output, /#3 src\/tax\.ts:41: no defect claim, per the LLM/);

  const none = await grade({ expected: CLEAN_ITEM, findings: findings.slice(2), check: WITH_LLM, ask: stub('{"claims": [], "reason": "a nit"}') });
  assert.equal(none.state, "pass");
});

/* ── what the candidate left ─────────────────────────────────────────────── */

test("no findings.json is a fail (no review), never a clean pass, and needs no answer key", async () => {
  const clean = await grade({ expected: CLEAN_ITEM });
  assert.equal(clean.state, "fail");
  assert.equal(clean.reason, "no review");
  const noKey = await grade({});
  assert.equal(noKey.state, "fail", "decided before the answer key is read");
});

test("findings.json that is not JSON, or not a list of findings, fails the candidate", async () => {
  const bad = await grade({ expected: DEFECT_ITEM, findings: "{not json" });
  assert.equal(bad.state, "fail");
  assert.match(bad.output, /not valid JSON/);
  const shape = await grade({ expected: DEFECT_ITEM, findings: { comments: [] } });
  assert.equal(shape.state, "fail");
  const wrapped = await grade({ expected: DEFECT_ITEM, findings: { findings: [finding()] } });
  assert.equal(wrapped.state, "pass", "{findings: [...]} is accepted");
});

test("invalid findings are dropped and counted, and the rest are graded", async () => {
  const findings = [
    { file: "src/tax.ts", start_line: 41 },
    finding({ severity: "major" }),
    finding({ start_line: 41, end_line: 39 }),
    { message: "lines but no file", start_line: 3 },
    "just text",
    finding({ severity: "HIGH" }),
  ];
  const r = await grade({ expected: DEFECT_ITEM, findings });
  assert.equal(r.state, "pass");
  assert.equal(r.measures?.findings, 1);
  assert.equal(r.measures?.invalid_findings, 5);
  assert.match(r.output, /5 invalid finding\(s\) dropped: #1 message is missing or empty; #2 severity is not one of/);
});

test("parseFindings accepts nulls for absent fields and defaults end_line to start_line", () => {
  const p = parseFindings(JSON.stringify([{ file: null, start_line: null, message: "global", blocking: null }, { file: "a.ts", start_line: 7, message: "m" }]));
  assert.ok(p.ok);
  assert.deepEqual(p.findings, [{ message: "global" }, { file: "a.ts", start_line: 7, end_line: 7, message: "m" }]);
});

/* ── evaluator errors ────────────────────────────────────────────────────── */

test("a missing or malformed answer key is an evaluator error, not a candidate failure", async () => {
  const none = await grade({ findings: [finding()] });
  assert.equal(none.state, "evaluator_error");
  assert.equal(none.reason, "no answer key");
  for (const bad of ["{oops", { kind: "escaped-defect", defect: "x", file: "a" }, { kind: "defect", defects: [] }, { kind: "defect", defects: [{ file: "a.ts", description: "d" }] }]) {
    const r = await grade({ expected: bad, findings: [finding()] });
    assert.equal(r.state, "evaluator_error", JSON.stringify(bad));
    assert.equal(r.reason, "bad answer key");
  }
});

test("the answer key under references/<step>/ wins over references/", async () => {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "eval-fm-step-"));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "eval-fm-work-"));
  try {
    await fs.mkdir(path.join(task, "references", "review"), { recursive: true });
    await fs.writeFile(path.join(task, "references", "pr1.txt"), JSON.stringify(DEFECT_ITEM));
    await fs.writeFile(path.join(task, "references", "review", "pr1.txt"), JSON.stringify(CLEAN_ITEM));
    await fs.writeFile(path.join(work, "findings.json"), "[]");
    const r = await runFindingsMatchCheck({ check: CHECK, files: [], workDir: work, taskRoot: task, step: "review", input: "pr1" });
    assert.equal(r.state, "pass");
    assert.equal(r.reason, "clean item, no finding");
  } finally {
    await fs.rm(task, { recursive: true, force: true });
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("an unreadable verdict is asked again; a fallback that keeps failing is an evaluator error", async () => {
  const flaky = stub(new Error("HTTP 500"), "I think so", '{"matches":[{"finding":1,"defect":1}],"reason":"r"}');
  const ok = await grade({ expected: DEFECT_ITEM, findings: [finding({ start_line: 99 })], check: WITH_LLM, ask: flaky });
  assert.equal(ok.state, "pass");
  assert.equal(flaky.calls.length, 3);

  const down = stub(new Error("HTTP 401: bad key"));
  const r = await grade({ expected: DEFECT_ITEM, findings: [finding({ start_line: 99 })], check: WITH_LLM, ask: down });
  assert.equal(r.state, "evaluator_error");
  assert.equal(r.reason, "llm fallback failed");
  assert.match(r.output, /3 attempts: HTTP 401/);
  const claim = await grade({ expected: CLEAN_ITEM, findings: [finding({ blocking: undefined })], check: WITH_LLM, ask: down });
  assert.equal(claim.state, "evaluator_error");
});

/* ── decisions, version, oracle ──────────────────────────────────────────── */

test("every decision is written to findings-match.json beside the evidence", async () => {
  const r = await grade({ expected: DEFECT_ITEM, findings: [finding(), finding({ start_line: 80 })], check: WITH_LLM, ask: stub('{"matches":[],"reason":"r"}') });
  const d = r.decisions as { version: string; finding_source: unknown[]; defects: Array<{ caught_by: string }>; llm: { model: string } };
  assert.equal(d.version, r.version);
  assert.deepEqual(d.finding_source, ["deterministic", null]);
  assert.equal(d.defects[0]?.caught_by, "deterministic");
  assert.equal(d.llm.model, "google/gemini-3.1-pro-preview");
});

test("nothing the check leaves in the work dir carries a defect's description or fix", async () => {
  const secret = { ...DEFECT, description: "SECRET-DESCRIPTION", fix_commit: "SECRETCOMMIT", fix_diff: "--- a\n+++ b\n-SECRET-DIFF" };
  for (const findings of [[finding()], [finding({ start_line: 90 })]]) {
    const r = await grade({ expected: { kind: "defect", defects: [secret] }, findings, check: WITH_LLM, ask: stub('{"matches":[],"reason":"no"}') });
    assert.ok(r.decisions, "the record was written");
    assert.doesNotMatch(r.workText, /SECRET/);
    assert.doesNotMatch(r.output, /SECRET/);
  }
});

test("a trial with no review still reports the item's defects as not caught, so caught over defects counts it", async () => {
  const defect = await grade({ expected: DEFECT_ITEM });
  assert.deepEqual(defect.measures, { findings: 0, invalid_findings: 0, defects: 1, caught: 0, matched_deterministic: 0, matched_llm: 0, unmatched_findings: 0 });
  const unreadable = await grade({ expected: DEFECT_ITEM, findings: "nope" });
  assert.equal(unreadable.measures?.defects, 1);
  const clean = await grade({ expected: CLEAN_ITEM });
  assert.deepEqual(clean.measures, { findings: 0, invalid_findings: 0, defect_claims: 0 });
  const noKey = await grade({});
  assert.deepEqual(noKey.measures, { findings: 0, invalid_findings: 0 });
});

test("the configured fallback calls the model through the repo's client, at temperature 0", async () => {
  const realFetch = globalThis.fetch;
  const savedKey = process.env.OPENROUTER_API_KEY;
  const bodies: Array<Record<string, unknown>> = [];
  process.env.OPENROUTER_API_KEY = "or-key";
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    const content = '{"matches":[{"finding":1,"defect":1}],"reason":"same fault"}';
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } }), { status: 200 });
  }) as typeof fetch;
  try {
    const r = await grade({ expected: DEFECT_ITEM, findings: [finding({ start_line: 90 })], check: WITH_LLM });
    assert.equal(r.state, "pass");
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0]!.model, "google/gemini-3.1-pro-preview");
    assert.equal(bodies[0]!.temperature, 0);
    const messages = bodies[0]!.messages as Array<{ role: string; content: string }>;
    assert.equal(messages[0]?.role, "system");
    assert.match(messages[0]!.content, /whether code review findings point at known defects/);
    assert.match(messages[1]!.content, /KNOWN DEFECTS/);
  } finally {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  }
});

test("the version carries the options, and the fallback's model and prompts", () => {
  const base = findingsMatchVersion(CHECK);
  assert.match(base, /^findings-match-1\+opts-[0-9a-f]{8}$/);
  assert.equal(findingsMatchVersion({ ...CHECK }), base, "stable");
  const changed = [
    { ...CHECK, lineTolerance: 5 },
    { ...CHECK, requireCategory: true },
    WITH_LLM,
    { ...WITH_LLM, llmFallback: { ...WITH_LLM.llmFallback!, model: "openai/gpt-5.5" } },
    { ...WITH_LLM, llmFallback: { ...WITH_LLM.llmFallback!, endpoint: { route: "anthropic" as const } } },
  ];
  const versions = changed.map(findingsMatchVersion);
  assert.equal(new Set([base, ...versions]).size, changed.length + 1);
});

test("the oracle review — each defect as a blocking finding — passes without the LLM; an empty answer fails", async () => {
  for (const expected of [DEFECT_ITEM, { kind: "defect", defects: [DEFECT, { ...DEFECT, file: "src/b.ts" }] }, CLEAN_ITEM]) {
    const oracle = oracleFindings(parseExpected(JSON.stringify(expected)));
    const pass = await grade({ expected, findings: oracle, check: WITH_LLM, ask: NEVER });
    assert.equal(pass.state, "pass", JSON.stringify(expected));
    const empty = await grade({ expected, check: WITH_LLM, ask: NEVER });
    assert.equal(empty.state, "fail");
  }
});

test("candidate files are placed in the work dir first, so a model candidate can deliver findings.json as a file block", async () => {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "eval-fm-files-"));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "eval-fm-work-"));
  try {
    await fs.mkdir(path.join(task, "references"));
    await fs.writeFile(path.join(task, "references", "pr1.txt"), JSON.stringify(DEFECT_ITEM));
    const files = [{ path: "findings.json", content: JSON.stringify([finding()]) }];
    const r = await runFindingsMatchCheck({ check: CHECK, files, workDir: work, taskRoot: task, input: "pr1" });
    assert.equal(r.state, "pass");
    const escape = await runFindingsMatchCheck({ check: CHECK, files: [{ path: "../x.json", content: "[]" }], workDir: work, taskRoot: task, input: "pr1" });
    assert.equal(escape.state, "fail");
  } finally {
    await fs.rm(task, { recursive: true, force: true });
    await fs.rm(work, { recursive: true, force: true });
  }
});
