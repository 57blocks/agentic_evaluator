/**
 * `kind: findings-match` — the built-in required check for a code review.
 *
 * Runs in the trial's work dir, after the candidate's files are placed there
 * (a model candidate delivers `findings.json` as a file block):
 *
 *   no findings.json                 fail ("no review"), never a clean pass
 *   findings.json unreadable / not
 *     an array or {findings: [...]}  fail: the candidate's doing
 *   no or bad answer key             evaluator_error
 *   LLM fallback failed              evaluator_error
 *   otherwise                        the matcher's verdict (match.ts)
 *
 * The answer key is the item's `expected` (references/<input>.txt, written
 * from items.jsonl), read from the run's private copy while references/ is
 * hidden. Invalid findings are dropped and counted. The decisions — which
 * finding matched which defect, and how — are written to findings-match.json
 * beside the evidence, without the answer key's text.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { referencesCopyFor } from "../core/answer-key.js";
import { complete } from "../llm.js";
import { MAX_OUTPUT_CHARS, placeFiles, writeFresh, writePlaced, type CheckFile, type CheckResult } from "../check.js";
import type { CheckConfig } from "../types.js";
import { ExpectedError, parseExpected, parseFindings, type Expected, type Finding, type InvalidFinding } from "./findings.js";
import { gradeItem, groupDefects, LlmFallbackError, verdictOfGrade, type Ask, type CleanGrade, type DefectGrade, type LlmFallback } from "./match.js";
import { findingsMatchVersion } from "./version.js";

export type FindingsMatchConfig = Extract<CheckConfig, { kind: "findings-match" }>;

export const FINDINGS_FILE = "findings.json";
/** What the check writes beside the evidence: every decision it made. */
export const DECISIONS_FILE = "findings-match.json";
/** A review bigger than this is not read. */
const MAX_FINDINGS_BYTES = 5 * 1024 * 1024;
const LLM_MAX_TOKENS = 4_000;

const EXIT_PASS = 0;
const EXIT_FAIL = 1;

/** The configured fallback as an Ask over the repo's model client. */
export function askOf(llm: NonNullable<FindingsMatchConfig["llmFallback"]>): Ask {
  return async (system, user) => {
    const r = await complete({ model: llm.model, endpoint: llm.endpoint, system, prompt: user, temperature: 0, maxTokens: LLM_MAX_TOKENS });
    return r.text;
  };
}

/** The item's answer key: references/<step>/<input>.txt first, then references/<input>.txt. */
export async function readExpectedText(taskRoot: string, step: string | undefined, input: string): Promise<{ text: string; file: string } | null> {
  const root = referencesCopyFor(taskRoot) ?? path.join(taskRoot, "references");
  const tries = [...(step !== undefined ? [path.join(root, step, `${input}.txt`)] : []), path.join(root, `${input}.txt`)];
  for (const file of tries) {
    const text = await fs.readFile(file, "utf-8").catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
      throw err;
    });
    if (text !== null) return { text, file };
  }
  return null;
}

type Read<T> = { ok: true; value: T } | { ok: false; result: CheckResult };

async function readFindingsFile(workDir: string, version: string): Promise<Read<string>> {
  const file = path.join(workDir, FINDINGS_FILE);
  const fail = (why: string, reason = why): Read<string> => ({ ok: false, result: { state: "fail", passed: false, exitCode: EXIT_FAIL, output: why, version, reason } });
  const stat = await fs.lstat(file).catch(() => null);
  if (stat === null) return fail(`the candidate left no ${FINDINGS_FILE}`, "no review");
  // A link could point anywhere on the host; the check reads in-process.
  if (!stat.isFile()) return fail(`${FINDINGS_FILE} is not a regular file`);
  if (stat.size > MAX_FINDINGS_BYTES) return fail(`${FINDINGS_FILE} is ${stat.size} bytes, over the ${MAX_FINDINGS_BYTES}-byte limit`);
  return { ok: true, value: await fs.readFile(file, "utf-8") };
}

function evaluatorError(output: string, reason: string, version: string): CheckResult {
  return { state: "evaluator_error", passed: false, exitCode: -1, output: output.slice(0, MAX_OUTPUT_CHARS), version, reason };
}

async function readExpected(taskRoot: string, step: string | undefined, input: string, version: string): Promise<Read<Expected>> {
  let found;
  try {
    found = await readExpectedText(taskRoot, step, input);
  } catch (err) {
    return { ok: false, result: evaluatorError(`could not read the answer key for ${input}: ${err instanceof Error ? err.message : String(err)}`, "answer key unreadable", version) };
  }
  if (found === null) return { ok: false, result: evaluatorError(`no answer key for ${input} (references/${input}.txt, from the item's "expected")`, "no answer key", version) };
  try {
    return { ok: true, value: parseExpected(found.text) };
  } catch (err) {
    if (!(err instanceof ExpectedError)) throw err;
    return { ok: false, result: evaluatorError(`answer key ${path.basename(found.file)} is not a code-review expected: ${err.message}`, "bad answer key", version) };
  }
}

/**
 * What findings-match.json keeps: the candidate's findings and, per defect,
 * only where it is and how it was matched. Never a defect's description or
 * fix: the work dir is kept under runs/, which a later trial could read, and
 * the fix must stay out of a reviewer's reach. The LLM's reason is left out
 * for the same reason; it is in the evidence.
 */
function decisionRecord(version: string, findings: readonly Finding[], invalid: readonly InvalidFinding[], grade: DefectGrade | CleanGrade): unknown {
  const base = { version, kind: grade.kind, findings, invalid };
  if (grade.kind === "clean") {
    return { ...base, bases: grade.bases, claims: grade.claims, ...(grade.llm ? { llm: { model: grade.llm.model, claims: grade.llm.claims } } : {}) };
  }
  return {
    ...base,
    // One per fix: its places (entries sharing a fix_commit), never the fix itself.
    defects: grade.defects.map((d) => ({ places: d.places.map((p) => ({ file: p.file, start_line: p.start_line, end_line: p.end_line })), caught_by: d.caughtBy, findings: d.findings })),
    finding_source: grade.findingSource,
    ambiguous: grade.ambiguous,
    judged: grade.judged,
    ...(grade.llm ? { llm: { model: grade.llm.model, matches: grade.llm.matches } } : {}),
  };
}

/**
 * A review that never came still counts against the item: zero caught of
 * its defects, so `caught` over `defects` includes the trial. Best effort —
 * the answer key is not needed to fail it, and an empty answer fails on an
 * input without one.
 */
async function noReviewMeasures(params: { taskRoot: string; step?: string; input: string }): Promise<Record<string, number>> {
  const base = { findings: 0, invalid_findings: 0 };
  try {
    const found = await readExpectedText(params.taskRoot, params.step, params.input);
    if (found === null) return base;
    const expected = parseExpected(found.text);
    return expected.kind === "clean"
      ? { ...base, defect_claims: 0 }
      : { ...base, defects: groupDefects(expected.defects).length, caught: 0, matched_deterministic: 0, matched_llm: 0, unmatched_findings: 0 };
  } catch {
    return base;
  }
}

export async function runFindingsMatchCheck(params: {
  check: FindingsMatchConfig;
  /** The candidate's parsed files, placed in the work dir first. */
  files: readonly CheckFile[];
  workDir: string;
  taskRoot: string;
  step?: string;
  input: string;
  /** Overrides the configured fallback's model call (tests; check-task, which must never call one). */
  ask?: Ask;
}): Promise<CheckResult> {
  const { check, workDir } = params;
  const version = findingsMatchVersion(check);
  const laid = placeFiles(workDir, params.files, version);
  if ("failed" in laid) return laid.failed;
  try {
    await fs.mkdir(workDir, { recursive: true });
    await writePlaced(laid.placed);
  } catch (err) {
    return evaluatorError(err instanceof Error ? err.message : String(err), "could not materialize work dir", version);
  }

  // No review is decided before the answer key is read: an empty answer fails on any item.
  const raw = await readFindingsFile(workDir, version);
  if (!raw.ok) return { ...raw.result, measures: await noReviewMeasures(params) };
  const parsed = parseFindings(raw.value);
  if (!parsed.ok) return { state: "fail", passed: false, exitCode: EXIT_FAIL, output: parsed.why, version, reason: "unreadable review", measures: await noReviewMeasures(params) };

  const expected = await readExpected(params.taskRoot, params.step, params.input, version);
  if (!expected.ok) return expected.result;

  const llm: LlmFallback | undefined = check.llmFallback
    ? { model: check.llmFallback.model, ask: params.ask ?? askOf(check.llmFallback) }
    : undefined;
  let grade;
  try {
    grade = await gradeItem(expected.value, parsed.findings, { lineTolerance: check.lineTolerance, requireCategory: check.requireCategory }, llm);
  } catch (err) {
    if (!(err instanceof LlmFallbackError)) throw err;
    return evaluatorError(`llm_fallback failed: ${err.message}`, "llm fallback failed", version);
  }
  const verdict = verdictOfGrade(grade, parsed.findings);

  const invalid = parsed.invalid.length > 0
    ? [`${parsed.invalid.length} invalid finding(s) dropped: ${parsed.invalid.slice(0, 5).map((f) => `#${f.index} ${f.why}`).join("; ")}${parsed.invalid.length > 5 ? "; …" : ""}`]
    : [];
  const head = `${expected.value.kind} item: ${parsed.findings.length} finding(s)`;
  const recorded = await writeFresh(path.join(workDir, DECISIONS_FILE), `${JSON.stringify(decisionRecord(version, parsed.findings, parsed.invalid, grade), null, 2)}\n`)
    .then(() => [] as string[], (err: unknown) => [`(${DECISIONS_FILE} not written: ${err instanceof Error ? err.message : String(err)})`]);
  const output = [head, ...invalid, verdict.evidence, ...recorded].filter((l) => l !== "").join("\n").slice(0, MAX_OUTPUT_CHARS);
  return {
    state: verdict.passed ? "pass" : "fail",
    passed: verdict.passed,
    exitCode: verdict.passed ? EXIT_PASS : EXIT_FAIL,
    output,
    version,
    reason: verdict.reason,
    measures: { findings: parsed.findings.length, invalid_findings: parsed.invalid.length, ...verdict.measures },
  };
}
