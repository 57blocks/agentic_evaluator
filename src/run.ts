/**
 * Model-eval CLI entry point + reusable `runSuite` driver.
 *
 *   pnpm run run -- --suite specs/codegen-w38.yaml --html --yes
 *   pnpm run run -- --suite suites/codegen.json  --html        (legacy JSON)
 *
 * Runs every candidate against every fixed input (× trials) through the suite's
 * producer, then has a judge pairwise-rank them and grade them 1–5. codegen
 * suites additionally run an objective `tsc --noEmit` gate.
 *
 * Two output layers land in runs/<runId>/:
 *   legacy   raw/*.txt, records.json, report.{md,json,html}  — unchanged aggregate
 *   canon    manifest.json, trace.jsonl, scores.jsonl, evaluations.jsonl,
 *            ledger.json, summary.json, GAPS.md                — protocol v0.4
 *
 * `runSuite`, `aggregate`, `scoreAll` are exported for rescore.ts / dashboard.ts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { complete, LlmError, type LlmTrace } from "./llm.js";
import { judgePair, judgePromptTemplateSha, PAIRWISE_EVALUATOR_ID, type JudgedPair } from "./judge.js";
import { scoreOne, scorePromptTemplateSha, ABSOLUTE_EVALUATOR_ID } from "./score.js";
import { checkVersion as tscCheckVersion, TSC_CHECK_ID } from "./check.js";
import { renderMarkdown, renderHtml } from "./report.js";
import { loadSuiteOrSpec } from "./spec/load-spec.js";
import { REPO_ROOT, runsDir } from "./paths.js";
import { CODEGEN_PREAMBLE, CODEGEN_PRODUCER_VERSION } from "./producers/code-gen.js";
import { sha256, short, trialHash } from "./canon/hash.js";
import { classifyCompletion } from "./canon/states.js";
import { openTrace } from "./canon/trace.js";
import { buildManifest } from "./canon/manifest.js";
import { buildLedger } from "./canon/cost.js";
import { directionality, ratesFor } from "./canon/rates.js";
import { evaluationCoverage, writeCanonBundle, writeManifest } from "./canon/write.js";
import { writeRunReport } from "./report-v2.js";
import {
  toEvaluationRows,
  toTrialRows,
  type PairFailure,
  type ScoredRecord,
  type SkippedPair,
  type TrialFailure,
} from "./canon/adapt.js";
import { EvaluatorCallError, summarizeAttempts, type EvaluatorUsage } from "./canon/usage.js";
import type { CandidateDef, CompletionState, CostSource, EvaluationState } from "./canon/types.js";
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

interface CliArgs {
  suite: string;
  html: boolean;
  yes: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let suite = "specs/codegen-w38.yaml";
  let html = false;
  let yes = process.env.EVAL_YES === "1";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--suite") suite = argv[++i];
    else if (argv[i] === "--html") html = true;
    else if (argv[i] === "--yes") yes = true;
  }
  return { suite, html, yes };
}

async function readInput(inputSlug: string): Promise<string> {
  return fs.readFile(path.join(REPO_ROOT, "inputs", `${inputSlug}.txt`), "utf-8");
}

/** Stable run id shared by the output dir and (for dashboards) reporting. */
export function reportRunId(report: Report): string {
  return `${report.suiteId}-${report.generatedAt.replace(/[:.]/g, "-")}`;
}

/** Candidate ids may be OpenRouter model ids (legacy) with `/` and `:` — make fs-safe. */
function safeName(candidate: string): string {
  return candidate.replace(/[/:]/g, "_");
}

/** Fallback max concurrent LLM calls when neither the spec nor EVAL_CONCURRENCY says. */
const DEFAULT_CONCURRENCY = 5;

function resolveConcurrency(suite: Suite): number {
  if (suite.concurrency && suite.concurrency > 0) return suite.concurrency;
  const parsed = parseInt(process.env.EVAL_CONCURRENCY ?? "", 10);
  return Number.isNaN(parsed) ? DEFAULT_CONCURRENCY : Math.max(1, parsed);
}

/**
 * Map `fn` over `items` with at most `limit` calls in flight at once. Sliding
 * window; results return in INPUT order regardless of completion order.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  };
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Candidate definition for an id; legacy suites carry none, so id = model. */
function defOf(suite: Suite, candidateId: string): CandidateDef {
  return suite.candidateDefs?.[candidateId] ?? { id: candidateId, model: candidateId, provider_route: "openrouter" };
}

/** "Claude Platform on AWS" → "claude-platform-on-aws": identifiers stay portable. */
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function deploymentRef(def: CandidateDef, provider: string | undefined): string | undefined {
  const route = def.provider_route ?? "openrouter";
  return provider ? `${route}/${slugify(provider)}` : route;
}

/** Output of a single generation (before it becomes a RunRecord). */
interface GenOutput {
  text: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  costUsd: number;
  costSource: CostSource;
  ms: number;
  provider?: string;
  finishReason?: string;
  refusal?: string;
  /** codegen: number of files parsed from the output. */
  parsedUnits?: number;
  checkPassed?: boolean;
  checkOutput?: string;
  checkState?: EvaluationState;
  checkVersion?: string;
}

async function generateOne(params: {
  suite: Suite;
  producer: ProducerKind;
  promptTpl: string;
  inputText: string;
  def: CandidateDef;
  temperature: number;
  timeoutMs: number;
  checkWorkDir: string;
  trace: LlmTrace;
  traceContext: Record<string, unknown>;
}): Promise<GenOutput> {
  const { suite, producer, promptTpl, inputText, def, temperature, timeoutMs, trace, traceContext } = params;

  if (producer === "prompt") {
    const prompt = promptTpl.replace("{{input}}", inputText);
    const r = await complete({ model: def.model, prompt, temperature, timeoutMs, trace, traceContext });
    return {
      text: r.text,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      cachedTokens: r.cachedTokens,
      costUsd: r.costUsd,
      costSource: r.costSource,
      ms: r.ms,
      provider: r.provider,
      finishReason: r.finishReason,
      refusal: r.refusal,
    };
  }

  if (producer === "agent") {
    // The real PMAgent / TRDAgent / TaskBreakdownAgent producers live in
    // agentic-builder and import its src/. Not available here; wire them back
    // through a candidate adapter later.
    throw new Error(`agent producer is not available in this repo (step "${suite.step}"); use "prompt" or "codegen"`);
  }

  // producer === "codegen"
  const { produceCode } = await import("./producers/code-gen.js");
  const r = await produceCode(inputText, def.model, { temperature, timeoutMs, trace, traceContext });
  const out: GenOutput = {
    text: r.text,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    cachedTokens: r.cachedTokens,
    costUsd: r.costUsd,
    costSource: r.costSource,
    ms: r.ms,
    provider: r.provider,
    finishReason: r.finishReason,
    refusal: r.refusal,
    parsedUnits: r.files.length,
  };
  if (suite.check) {
    const { runCheck } = await import("./check.js");
    const result = await runCheck({
      files: r.files,
      scaffoldDir: path.resolve(REPO_ROOT, suite.check.scaffoldDir),
      workDir: params.checkWorkDir,
    });
    return {
      ...out,
      checkPassed: result.passed,
      checkOutput: result.output,
      checkState: result.state,
      checkVersion: result.version,
    };
  }
  return out;
}

/** One unit of generation work in the input × candidate × trial grid. */
interface GenTask {
  inputSlug: string;
  inputText: string;
  candidate: string;
  def: CandidateDef;
  trial: number;
  hash: string;
}

interface ReusableEntry {
  candidate: string;
  inputSlug: string;
  trial: number;
}

/**
 * Find a prior generation with the SAME trial hash (producer, prompt template,
 * input, model, sampling, trial) so nothing is regenerated when only judges or
 * evaluators changed — see EVAL_REUSE. Scans runs/<step>-* newest-first and
 * requires both a matching `status:"ok"` record and its raw output file.
 */
async function loadReusable(
  step: string,
  hash: string,
  currentRunId: string,
): Promise<{ record: RunRecord; from: string } | null> {
  let dirNames: string[];
  try {
    const entries = await fs.readdir(runsDir(), { withFileTypes: true });
    dirNames = entries
      .filter((e) => e.isDirectory() && e.name.startsWith(`${step}-`) && e.name !== currentRunId)
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return null;
  }

  for (const dirName of dirNames) {
    try {
      const dir = path.join(runsDir(), dirName);
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(dir, "records.json"), "utf-8"));
      if (!Array.isArray(parsed)) continue;
      const hit = parsed.find(
        (e): e is Record<string, unknown> =>
          typeof e === "object" && e !== null && (e as Record<string, unknown>).trialHash === hash && (e as Record<string, unknown>).status === "ok",
      );
      if (!hit) continue;
      const entry = hit as unknown as ReusableEntry & Partial<RunRecord>;
      const text = await fs.readFile(
        path.join(dir, "raw", `${safeName(entry.candidate)}__${entry.inputSlug}__t${entry.trial}.txt`),
        "utf-8",
      );
      if (
        typeof entry.promptTokens !== "number" ||
        typeof entry.completionTokens !== "number" ||
        typeof entry.costUsd !== "number" ||
        typeof entry.ms !== "number"
      ) {
        continue;
      }
      return { record: { ...(entry as RunRecord), text, status: "ok" }, from: dirName };
    } catch {
      continue;
    }
  }
  return null;
}

function errorRecord(task: GenTask, err: unknown): RunRecord {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof LlmError) {
    const verdict = classifyCompletion({
      error: { kind: err.kind, httpStatus: err.httpStatus, finishReason: err.finishReason, refusal: err.refusal },
    });
    return {
      candidate: task.candidate,
      inputSlug: task.inputSlug,
      trial: task.trial,
      text: "",
      promptTokens: err.usage?.promptTokens ?? 0,
      completionTokens: err.usage?.completionTokens ?? 0,
      cachedTokens: err.usage?.cachedTokens,
      costUsd: err.usage?.costUsd ?? 0,
      costSource: err.usage?.costSource ?? "none",
      ms: err.ms,
      status: "error",
      error: message,
      modelRef: task.def.model,
      deploymentRef: deploymentRef(task.def, err.provider),
      trialHash: task.hash,
      completionState: verdict.state,
      truncated: false,
      finishReason: err.finishReason,
    };
  }
  return {
    candidate: task.candidate,
    inputSlug: task.inputSlug,
    trial: task.trial,
    text: "",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    costSource: "none",
    ms: 0,
    status: "error",
    error: message,
    modelRef: task.def.model,
    deploymentRef: deploymentRef(task.def, undefined),
    trialHash: task.hash,
    completionState: classifyCompletion({ error: { kind: "unknown" } }).state,
    truncated: false,
  };
}

/**
 * Run every candidate × input × trial, up to `limit` in parallel. Failures are
 * recorded (with whatever the provider billed), never thrown.
 */
async function runAll(params: {
  suite: Suite;
  producer: ProducerKind;
  promptTpl: string;
  promptTemplateSha: string;
  inputTextBySlug: ReadonlyMap<string, string>;
  outDir: string;
  limit: number;
  runId: string;
  reuse: boolean;
  trace: LlmTrace;
}): Promise<RunRecord[]> {
  const { suite, producer, promptTpl, promptTemplateSha, inputTextBySlug, outDir, limit, runId, reuse, trace } = params;
  const trials = suite.trials ?? 2;
  const baseTemperature = suite.temperature ?? 0.3;
  const timeoutMs = suite.timeoutMs ?? 120_000;

  const tasks: GenTask[] = [];
  for (const inputSlug of suite.inputs) {
    const inputText = inputTextBySlug.get(inputSlug) ?? "";
    for (const candidate of suite.candidates) {
      const def = defOf(suite, candidate);
      const temperature = def.generation_settings?.temperature ?? baseTemperature;
      for (let trial = 0; trial < trials; trial++) {
        tasks.push({
          inputSlug,
          inputText,
          candidate,
          def,
          trial,
          hash: trialHash({
            producer,
            producerVersion: producer === "codegen" ? CODEGEN_PRODUCER_VERSION : "1",
            promptTemplateSha,
            inputSha: sha256(inputText),
            model: def.model,
            temperature,
            maxTokens: def.generation_settings?.max_tokens,
            trial,
          }),
        });
      }
    }
  }

  return mapWithConcurrency(tasks, limit, async (task): Promise<RunRecord> => {
    const { inputSlug, inputText, candidate, def, trial } = task;
    const temperature = def.generation_settings?.temperature ?? baseTemperature;
    const checkWorkDir = path.join(outDir, "checks", `${safeName(candidate)}__${inputSlug}__t${trial}`);

    if (reuse) {
      const reused = await loadReusable(suite.step, task.hash, runId);
      if (reused) {
        console.log(`  reuse  ${candidate} · ${inputSlug} · t${trial}  ← ${reused.from}`);
        return { ...reused.record, candidate, inputSlug, trial, reusedFrom: reused.from };
      }
    }

    try {
      const g = await generateOne({
        suite,
        producer,
        promptTpl,
        inputText,
        def,
        temperature,
        timeoutMs,
        checkWorkDir,
        trace,
        traceContext: { phase: "generation", candidate, model: def.model, input: inputSlug, trial },
      });
      const verdict = classifyCompletion({ finishReason: g.finishReason, refusal: g.refusal, parsedUnits: g.parsedUnits });
      const checkTag = g.checkState === undefined ? "" : ` · tsc ${g.checkState}`;
      console.log(
        `  ${verdict.state.padEnd(8)} ${candidate} · ${inputSlug} · t${trial} (${(g.ms / 1000).toFixed(1)}s, $${g.costUsd.toFixed(4)} ${g.costSource})${checkTag}`,
      );
      return {
        candidate,
        inputSlug,
        trial,
        text: g.text,
        promptTokens: g.promptTokens,
        completionTokens: g.completionTokens,
        cachedTokens: g.cachedTokens,
        costUsd: g.costUsd,
        costSource: g.costSource,
        ms: g.ms,
        status: "ok",
        checkPassed: g.checkPassed,
        checkOutput: g.checkOutput,
        checkState: g.checkState,
        checkVersion: g.checkVersion,
        modelRef: def.model,
        deploymentRef: deploymentRef(def, g.provider),
        trialHash: task.hash,
        completionState: verdict.state,
        truncated: verdict.truncated,
        finishReason: g.finishReason,
      };
    } catch (err) {
      const rec = errorRecord(task, err);
      console.log(`  ${(rec.completionState ?? "error").padEnd(8)} ${candidate} · ${inputSlug} · t${trial}: ${rec.error}`);
      return rec;
    }
  });
}

/** First successful output for a (candidate, input) pair, if any. */
function representative(records: readonly RunRecord[], candidate: string, inputSlug: string): string | null {
  const hit = records.find((r) => r.candidate === candidate && r.inputSlug === inputSlug && r.status === "ok" && r.text.trim() !== "");
  return hit ? hit.text : null;
}

interface JudgeTask {
  inputSlug: string;
  a: string;
  aText: string;
  b: string;
  bText: string;
}

interface JudgeOutcome {
  judgements: JudgedPair[];
  failures: PairFailure[];
  skipped: SkippedPair[];
}

function usageOfError(err: unknown): EvaluatorUsage {
  return err instanceof EvaluatorCallError ? summarizeAttempts(err.attempts) : summarizeAttempts([]);
}

/**
 * Pairwise judge every candidate pair, per input. A failed judge call is kept
 * as an evaluator_error (with its cost) instead of vanishing; a pair where one
 * side produced no output is recorded as not_evaluated.
 */
async function judgeAll(suite: Suite, rubric: string, records: readonly RunRecord[], limit: number, trace: LlmTrace): Promise<JudgeOutcome> {
  const tasks: JudgeTask[] = [];
  const skipped: SkippedPair[] = [];
  for (const inputSlug of suite.inputs) {
    for (let i = 0; i < suite.candidates.length; i++) {
      for (let j = i + 1; j < suite.candidates.length; j++) {
        const a = suite.candidates[i];
        const b = suite.candidates[j];
        const aText = representative(records, a, inputSlug);
        const bText = representative(records, b, inputSlug);
        if (!aText || !bText) {
          const missing = [!aText ? a : null, !bText ? b : null].filter((x): x is string => x !== null);
          skipped.push({ input: inputSlug, a, b, reason: `no successful output from ${missing.join(" and ")}` });
          continue;
        }
        tasks.push({ inputSlug, a, aText, b, bText });
      }
    }
  }

  const failures: PairFailure[] = [];
  const results = await mapWithConcurrency(tasks, limit, async (task): Promise<JudgedPair | null> => {
    console.log(`  judge  ${task.a} vs ${task.b} · ${task.inputSlug}`);
    try {
      return await judgePair({
        judgeModel: suite.judge,
        timeoutMs: suite.timeoutMs ?? 240_000,
        rubric,
        dimensions: suite.dimensions ?? [],
        inputSlug: task.inputSlug,
        a: task.a,
        aText: task.aText,
        b: task.b,
        bText: task.bText,
        trace,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  judge EVALUATOR_ERROR  ${task.a} vs ${task.b} · ${task.inputSlug}: ${message}`);
      failures.push({ input: task.inputSlug, a: task.a, b: task.b, message, usage: usageOfError(err) });
      return null;
    }
  });
  return { judgements: results.filter((j): j is JudgedPair => j !== null), failures, skipped };
}

export interface ScoreHooks {
  trace?: LlmTrace;
  onScored?: (record: ScoredRecord) => void;
  onFailure?: (failure: TrialFailure) => void;
}

/**
 * Absolute 1–5 grade for every OK output. Returns plain ScoreRecords so
 * `aggregate` and rescore.ts are unchanged; usage and failures flow through hooks.
 */
async function scoreAll(
  suite: Suite,
  rubric: string,
  records: readonly RunRecord[],
  limit: number,
  hooks: ScoreHooks = {},
): Promise<ScoreRecord[]> {
  const dimensions = suite.dimensions ?? [];
  const oks = records.filter((r) => r.status === "ok" && r.text.trim());
  const results = await mapWithConcurrency(oks, limit, async (r): Promise<ScoreRecord | null> => {
    console.log(`  score  ${r.candidate} · ${r.inputSlug} · t${r.trial}`);
    try {
      const s = await scoreOne({
        judgeModel: suite.judge,
        rubric,
        dimensions,
        text: r.text,
        timeoutMs: suite.timeoutMs ?? 240_000,
        trace: hooks.trace,
        traceContext: { candidate: r.candidate, input: r.inputSlug, trial: r.trial },
      });
      const scored: ScoredRecord = {
        candidate: r.candidate,
        inputSlug: r.inputSlug,
        trial: r.trial,
        dimensions: s.dimensions,
        overall: s.overall,
        usage: s.usage,
      };
      hooks.onScored?.(scored);
      const { usage: _usage, ...plain } = scored;
      return plain;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  score EVALUATOR_ERROR  ${r.candidate} · ${r.inputSlug} · t${r.trial}: ${message}`);
      hooks.onFailure?.({ candidate: r.candidate, input: r.inputSlug, trial: r.trial, message, usage: usageOfError(err) });
      return null;
    }
  });
  return results.filter((s): s is ScoreRecord => s !== null);
}

/**
 * Win rate (0..100, tie = 0.5) for one candidate on one axis, or null when it
 * had no comparisons on that axis.
 */
function winRateFor(candidate: string, judgements: readonly Judgement[], pick: (jm: Judgement) => Winner | undefined): number | null {
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

/** Legacy aggregate — semantics unchanged from the original harness. */
function aggregate(suite: Suite, records: readonly RunRecord[], judgements: readonly Judgement[], scores: readonly ScoreRecord[] = []): Scorecard[] {
  const trials = suite.trials ?? 2;
  const dimensions = suite.dimensions ?? [];
  return suite.candidates.map((candidate) => {
    const own = records.filter((r) => r.candidate === candidate);
    const oks = own.filter((r) => r.status === "ok");
    const winRate = winRateFor(candidate, judgements, (jm) => jm.overall.resolved);
    const dimensionWinRates: Record<string, number | null> = {};
    for (const dim of dimensions) {
      dimensionWinRates[dim] = winRateFor(candidate, judgements, (jm) => jm.dimensions[dim]?.resolved);
    }
    const avg = (nums: number[]): number => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0);
    const hasObjective = oks.some((r) => r.checkPassed !== undefined);
    const objectivePassRate = hasObjective && oks.length ? oks.filter((r) => r.checkPassed === true).length / oks.length : null;
    const myScores = scores.filter((s) => s.candidate === candidate);
    const absoluteScore = myScores.length ? avg(myScores.map((s) => s.overall)) : null;
    const dimensionScores: Record<string, number | null> = {};
    for (const dim of dimensions) {
      const vals = myScores.map((s) => s.dimensions[dim]).filter((v): v is number => typeof v === "number");
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

interface RunPlan {
  generations: number;
  pairs: number;
  judgeCalls: number;
  scoreCalls: number;
}

function planRun(suite: Suite): RunPlan {
  const c = suite.candidates.length;
  const i = suite.inputs.length;
  const t = suite.trials ?? 2;
  const pairs = (i * c * (c - 1)) / 2;
  return { generations: c * i * t, pairs, judgeCalls: pairs * 2, scoreCalls: c * i * t };
}

function printPreview(suite: Suite, plan: RunPlan, limit: number, reuse: boolean): void {
  console.log(`\n▶ ${suite.suiteId} [${suite.producer ?? "prompt"}] — ${suite.candidates.length} candidates × ${suite.inputs.length} inputs × ${suite.trials ?? 2} trials`);
  console.log(`  generations ${plan.generations} · pairwise ${plan.pairs} pairs (${plan.judgeCalls} judge calls, up to 3 attempts each) · absolute ${plan.scoreCalls} calls`);
  console.log(`  judge ${suite.judge} · concurrency ${limit}${reuse ? " · reuse ON" : ""}${suite.budgetUsd !== undefined ? ` · budget $${suite.budgetUsd}` : ""}`);
  console.log(`  benchmark ${suite.benchmarkMode ?? "capability-neutral"} · cache ${suite.cacheMode ?? "cold"} · directional ${suite.inputs.length < 10 || suite.mmd == null ? "yes" : "no"}\n`);
}

/**
 * Run one suite end-to-end and write both output layers. Returns the legacy
 * Report so dashboards can aggregate across steps.
 */
export async function runSuite(suitePath: string, html: boolean, opts: { yes?: boolean } = {}): Promise<Report | null> {
  const suite = await loadSuiteOrSpec(suitePath);
  const producer: ProducerKind = suite.producer ?? "prompt";
  const isSpec = /\.ya?ml$/i.test(suitePath);

  const rubric = await fs.readFile(path.resolve(REPO_ROOT, suite.rubricFile), "utf-8");
  let promptTpl = "";
  if (producer === "prompt") {
    if (!suite.promptFile) throw new Error(`suite "${suite.suiteId}" uses producer "prompt" but has no promptFile`);
    promptTpl = await fs.readFile(path.resolve(REPO_ROOT, suite.promptFile), "utf-8");
  }
  const promptTemplateSha = producer === "prompt" ? sha256(promptTpl) : sha256(CODEGEN_PREAMBLE);

  const inputTextBySlug = new Map<string, string>();
  const inputShas: Record<string, string> = {};
  for (const slug of suite.inputs) {
    const text = await readInput(slug);
    inputTextBySlug.set(slug, text);
    inputShas[slug] = sha256(text);
  }

  const limit = resolveConcurrency(suite);
  const reuse = process.env.EVAL_REUSE === "1";
  const plan = planRun(suite);
  printPreview(suite, plan, limit, reuse);
  if (isSpec && !opts.yes) {
    console.log("Preview only. Re-run with --yes (or EVAL_YES=1) to execute.");
    return null;
  }

  const generatedAt = new Date().toISOString();
  const runId = `${suite.suiteId}-${generatedAt.replace(/[:.]/g, "-")}`;
  const outDir = path.join(runsDir(), runId);
  await fs.mkdir(outDir, { recursive: true });

  const trace = await openTrace(outDir, runId);
  const dimensions = suite.dimensions ?? [];
  const rubricSha = sha256(rubric);
  const judgeTplSha = judgePromptTemplateSha(rubric, dimensions);
  const scoreTplSha = scorePromptTemplateSha(rubric, dimensions);
  const checkVersion = suite.check ? await tscCheckVersion(path.resolve(REPO_ROOT, suite.check.scaffoldDir)) : null;
  const manifest = await buildManifest(suite, {
    runId,
    startedAt: generatedAt,
    concurrency: limit,
    inputShas,
    rubricSha,
    producerTemplateSha: promptTemplateSha,
    judgeTemplateSha: judgeTplSha,
    scoreTemplateSha: scoreTplSha,
    checkVersion,
  });
  await writeManifest(outDir, manifest);

  const records = await runAll({ suite, producer, promptTpl, promptTemplateSha, inputTextBySlug, outDir, limit, runId, reuse, trace: trace.emit });
  console.log("\n▶ Judging (pairwise)…\n");
  const judged = await judgeAll(suite, rubric, records, limit, trace.emit);
  console.log("\n▶ Scoring (absolute 1–5)…\n");
  const scored: ScoredRecord[] = [];
  const scoreFailures: TrialFailure[] = [];
  const scores = await scoreAll(suite, rubric, records, limit, {
    trace: trace.emit,
    onScored: (s) => scored.push(s),
    onFailure: (f) => scoreFailures.push(f),
  });
  const scorecards = aggregate(suite, records, judged.judgements, scores);

  const report: Report = {
    suiteId: suite.suiteId,
    step: suite.step,
    judge: suite.judge,
    generatedAt,
    candidates: suite.candidates,
    inputs: suite.inputs,
    scorecards,
    judgements: judged.judgements.map(({ usage: _usage, ...j }) => j),
    scores,
  };

  // ── legacy layer ──
  const rawDir = path.join(outDir, "raw");
  await fs.mkdir(rawDir, { recursive: true });
  await Promise.all(
    records
      .filter((r) => r.text.trim() !== "")
      .map((r) => fs.writeFile(path.join(rawDir, `${safeName(r.candidate)}__${r.inputSlug}__t${r.trial}.txt`), r.text, "utf-8")),
  );
  await fs.writeFile(
    path.join(outDir, "records.json"),
    JSON.stringify(records.map(({ text: _text, ...rest }) => rest), null, 2),
    "utf-8",
  );
  const md = renderMarkdown(report);
  await fs.writeFile(path.join(outDir, "report.md"), md, "utf-8");
  await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf-8");
  if (html) await fs.writeFile(path.join(outDir, "legacy-report.html"), renderHtml(report), "utf-8");

  // ── canonical layer ──
  const adaptInput = {
    runId,
    step: suite.step,
    requiredChecks: suite.requiredChecks ?? [],
    successCriteria: suite.successCriteria,
    checkId: TSC_CHECK_ID,
    pairwiseId: PAIRWISE_EVALUATOR_ID,
    absoluteId: ABSOLUTE_EVALUATOR_ID,
    versions: {
      check: checkVersion,
      pairwise: `${suite.judge}+rubric-${short(rubricSha)}+tpl-${short(judgeTplSha)}`,
      absolute: `${suite.judge}+rubric-${short(rubricSha)}+tpl-${short(scoreTplSha)}`,
    },
    records,
    judgements: judged.judgements,
    judgeFailures: judged.failures,
    skippedPairs: judged.skipped,
    scores: scored,
    scoreFailures,
  };
  const trials = toTrialRows(adaptInput);
  const evaluations = toEvaluationRows(adaptInput);
  const ledger = buildLedger(trials, evaluations, PAIRWISE_EVALUATOR_ID, ABSOLUTE_EVALUATOR_ID);
  const summary = {
    run: runId,
    step: suite.step,
    inputs: suite.inputs,
    candidates: suite.candidates.map((c) => ratesFor(c, trials)),
    directionality: directionality(suite.inputs.length, suite.mmd),
    evaluation_coverage: evaluationCoverage(evaluations),
  };
  const traceRows = await trace.close();
  await writeCanonBundle(outDir, {
    manifest: { ...manifest, finished_at: new Date().toISOString() },
    trials,
    evaluations,
    ledger,
    summary,
  });
  if (html) await writeRunReport(outDir);

  console.log(`\n${md}\n`);
  console.log(
    `✔ runs/${runId}/ — ${trials.length} trials, ${evaluations.length} evaluator rows, ${traceRows} trace events, ledger total $${ledger.total.toFixed(4)} (${ledger.source})${html ? ", legacy-report.html" : ""}`,
  );
  return report;
}

async function main(): Promise<void> {
  await loadEnvLocal();
  const args = parseArgs(process.argv.slice(2));
  await runSuite(args.suite, args.html, { yes: args.yes });
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

export { loadEnvLocal, aggregate, scoreAll };
