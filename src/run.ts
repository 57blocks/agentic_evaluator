/**
 * Model-eval CLI entry point + reusable `runSuite` driver.
 *
 *   tsx eval/src/run.ts --suite eval/suites/prd.json [--html]
 *
 * Runs every candidate against every fixed input (× trials) through the suite's
 * producer, then has a judge pairwise-rank them. codegen suites additionally run
 * an objective `tsc --noEmit` gate. Writes report.{md,json,html} + raw outputs
 * to eval/results/<runId>/.
 *
 * `runSuite` is exported so `run-all.ts` can drive all three steps in-process.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { complete } from "./llm.js";
import { judgePair } from "./judge.js";
import { scoreOne } from "./score.js";
import { renderMarkdown, renderHtml } from "./report.js";
import type {
  Judgement,
  ProducerKind,
  Report,
  RunRecord,
  Scorecard,
  ScoreRecord,
  Suite,
  Winner,
} from "./types.js";

import { REPO_ROOT, inputsDir, runsDir } from "./paths.js";

/** Load KEY=VALUE lines from .env.local into process.env (no dependency). */
async function loadEnvLocal(): Promise<void> {
  try {
    const raw = await fs.readFile(path.join(REPO_ROOT, ".env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key]) continue;
      process.env[key] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local — rely on ambient env.
  }
}

function parseArgs(argv: string[]): { suite: string; html: boolean } {
  let suite = "suites/prd.json";
  let html = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--suite") suite = argv[++i];
    else if (argv[i] === "--html") html = true;
  }
  return { suite, html };
}

async function loadSuite(suitePath: string): Promise<Suite> {
  const raw = await fs.readFile(path.resolve(REPO_ROOT, suitePath), "utf-8");
  return JSON.parse(raw) as Suite;
}

function readInput(inputSlug: string): Promise<string> {
  return fs.readFile(path.join(inputsDir(), `${inputSlug}.txt`), "utf-8");
}

/** Stable run id shared by the output dir and (for run-all) reporting. */
export function reportRunId(report: Report): string {
  return `${report.suiteId}-${report.generatedAt.replace(/[:.]/g, "-")}`;
}

/** OpenRouter model ids contain `/` (and sometimes `:`) — make a fs-safe name. */
function safeName(candidate: string): string {
  return candidate.replace(/[/:]/g, "_");
}

/** Fallback max concurrent generations/judgements when EVAL_CONCURRENCY is unset/invalid. */
const DEFAULT_CONCURRENCY = 5;

/**
 * Max concurrent in-flight LLM calls, from `EVAL_CONCURRENCY` (parseInt, base 10).
 * Unset/invalid → {@link DEFAULT_CONCURRENCY}; anything below 1 clamps to 1.
 * Read after env is loaded (loadEnvLocal runs before runSuite in both entry
 * points), so it also picks up values placed in `.env.local`.
 */
function resolveConcurrency(): number {
  const parsed = parseInt(process.env.EVAL_CONCURRENCY ?? "", 10);
  return Number.isNaN(parsed) ? DEFAULT_CONCURRENCY : Math.max(1, parsed);
}

/**
 * Map `fn` over `items` with at most `limit` calls in flight at once. Uses a
 * sliding window (a finished slot is immediately refilled — not a batch barrier)
 * and returns results in INPUT order regardless of completion order. Pure
 * Promise implementation, no third-party dependency.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  // Each worker pulls the next unclaimed index until the list is exhausted. The
  // read-then-increment is atomic under JS's single-threaded model, so no two
  // workers ever claim the same index.
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  };
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Output of a single generation (before it becomes a RunRecord). */
interface GenOutput {
  text: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  ms: number;
  checkPassed?: boolean;
  checkOutput?: string;
}

/**
 * Produce one candidate output for one input, dispatched by producer kind.
 * Dynamic imports keep `src/` (agent) / the `tsc` gate (codegen) out of the
 * module graph until after env is configured, and are module-cached across
 * calls.
 */
async function generateOne(params: {
  suite: Suite;
  producer: ProducerKind;
  promptTpl: string;
  inputText: string;
  candidate: string;
  temperature: number;
  timeoutMs: number;
  checkWorkDir: string;
}): Promise<GenOutput> {
  const { suite, producer, promptTpl, inputText, candidate, temperature, timeoutMs } = params;

  if (producer === "prompt") {
    const prompt = promptTpl.replace("{{input}}", inputText);
    const r = await complete({ model: candidate, prompt, temperature, timeoutMs });
    return {
      text: r.text,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      costUsd: r.costUsd,
      ms: r.ms,
    };
  }

  if (producer === "agent") {
    // The real PMAgent / TRDAgent / TaskBreakdownAgent producers live in
    // agentic-builder and import its src/. They are not available in this
    // standalone repo; wire them back through a candidate adapter later.
    throw new Error(
      `agent producer is not available in this repo (step "${suite.step}"); use "prompt" or "codegen"`,
    );
  }

  // producer === "codegen"
  const { produceCode } = await import("./producers/code-gen.js");
  const r = await produceCode(inputText, candidate, { temperature, timeoutMs });
  let checkPassed: boolean | undefined;
  let checkOutput: string | undefined;
  if (suite.check) {
    const { runCheck } = await import("./check.js");
    const result = await runCheck({
      files: r.files,
      scaffoldDir: path.resolve(REPO_ROOT, suite.check.scaffoldDir),
      workDir: params.checkWorkDir,
    });
    checkPassed = result.passed;
    checkOutput = result.output;
  }
  return {
    text: r.text,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    costUsd: r.costUsd,
    ms: r.ms,
    checkPassed,
    checkOutput,
  };
}

/** One unit of generation work in the input × candidate × trial grid. */
interface GenTask {
  inputSlug: string;
  inputText: string;
  candidate: string;
  trial: number;
}

/**
 * Narrow one parsed `records.json` entry (text-stripped, `unknown`) into a full
 * {@link RunRecord} for reuse — but only if it matches (candidate, inputSlug,
 * trial), has `status === "ok"`, and carries valid numeric metrics. The reused
 * `text` comes from the raw file, not the record. Returns `null` on any
 * mismatch so `loadReusable` can keep scanning. Never throws.
 */
function toReusableRecord(
  value: unknown,
  candidate: string,
  inputSlug: string,
  trial: number,
  text: string,
): RunRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (r.candidate !== candidate || r.inputSlug !== inputSlug || r.trial !== trial) {
    return null;
  }
  if (r.status !== "ok") return null;
  if (
    typeof r.promptTokens !== "number" ||
    typeof r.completionTokens !== "number" ||
    typeof r.costUsd !== "number" ||
    typeof r.ms !== "number"
  ) {
    return null;
  }
  return {
    candidate,
    inputSlug,
    trial,
    text,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    costUsd: r.costUsd,
    ms: r.ms,
    status: "ok",
    checkPassed: typeof r.checkPassed === "boolean" ? r.checkPassed : undefined,
    checkOutput: typeof r.checkOutput === "string" ? r.checkOutput : undefined,
  };
}

/**
 * Find a reusable prior generation for one (candidate, inputSlug, trial) so an
 * already-run candidate isn't regenerated (no LLM call, no cost) when a new
 * candidate is added — see EVAL_REUSE. Scans `eval/results/` for dirs named
 * `<step>-…` (excluding the current run), newest-first (name descending), and
 * returns the first that has BOTH the raw output file AND a matching `status:
 * "ok"` record in its `records.json`. The returned record's `text` is read from
 * the raw file (records.json is text-stripped). Best-effort: any read/parse
 * failure is swallowed and treated as a miss — never throws. Returns `null`
 * when nothing reusable is found (→ caller generates fresh).
 */
async function loadReusable(
  step: string,
  candidate: string,
  inputSlug: string,
  trial: number,
  currentRunId: string,
): Promise<RunRecord | null> {
  const resultsDir = runsDir();
  let dirNames: string[];
  try {
    const entries = await fs.readdir(resultsDir, { withFileTypes: true });
    dirNames = entries
      .filter(
        (e) =>
          e.isDirectory() &&
          e.name.startsWith(`${step}-`) &&
          e.name !== currentRunId,
      )
      .map((e) => e.name)
      // Timestamped names sort lexicographically by time → descending = newest first.
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return null;
  }

  const rawFileName = `${safeName(candidate)}__${inputSlug}__t${trial}.txt`;
  for (const dirName of dirNames) {
    try {
      const dir = path.join(resultsDir, dirName);
      // Require the raw output first — throws (→ caught → next dir) if absent.
      const text = await fs.readFile(path.join(dir, "raw", rawFileName), "utf-8");
      const parsed: unknown = JSON.parse(
        await fs.readFile(path.join(dir, "records.json"), "utf-8"),
      );
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed) {
        const record = toReusableRecord(entry, candidate, inputSlug, trial, text);
        if (record) return record;
      }
    } catch {
      // Missing raw file, unreadable / invalid records.json, etc. → treat as a
      // miss and keep scanning older dirs.
      continue;
    }
  }
  return null;
}

/**
 * Run every candidate × input × trial, up to `limit` in parallel. Failures are
 * recorded, not thrown. Records come back in input → candidate → trial order
 * (matching the old serial loops), so `representative` and raw-file writing are
 * unaffected; only the interleaved console output changes.
 */
async function runAll(
  suite: Suite,
  producer: ProducerKind,
  promptTpl: string,
  outDir: string,
  limit: number,
  runId: string,
  reuse: boolean,
): Promise<RunRecord[]> {
  const trials = suite.trials ?? 2;
  const temperature = suite.temperature ?? 0.3;
  const timeoutMs = suite.timeoutMs ?? 120_000;

  // Read each input file once, up front — the grid reuses the text across every
  // candidate and trial for that input.
  const inputTextBySlug = new Map<string, string>();
  for (const inputSlug of suite.inputs) {
    inputTextBySlug.set(inputSlug, await readInput(inputSlug));
  }

  // Full task grid in input → candidate → trial order.
  const tasks: GenTask[] = [];
  for (const inputSlug of suite.inputs) {
    const inputText = inputTextBySlug.get(inputSlug) ?? "";
    for (const candidate of suite.candidates) {
      for (let trial = 0; trial < trials; trial++) {
        tasks.push({ inputSlug, inputText, candidate, trial });
      }
    }
  }

  return mapWithConcurrency(tasks, limit, async (task): Promise<RunRecord> => {
    const { inputSlug, inputText, candidate, trial } = task;
    // Unique per (candidate, inputSlug, trial) → each parallel task writes its
    // own temp dir, so concurrent codegen checks never collide.
    const checkWorkDir = path.join(
      outDir,
      "checks",
      `${safeName(candidate)}__${inputSlug}__t${trial}`,
    );
    // Reuse a prior generation for already-run candidates (no LLM call, no cost)
    // — only genuinely-new (candidate, input, trial) cells hit generateOne. Pure
    // disk read, so it mixes freely into the same concurrency window.
    if (reuse) {
      const reused = await loadReusable(suite.step, candidate, inputSlug, trial, runId);
      if (reused) {
        console.log(`  reuse  ${candidate} · ${inputSlug} · t${trial}`);
        return reused;
      }
    }
    try {
      const g = await generateOne({
        suite,
        producer,
        promptTpl,
        inputText,
        candidate,
        temperature,
        timeoutMs,
        checkWorkDir,
      });
      const checkTag =
        g.checkPassed === undefined ? "" : g.checkPassed ? " · tsc ✓" : " · tsc ✗";
      console.log(
        `  ok   ${candidate} · ${inputSlug} · t${trial} (${(g.ms / 1000).toFixed(1)}s, $${g.costUsd.toFixed(4)})${checkTag}`,
      );
      return {
        candidate,
        inputSlug,
        trial,
        text: g.text,
        promptTokens: g.promptTokens,
        completionTokens: g.completionTokens,
        costUsd: g.costUsd,
        ms: g.ms,
        status: "ok",
        checkPassed: g.checkPassed,
        checkOutput: g.checkOutput,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.log(`  ERR  ${candidate} · ${inputSlug} · t${trial}: ${error}`);
      return {
        candidate,
        inputSlug,
        trial,
        text: "",
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        ms: 0,
        status: "error",
        error,
      };
    }
  });
}

/** First successful output for a (candidate, input) pair, if any. */
function representative(
  records: RunRecord[],
  candidate: string,
  inputSlug: string,
): string | null {
  const hit = records.find(
    (r) => r.candidate === candidate && r.inputSlug === inputSlug && r.status === "ok",
  );
  return hit ? hit.text : null;
}

/** One pairwise judge task — both sides already confirmed to have output. */
interface JudgeTask {
  inputSlug: string;
  a: string;
  aText: string;
  b: string;
  bText: string;
}

/** Pairwise judge every candidate pair, per input, up to `limit` in parallel. */
async function judgeAll(
  suite: Suite,
  rubric: string,
  records: RunRecord[],
  limit: number,
): Promise<Judgement[]> {
  // Build the pair grid first, skipping any pair where a side produced no output
  // (equivalent to the old `continue`).
  const tasks: JudgeTask[] = [];
  for (const inputSlug of suite.inputs) {
    for (let i = 0; i < suite.candidates.length; i++) {
      for (let j = i + 1; j < suite.candidates.length; j++) {
        const a = suite.candidates[i];
        const b = suite.candidates[j];
        const aText = representative(records, a, inputSlug);
        const bText = representative(records, b, inputSlug);
        if (!aText || !bText) continue; // one side failed → no comparison
        tasks.push({ inputSlug, a, aText, b, bText });
      }
    }
  }

  // A single judge call failing (timeout / bad judge model / transient API error)
  // must NOT discard the whole suite and every paid generation with it. Catch
  // per-pair, log a SKIP, and drop that comparison — the suite still reports on
  // whatever judgements succeeded (a candidate with zero comparisons just gets a
  // null winRate).
  const results = await mapWithConcurrency(
    tasks,
    limit,
    async (task): Promise<Judgement | null> => {
      console.log(`  judge  ${task.a} vs ${task.b} · ${task.inputSlug}`);
      try {
        return await judgePair({
          judgeModel: suite.judge,
          // Judge big docs can exceed llm.ts's 120s default → use the suite's
          // (generous) timeout so judging doesn't abort prematurely.
          timeoutMs: suite.timeoutMs ?? 240_000,
          rubric,
          // The prompt lists these keys; each gets its own de-biased verdict.
          dimensions: suite.dimensions ?? [],
          inputSlug: task.inputSlug,
          a: task.a,
          aText: task.aText,
          b: task.b,
          bText: task.bText,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  judge SKIP  ${task.a} vs ${task.b} · ${task.inputSlug}: ${msg}`);
        return null;
      }
    },
  );
  return results.filter((j): j is Judgement => j !== null);
}

/**
 * Absolute 1–5 grade for every OK output, up to `limit` in parallel. O(n) — one
 * grader call per output, independent of the candidate count. A single failure
 * is logged as a SKIP and dropped (never throws), exactly like `judgeAll`, so
 * the suite still reports whatever grades succeeded.
 */
async function scoreAll(
  suite: Suite,
  rubric: string,
  records: RunRecord[],
  limit: number,
): Promise<ScoreRecord[]> {
  const dimensions = suite.dimensions ?? [];
  const oks = records.filter((r) => r.status === "ok" && r.text.trim());
  const results = await mapWithConcurrency(
    oks,
    limit,
    async (r): Promise<ScoreRecord | null> => {
      console.log(`  score  ${r.candidate} · ${r.inputSlug} · t${r.trial}`);
      try {
        const s = await scoreOne({
          judgeModel: suite.judge,
          rubric,
          dimensions,
          text: r.text,
          timeoutMs: suite.timeoutMs ?? 240_000,
        });
        return {
          candidate: r.candidate,
          inputSlug: r.inputSlug,
          trial: r.trial,
          dimensions: s.dimensions,
          overall: s.overall,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  score SKIP  ${r.candidate} · ${r.inputSlug} · t${r.trial}: ${msg}`);
        return null;
      }
    },
  );
  return results.filter((s): s is ScoreRecord => s !== null);
}

/**
 * Win rate (0..100, tie = 0.5) for one candidate on one axis, or null when it
 * had no comparisons on that axis. `pick` reads the resolved verdict for the
 * axis of interest (overall, or one dimension) off each judgement; returning
 * `undefined` means "this judgement doesn't cover this axis" → not counted.
 */
function winRateFor(
  candidate: string,
  judgements: Judgement[],
  pick: (jm: Judgement) => Winner | undefined,
): number | null {
  let wins = 0;
  let comparisons = 0;
  for (const jm of judgements) {
    const resolved = pick(jm);
    if (resolved === undefined) continue;
    if (jm.a === candidate) {
      comparisons++;
      if (resolved === "a") wins += 1;
      else if (resolved === "tie") wins += 0.5;
    } else if (jm.b === candidate) {
      comparisons++;
      if (resolved === "b") wins += 1;
      else if (resolved === "tie") wins += 0.5;
    }
  }
  return comparisons > 0 ? (wins / comparisons) * 100 : null;
}

function aggregate(
  suite: Suite,
  records: RunRecord[],
  judgements: Judgement[],
  scores: ScoreRecord[] = [],
): Scorecard[] {
  const trials = suite.trials ?? 2;
  const dimensions = suite.dimensions ?? [];
  return suite.candidates.map((candidate) => {
    const own = records.filter((r) => r.candidate === candidate);
    const oks = own.filter((r) => r.status === "ok");

    // Overall win rate — same rule/口径 as before, now off `overall.resolved`.
    const winRate = winRateFor(candidate, judgements, (jm) => jm.overall.resolved);

    // Per-dimension win rate — the identical computation over each dimension's
    // resolved verdict. A candidate never compared on a dimension → null.
    const dimensionWinRates: Record<string, number | null> = {};
    for (const dim of dimensions) {
      dimensionWinRates[dim] = winRateFor(
        candidate,
        judgements,
        (jm) => jm.dimensions[dim]?.resolved,
      );
    }

    const avg = (nums: number[]) =>
      nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;

    // Objective pass rate: fraction of OK runs whose objective check passed.
    // Producer-agnostic — any producer that stamps `checkPassed` on its records
    // gets a score (codegen → tsc, taskbreakdown → PRD coverage); prd/trd never
    // set it, so the field stays null and the report hides the column.
    const hasObjective = oks.some((r) => r.checkPassed !== undefined);
    const objectivePassRate =
      hasObjective && oks.length
        ? oks.filter((r) => r.checkPassed === true).length / oks.length
        : null;

    // Absolute 1–5 grades: mean overall + mean per dimension across this
    // candidate's graded outputs. Null when nothing was scored (e.g. an older
    // run, or every grade SKIPped) so the report hides the columns.
    const myScores = scores.filter((s) => s.candidate === candidate);
    const absoluteScore = myScores.length
      ? avg(myScores.map((s) => s.overall))
      : null;
    const dimensionScores: Record<string, number | null> = {};
    for (const dim of dimensions) {
      const vals = myScores
        .map((s) => s.dimensions[dim])
        .filter((v): v is number => typeof v === "number");
      dimensionScores[dim] = vals.length ? avg(vals) : null;
    }

    return {
      candidate,
      winRate,
      dimensionWinRates,
      avgCostUsd: avg(oks.map((r) => r.costUsd)),
      avgMs: avg(oks.map((r) => r.ms)),
      okRate: own.length ? oks.length / own.length : 0,
      trials,
      objectivePassRate,
      absoluteScore,
      dimensionScores,
    };
  });
}

/**
 * Run one suite end-to-end and write its report. Returns the Report so callers
 * (run-all) can aggregate across steps.
 */
export async function runSuite(suitePath: string, html: boolean): Promise<Report> {
  const suite = await loadSuite(suitePath);
  const producer: ProducerKind = suite.producer ?? "prompt";

  const rubric = await fs.readFile(path.resolve(REPO_ROOT, suite.rubricFile), "utf-8");
  // The prompt template is only meaningful for the "prompt" producer; agent and
  // codegen build their own prompts.
  let promptTpl = "";
  if (producer === "prompt") {
    if (!suite.promptFile) {
      throw new Error(`suite "${suite.suiteId}" uses producer "prompt" but has no promptFile`);
    }
    promptTpl = await fs.readFile(path.resolve(REPO_ROOT, suite.promptFile), "utf-8");
  }

  // runId is fixed up front so codegen check work dirs can nest under it.
  const generatedAt = new Date().toISOString();
  const runId = `${suite.suiteId}-${generatedAt.replace(/[:.]/g, "-")}`;
  const outDir = path.join(runsDir(), runId);

  const limit = resolveConcurrency();
  // Output reuse: when set, already-run (candidate, input, trial) cells load
  // their prior raw output instead of regenerating. Default off → identical
  // behavior to before. Judging still re-runs over ALL candidates.
  const reuse = process.env.EVAL_REUSE === "1";

  console.log(
    `\n▶ Eval "${suite.suiteId}" [${producer}] — ${suite.candidates.length} candidates × ${suite.inputs.length} inputs (concurrency ${limit}${reuse ? ", reuse ON" : ""})\n`,
  );

  const records = await runAll(suite, producer, promptTpl, outDir, limit, runId, reuse);
  console.log("\n▶ Judging (pairwise)…\n");
  const judgements = await judgeAll(suite, rubric, records, limit);
  console.log("\n▶ Scoring (absolute 1–5)…\n");
  const scores = await scoreAll(suite, rubric, records, limit);
  const scorecards = aggregate(suite, records, judgements, scores);

  const report: Report = {
    suiteId: suite.suiteId,
    step: suite.step,
    judge: suite.judge,
    generatedAt,
    candidates: suite.candidates,
    inputs: suite.inputs,
    scorecards,
    judgements,
    scores,
  };

  const rawDir = path.join(outDir, "raw");
  await fs.mkdir(rawDir, { recursive: true });

  await Promise.all(
    records
      .filter((r) => r.status === "ok")
      .map((r) =>
        fs.writeFile(
          path.join(rawDir, `${safeName(r.candidate)}__${r.inputSlug}__t${r.trial}.txt`),
          r.text,
          "utf-8",
        ),
      ),
  );

  // Per-run detail (text stripped — full outputs live in raw/). Persists single
  // -run cost/tokens and the per-run objective result (codegen tsc / taskbreakdown
  // coverage), which the aggregated scorecards otherwise only summarize.
  await fs.writeFile(
    path.join(outDir, "records.json"),
    JSON.stringify(
      records.map((r) => ({
        candidate: r.candidate,
        inputSlug: r.inputSlug,
        trial: r.trial,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        costUsd: r.costUsd,
        ms: r.ms,
        status: r.status,
        error: r.error,
        checkPassed: r.checkPassed,
        checkOutput: r.checkOutput,
      })),
      null,
      2,
    ),
    "utf-8",
  );

  const md = renderMarkdown(report);
  await fs.writeFile(path.join(outDir, "report.md"), md, "utf-8");
  await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf-8");
  if (html) {
    await fs.writeFile(path.join(outDir, "report.html"), renderHtml(report), "utf-8");
  }

  console.log(`\n${md}\n`);
  console.log(`✔ Written to runs/${runId}/${html ? " (+ report.html)" : ""}`);
  return report;
}

async function main(): Promise<void> {
  await loadEnvLocal();
  const { suite: suitePath, html } = parseArgs(process.argv.slice(2));
  await runSuite(suitePath, html);
}

// Run main() only when invoked directly (tsx eval/src/run.ts …), NOT when
// run-all.ts imports `runSuite` from this module.
const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { loadEnvLocal, aggregate, scoreAll };
