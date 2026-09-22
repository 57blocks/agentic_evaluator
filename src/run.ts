/**
 * Model-eval CLI entry point + reusable `runSuite` driver.
 *
 *   pnpm run run -- --suite tasks/codegen-w38/spec.yaml --html --yes
 *   pnpm run run -- --suite suites/codegen.json          --html   (legacy JSON)
 *
 * Runs every candidate against every fixed input (× trials) through a
 * candidate adapter (model-api, codegen, or agent-cli), then has a judge
 * pairwise-rank them and grade them 1–5. Suites with a tsc required check
 * still run `tsc --noEmit` on returned artifacts.
 *
 * Two output layers land in the task's runs/<runId>/:
 *   legacy   raw/*.txt, records.json, report.{md,json,html}  — unchanged aggregate
 *   canon    manifest.json, trace.jsonl, scores.jsonl, evaluations.jsonl,
 *            ledger.json, summary.json, GAPS.md                — protocol v0.4
 *
 * `runSuite`, `aggregate`, `scoreAll` are exported for rescore.ts / dashboard.ts.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LlmError, type LlmTrace } from "./llm.js";
import { AdapterError, adapterFor, modelRefOf, trialAdapterFields } from "./adapters/resolve.js";
import type { ArtifactFile } from "./adapters/types.js";
import { deliverableText, parsedUnitsFor } from "./adapters/deliverable.js";
import { judgePair, judgePromptTemplateSha, PAIRWISE_EVALUATOR_ID, type JudgedPair } from "./judge.js";
import { scoreOne, scorePromptTemplateSha, ABSOLUTE_EVALUATOR_ID } from "./score.js";
import { checkVersion as tscCheckVersion, commandCheckVersion, TSC_CHECK_ID } from "./check.js";
import { renderMarkdown, renderHtml } from "./report.js";
import { loadSuites } from "./spec/load-spec.js";
import {
  decideValidation,
  orderControlChain,
  pairCases,
  proposedAssignment,
  sameAssignment,
  type E2eValidation,
  type StepAssignment,
  type ValidationArm,
  type ValidationThresholds,
} from "./canon/e2e.js";
import {
  constantAssignment,
  runChainArm,
  runControlChain,
  type E2eArmGenerate,
  type E2eArmReport,
  type E2eControlReport,
} from "./e2e-control.js";
import { INSTALL_ROOT, displayPath, taskInputPath, taskRootOf, resolveTaskAsset } from "./paths.js";
import { listRunDirs, runsRootFor, workspaceForSpec, type Workspace } from "./core/workspace.js";
import { CODEGEN_PREAMBLE, CODEGEN_PRODUCER_VERSION } from "./producers/code-gen.js";
import { sha256, short, trialHash } from "./canon/hash.js";
import { classifyCompletion } from "./canon/states.js";
import { openTrace, traceIntegrity } from "./canon/trace.js";
import { buildManifest } from "./canon/manifest.js";
import { buildLedger, type CostLedger } from "./canon/cost.js";
import { BudgetGuard, budgetGap } from "./canon/budget.js";
import { buildWorkflowRecord, workflowGaps, type WorkflowStepInput } from "./canon/workflow.js";
import { directionality, ratesFor } from "./canon/rates.js";
import { judgeDiscrimination } from "./canon/discrimination.js";
import { evaluationCoverage, writeCanonBundle, writeManifest } from "./canon/write.js";
import { resolveEligibility, type Recommendation } from "./canon/select.js";
import { writeRunReport } from "./report-v2.js";
import { writeWorkflowReport } from "./report-workflow.js";
import {
  toEvaluationRows,
  toTrialRows,
  type PairFailure,
  type ScoredRecord,
  type SkippedPair,
  type TrialFailure,
} from "./canon/adapt.js";
import { EvaluatorCallError, summarizeAttempts, type EvaluatorUsage } from "./canon/usage.js";
import type {
  CandidateDef,
  CompletionState,
  CostSource,
  EligibilityThresholds,
  EvaluationState,
} from "./canon/types.js";
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

/**
 * Load KEY=VALUE lines from .env.local into process.env (no dependency).
 *
 * The working directory first, then the installation: a user running the tool
 * against their own workspace keeps their key next to their work, and the
 * checkout's own .env.local still works when you are standing in it. An
 * ambient variable always wins over both.
 */
async function loadEnvLocal(dirs: readonly string[] = [process.cwd(), INSTALL_ROOT]): Promise<void> {
  for (const dir of dirs) await loadEnvFile(path.join(dir, ".env.local"));
}

async function loadEnvFile(file: string): Promise<void> {
  try {
    const raw = await fs.readFile(file, "utf-8");
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
  let suite = "tasks/codegen-w38/spec.yaml";
  let html = false;
  let yes = process.env.EVAL_YES === "1";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--suite") suite = argv[++i];
    else if (argv[i] === "--html") html = true;
    else if (argv[i] === "--yes") yes = true;
  }
  return { suite, html, yes };
}

/** A task's input text. Every task owns its inputs; there is no shared pool. */
async function readInput(inputSlug: string, taskRoot: string | undefined): Promise<string> {
  return fs.readFile(taskInputPath(taskRoot, inputSlug), "utf-8");
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
  return (
    suite.candidateDefs?.[candidateId] ?? {
      id: candidateId,
      model: candidateId,
      provider_route: "openrouter",
      adapter: "model-api",
    }
  );
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
  retryCostUsd?: number;
  transportRetries?: number;
  costSource: CostSource;
  ms: number;
  provider?: string;
  finishReason?: string;
  refusal?: string;
  /** codegen: number of files parsed from the output. */
  parsedUnits?: number;
  artifacts: ArtifactFile[];
  checkPassed?: boolean;
  checkOutput?: string;
  checkState?: EvaluationState;
  checkVersion?: string;
}

async function generateOne(params: {
  suite: Suite;
  producer: ProducerKind;
  promptTpl: string;
  inputSlug: string;
  inputText: string;
  def: CandidateDef;
  temperature: number;
  timeoutMs: number;
  checkWorkDir: string;
  trace: LlmTrace;
  traceContext: Record<string, unknown>;
}): Promise<GenOutput> {
  const { suite, producer, promptTpl, inputSlug, inputText, def, temperature, timeoutMs, trace, traceContext } = params;
  const adapter = adapterFor(def, producer);
  const result = await adapter.execute(
    {
      stepId: suite.step,
      candidateId: def.id,
      inputId: inputSlug,
      inputText,
      promptTemplate: promptTpl,
      temperature,
      timeoutMs,
      model: def.model,
      maxTokens: def.generation_settings?.max_tokens,
      cli: def.cli,
    },
    { workDir: params.checkWorkDir, taskRoot: taskRootOf(suite), emit: trace, traceContext },
  );
  const out: GenOutput = {
    ...result,
    text: deliverableText(adapter.id, result.text, result.artifacts),
    parsedUnits: parsedUnitsFor(adapter.id, result.artifacts, suite.check !== undefined),
  };
  if (!suite.check) return out;
  const { runCheck, runCommandCheck } = await import("./check.js");
  const check =
    suite.check.kind === "tsc"
      ? await runCheck({
          files: result.artifacts,
          scaffoldDir: await resolveTaskAsset(taskRootOf(suite), suite.check.scaffoldDir),
          workDir: params.checkWorkDir,
        })
      : await runCommandCheck({
          argv: suite.check.argv,
          versionFiles: suite.check.versionFiles,
          taskRoot: taskRootOf(suite),
          timeoutMs: suite.check.timeoutMs,
          files: result.artifacts,
          output: out.text,
          input: params.inputText,
          meta: {
            step: suite.step,
            candidate: params.def.id,
            input: params.inputSlug,
            trial: Number(params.traceContext.trial ?? 0),
          },
          workDir: params.checkWorkDir,
        });
  return {
    ...out,
    checkPassed: check.passed,
    checkOutput: check.output,
    checkState: check.state,
    checkVersion: check.version,
  };
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
  ws: Workspace,
): Promise<{ record: RunRecord; from: string } | null> {
  // Every task's runs, not just this one's: `trialHash` is content-addressed,
  // so a generation produced under another task is the same generation. Nine
  // specs share `code-utils`; scanning per-task only would re-buy it per task.
  const candidates = (await listRunDirs(ws))
    .filter((e) => e.name.startsWith(`${step}-`) && e.name !== currentRunId)
    .sort((a, b) => b.name.localeCompare(a.name));

  for (const { dir } of candidates) {
    try {
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
      return { record: { ...(entry as RunRecord), text, status: "ok" }, from: displayPath(dir) };
    } catch {
      continue;
    }
  }
  return null;
}

function errorRecord(task: GenTask, err: unknown): RunRecord {
  const message = err instanceof Error ? err.message : String(err);
  const shared = {
    candidate: task.candidate,
    inputSlug: task.inputSlug,
    trial: task.trial,
    text: "",
    status: "error" as const,
    error: message,
    modelRef: modelRefOf(task.def),
    trialHash: task.hash,
    truncated: false,
  };
  if (err instanceof LlmError) {
    const verdict = classifyCompletion({
      error: { kind: err.kind, httpStatus: err.httpStatus, finishReason: err.finishReason, refusal: err.refusal },
    });
    return {
      ...shared,
      promptTokens: err.usage?.promptTokens ?? 0,
      completionTokens: err.usage?.completionTokens ?? 0,
      cachedTokens: err.usage?.cachedTokens,
      costUsd: err.usage?.costUsd ?? 0,
      retryCostUsd: err instanceof LlmError ? err.retryCostUsd : undefined,
      transportRetries: err instanceof LlmError ? err.transportRetries : undefined,
      costSource: err.usage?.costSource ?? "none",
      ms: err.ms,
      deploymentRef: deploymentRef(task.def, err.provider),
      completionState: verdict.state,
      finishReason: err.finishReason,
    };
  }
  const kind = err instanceof AdapterError ? err.kind : "unknown";
  const verdict = classifyCompletion({ error: { kind } });
  return {
    ...shared,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    costSource: "none",
    ms: err instanceof AdapterError ? err.ms : 0,
    deploymentRef: deploymentRef(task.def, undefined),
    completionState: verdict.state,
  };
}

/**
 * Run every candidate × input × trial, up to `limit` in parallel. Failures are
 * recorded (with whatever the provider billed), never thrown.
 */
async function runAll(params: {
  suite: Suite;
  /** Workspace scanned for a reusable generation. */
  ws: Workspace;
  producer: ProducerKind;
  promptTpl: string;
  promptTemplateSha: string;
  inputTextBySlug: ReadonlyMap<string, string>;
  outDir: string;
  limit: number;
  runId: string;
  reuse: boolean;
  trace: LlmTrace;
  budget: BudgetGuard;
}): Promise<RunRecord[]> {
  const { suite, producer, promptTpl, promptTemplateSha, inputTextBySlug, outDir, limit, runId, reuse, trace, budget } = params;
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
            model: modelRefOf(def),
            temperature,
            maxTokens: def.generation_settings?.max_tokens,
            trial,
            ...trialAdapterFields(def, producer),
          }),
        });
      }
    }
  }

  const done = await mapWithConcurrency(tasks, limit, async (task): Promise<RunRecord | null> => {
    const { inputSlug, inputText, candidate, def, trial } = task;
    const temperature = def.generation_settings?.temperature ?? baseTemperature;
    const checkWorkDir = path.join(outDir, "checks", `${safeName(candidate)}__${inputSlug}__t${trial}`);

    if (reuse) {
      const reused = await loadReusable(suite.step, task.hash, runId, params.ws);
      if (reused) {
        console.log(`  reuse  ${candidate} · ${inputSlug} · t${trial}  ← ${reused.from}`);
        return { ...reused.record, candidate, inputSlug, trial, reusedFrom: reused.from };
      }
    }

    // Protocol §7: stop cleanly on the limit. The unit is counted as not run,
    // not recorded as a candidate failure — the candidate never got a turn.
    if (!budget.allows("generation")) {
      console.log(`  skip   ${candidate} · ${inputSlug} · t${trial} — budget limit reached`);
      return null;
    }

    try {
      const g = await generateOne({
        suite,
        producer,
        promptTpl,
        inputSlug,
        inputText,
        def,
        temperature,
        timeoutMs,
        checkWorkDir,
        trace,
        traceContext: { phase: "generation", candidate, model: modelRefOf(def), input: inputSlug, trial },
      });
      budget.add(g.costUsd + (g.retryCostUsd ?? 0));
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
        retryCostUsd: g.retryCostUsd,
        transportRetries: g.transportRetries,
        costSource: g.costSource,
        ms: g.ms,
        status: "ok",
        checkPassed: g.checkPassed,
        checkOutput: g.checkOutput,
        checkState: g.checkState,
        checkVersion: g.checkVersion,
        modelRef: modelRefOf(def),
        deploymentRef: deploymentRef(def, g.provider),
        trialHash: task.hash,
        completionState: verdict.state,
        truncated: verdict.truncated,
        finishReason: g.finishReason,
      };
    } catch (err) {
      const rec = errorRecord(task, err);
      budget.add(rec.costUsd + (rec.retryCostUsd ?? 0));
      console.log(`  ${(rec.completionState ?? "error").padEnd(8)} ${candidate} · ${inputSlug} · t${trial}: ${rec.error}`);
      return rec;
    }
  });

  return done.filter((r): r is RunRecord => r !== null);
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
async function judgeAll(
  suite: Suite,
  rubric: string,
  records: readonly RunRecord[],
  limit: number,
  trace: LlmTrace,
  budget: BudgetGuard,
): Promise<JudgeOutcome> {
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
    if (!budget.allows("judging")) {
      skipped.push({ input: task.inputSlug, a: task.a, b: task.b, reason: "budget limit reached before this pair was judged" });
      return null;
    }
    console.log(`  judge  ${task.a} vs ${task.b} · ${task.inputSlug}`);
    try {
      const judged = await judgePair({
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
      budget.add(judged.usage?.costUsd ?? 0);
      return judged;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      budget.add(usageOfError(err).costUsd);
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
  budget?: BudgetGuard,
): Promise<ScoreRecord[]> {
  const dimensions = suite.dimensions ?? [];
  const oks = records.filter((r) => r.status === "ok" && r.text.trim());
  const results = await mapWithConcurrency(oks, limit, async (r): Promise<ScoreRecord | null> => {
    if (budget && !budget.allows("scoring")) return null;
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
        reasons: s.reasons,
        usage: s.usage,
      };
      budget?.add(s.usage.costUsd + s.usage.retryCostUsd);
      hooks.onScored?.(scored);
      const { usage: _usage, ...plain } = scored;
      return plain;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  score EVALUATOR_ERROR  ${r.candidate} · ${r.inputSlug} · t${r.trial}: ${message}`);
      const failureUsage = usageOfError(err);
      budget?.add(failureUsage.costUsd + failureUsage.retryCostUsd);
      hooks.onFailure?.({ candidate: r.candidate, input: r.inputSlug, trial: r.trial, message, usage: failureUsage });
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

/** Methods the step declared; both when the spec is silent (legacy suites). */
function methodsOf(suite: Suite): { pairwise: boolean; absolute: boolean } {
  const declared = suite.judgeMethods ?? ["pairwise-swap", "absolute-1-5"];
  return { pairwise: declared.includes("pairwise-swap"), absolute: declared.includes("absolute-1-5") };
}

function planRun(suite: Suite): RunPlan {
  const c = suite.candidates.length;
  const i = suite.inputs.length;
  const t = suite.trials ?? 2;
  const { pairwise, absolute } = methodsOf(suite);
  const pairs = pairwise ? (i * c * (c - 1)) / 2 : 0;
  return { generations: c * i * t, pairs, judgeCalls: pairs * 2, scoreCalls: absolute ? c * i * t : 0 };
}

function printPreview(suite: Suite, plan: RunPlan, limit: number, reuse: boolean): void {
  console.log(`\n▶ ${suite.suiteId} / ${suite.step} [${suite.producer ?? "prompt"}] — ${suite.candidates.length} candidates × ${suite.inputs.length} inputs × ${suite.trials ?? 2} trials`);
  const { pairwise, absolute } = methodsOf(suite);
  console.log(
    `  generations ${plan.generations} · pairwise ${pairwise ? `${plan.pairs} pairs (${plan.judgeCalls} judge calls, up to 3 attempts each)` : "off"} · absolute ${absolute ? `${plan.scoreCalls} calls` : "off"}`,
  );
  console.log(`  judge ${suite.judge} · concurrency ${limit}${reuse ? " · reuse ON" : ""}${suite.budgetUsd !== undefined ? ` · budget $${suite.budgetUsd}` : ""}`);
  console.log(`  benchmark ${suite.benchmarkMode ?? "capability-neutral"} · cache ${suite.cacheMode ?? "cold"} · directional ${suite.inputs.length < 10 || suite.mmd == null ? "yes" : "no"}`);
}

function e2eChain(suites: Suite[]): Suite[] | null {
  const ids = orderControlChain(suites.map((s) => ({ id: s.step, inputFrom: s.inputFrom })));
  if (!ids) return null;
  const byId = new Map(suites.map((s) => [s.step, s]));
  return ids.map((id) => byId.get(id)!);
}

function printE2ePreview(suites: Suite[]): void {
  const chain = e2eChain(suites);
  if (!chain) return;
  const root = chain[0];
  const trials = root.trials ?? 2;
  const perArm = root.inputs.length * trials * chain.length;
  console.log(
    `\n  e2e control ${root.controlCandidate}: ${chain.map((s) => s.step).join(" → ")} · ${root.inputs.length} cases × ${trials} trials × ${chain.length} steps = ${perArm} generations (no judge)`,
  );
  console.log(
    `  e2e validation: one more arm of ${perArm} generations if the step recommendations propose a combination other than the control — up to ${perArm * 2} in total\n`,
  );
}

async function loadPromptTemplate(
  suite: Suite,
  producer: ProducerKind,
): Promise<{ promptTpl: string; promptTemplateSha: string }> {
  if (producer !== "prompt") {
    return { promptTpl: "", promptTemplateSha: sha256(CODEGEN_PREAMBLE) };
  }
  if (!suite.promptFile) {
    throw new Error(`suite "${suite.suiteId}" step "${suite.step}" uses producer "prompt" but has no promptFile`);
  }
  const promptTpl = await fs.readFile(await resolveTaskAsset(taskRootOf(suite), suite.promptFile), "utf-8");
  return { promptTpl, promptTemplateSha: sha256(promptTpl) };
}

async function executeSuite(params: {
  suite: Suite;
  ws: Workspace;
  outDir: string;
  runId: string;
  html: boolean;
  reuse: boolean;
  generatedAt: string;
  /** Shared across the steps of a multi-step run; one spec, one limit. */
  budget?: BudgetGuard;
}): Promise<{ report: Report; recommendation: Recommendation; trials: number; ledgerTotal: number; ledger: CostLedger }> {
  const { suite, outDir, runId, html, reuse, generatedAt } = params;
  const producer: ProducerKind = suite.producer ?? "prompt";
  const rubric = await fs.readFile(await resolveTaskAsset(taskRootOf(suite), suite.rubricFile), "utf-8");
  const { promptTpl, promptTemplateSha } = await loadPromptTemplate(suite, producer);

  const inputTextBySlug = new Map<string, string>();
  const inputShas: Record<string, string> = {};
  for (const slug of suite.inputs) {
    const text = await readInput(slug, taskRootOf(suite));
    inputTextBySlug.set(slug, text);
    inputShas[slug] = sha256(text);
  }

  const limit = resolveConcurrency(suite);
  await fs.mkdir(outDir, { recursive: true });

  const trace = await openTrace(outDir, runId);
  const dimensions = suite.dimensions ?? [];
  const rubricSha = sha256(rubric);
  const judgeTplSha = judgePromptTemplateSha(rubric, dimensions);
  const scoreTplSha = scorePromptTemplateSha(rubric, dimensions);
  const checkVersion = !suite.check
    ? null
    : suite.check.kind === "tsc"
      ? await tscCheckVersion(await resolveTaskAsset(taskRootOf(suite), suite.check.scaffoldDir))
      : await commandCheckVersion(suite.check.argv, suite.check.versionFiles, taskRootOf(suite));
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

  const budget = params.budget ?? new BudgetGuard(suite.budgetUsd);
  const records = await runAll({ suite, ws: params.ws, producer, promptTpl, promptTemplateSha, inputTextBySlug, outDir, limit, runId, reuse, trace: trace.emit, budget });
  const methods = methodsOf(suite);
  const judged = methods.pairwise
    ? (console.log("\n▶ Judging (pairwise)…\n"), await judgeAll(suite, rubric, records, limit, trace.emit, budget))
    : (console.log("\n▶ Judging (pairwise) — off by spec\n"), { judgements: [], failures: [], skipped: [] });
  if (methods.absolute) console.log("\n▶ Scoring (absolute 1–5)…\n");
  else console.log("\n▶ Scoring (absolute 1–5) — off by spec\n");
  const scored: ScoredRecord[] = [];
  const scoreFailures: TrialFailure[] = [];
  const scores = methods.absolute
    ? await scoreAll(
        suite,
        rubric,
        records,
        limit,
        {
          trace: trace.emit,
          onScored: (s) => scored.push(s),
          onFailure: (f) => scoreFailures.push(f),
        },
        budget,
      )
    : [];
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

  const adaptInput = {
    runId,
    step: suite.step,
    requiredChecks: suite.requiredChecks ?? [],
    successCriteria: suite.successCriteria,
    checkId: suite.check?.id ?? TSC_CHECK_ID,
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
  const traceRows = await trace.close();
  const integrity = await traceIntegrity(trace.file);
  const summary = {
    run: runId,
    step: suite.step,
    inputs: suite.inputs,
    candidates: suite.candidates.map((c) => ratesFor(c, trials)),
    directionality: directionality(suite.inputs.length, suite.mmd),
    integrity,
    budget: budget.state(),
    judge_discrimination: judgeDiscrimination(trials),
    evaluation_coverage: evaluationCoverage(evaluations),
  };
  if (budget.stoppedEarly) {
    const st = budget.state();
    console.log(
      `⚠ budget limit $${(st.limit_usd ?? 0).toFixed(2)} reached after $${st.spent_usd.toFixed(4)} — skipped ${st.skipped.generation} generation(s), ${st.skipped.judging} judgement(s), ${st.skipped.scoring} scoring call(s); this run is partial (see GAPS.md)`,
    );
  }
  if (integrity.gaps_over_threshold > 0) {
    console.log(`⚠ ${integrity.gaps_over_threshold} wall-clock gap(s) > ${integrity.threshold_ms / 60000} min in the trace — host suspended? durations unreliable (see GAPS.md)`);
  }
  const recommendation = await writeCanonBundle(outDir, {
    manifest: { ...manifest, finished_at: new Date().toISOString() },
    trials,
    evaluations,
    ledger,
    summary,
  });
  if (html) await writeRunReport(outDir);

  console.log(`\n${md}\n`);
  console.log(
    `✔ ${displayPath(outDir)}/ — ${trials.length} trials, ${evaluations.length} evaluator rows, ${traceRows} trace events, ledger total $${ledger.total.toFixed(4)} (${ledger.source}), recommend ${recommendation.chosen ?? "none"} (${recommendation.firmness})${html ? ", report.html" : ""}`,
  );
  return { report, recommendation, trials: trials.length, ledgerTotal: ledger.total, ledger };
}


/** Single-step: runs/<runId>/. Multi-step: runs/<runId>/<stepId>/ (runId tagged with the step). */
function stepLayout(
  root: string,
  runId: string,
  step: string,
  nested: boolean,
): { outDir: string; runId: string; dir: string } {
  const dir = safeName(step);
  if (!nested) return { outDir: root, runId, dir };
  return { outDir: path.join(root, dir), runId: `${runId}/${step}`, dir };
}

interface E2eArms {
  control: E2eControlReport | null;
  proposed: E2eArmReport | null;
  validation: E2eValidation | null;
}

/** The workflow must clear the strictest gate any chained step declares. */
export function workflowThresholds(chain: readonly Suite[]): ValidationThresholds {
  const declared = chain.map((s) => resolveEligibility(s.requiredChecks ?? [], s.eligibility));
  const strictest = (pick: (t: EligibilityThresholds) => number | null): number | null => {
    const values = declared.map(pick).filter((v): v is number => v !== null);
    return values.length === 0 ? null : Math.max(...values);
  };
  return {
    minimum_reliability: strictest((t) => t.minimum_reliability),
    minimum_required_check_pass_rate: strictest((t) => t.minimum_required_check_pass_rate),
  };
}

/** One comparison needs one mode; disagreeing steps leave the workflow unvalidated. */
export function workflowMode(chain: readonly Suite[]): { mode: string } | { reason: string } {
  const modes = [...new Set(chain.map((s) => s.operatingMode ?? "(none)"))];
  if (modes.length > 1) {
    return { reason: `chained steps declare different operating modes (${modes.join(", ")})` };
  }
  if (modes[0] === "(none)") {
    return { reason: "no operating_mode declared on the chained steps" };
  }
  return { mode: modes[0] };
}

/** Generation for one arm: its own check work dirs and its own trace file. */
async function openArmRunner(params: {
  armId: string;
  chain: Suite[];
  root: string;
  runId: string;
}): Promise<{ outDir: string; generate: E2eArmGenerate; close: () => Promise<unknown> }> {
  const { armId, chain, root, runId } = params;
  const outDir = path.join(root, armId);
  await fs.mkdir(outDir, { recursive: true });
  const trace = await openTrace(outDir, `${runId}/${armId}`);
  const promptByStep = new Map<string, string>();
  for (const step of chain) {
    promptByStep.set(step.step, (await loadPromptTemplate(step, step.producer ?? "prompt")).promptTpl);
  }

  const generate: E2eArmGenerate = async function (step, candidate, inputSlug, inputText, trial) {
    const def = defOf(step, candidate);
    const checkWorkDir = path.join(outDir, "checks", `${safeName(step.step)}__${inputSlug}__t${trial}`);
    try {
      const g = await generateOne({
        suite: step,
        producer: step.producer ?? "prompt",
        promptTpl: promptByStep.get(step.step) ?? "",
        inputSlug,
        inputText,
        def,
        temperature: def.generation_settings?.temperature ?? step.temperature ?? 0.3,
        timeoutMs: step.timeoutMs ?? 120_000,
        checkWorkDir,
        trace: trace.emit,
        traceContext: { phase: armId, candidate, step: step.step, input: inputSlug, trial },
      });
      const verdict = classifyCompletion({
        finishReason: g.finishReason,
        refusal: g.refusal,
        parsedUnits: g.parsedUnits,
      });
      const checks =
        g.checkState === undefined
          ? []
          : [{ evaluator: step.check?.id ?? TSC_CHECK_ID, version: g.checkVersion ?? "unknown", state: g.checkState }];
      console.log(`  ${verdict.state.padEnd(8)} ${step.step} · ${candidate} · ${inputSlug} · t${trial}`);
      return {
        completion_state: verdict.state,
        text: g.text,
        artifacts: g.artifacts,
        cost_usd: g.costUsd,
        ms: g.ms,
        checks,
      };
    } catch (err) {
      const rec = errorRecord({ inputSlug, inputText, candidate, def, trial, hash: "" }, err);
      console.log(`  ${(rec.completionState ?? "error").padEnd(8)} ${step.step} · ${candidate} · ${inputSlug} · t${trial}: ${rec.error}`);
      return {
        completion_state: rec.completionState ?? "malformed",
        text: "",
        artifacts: [],
        cost_usd: rec.costUsd,
        ms: rec.ms,
        checks: [],
      };
    }
  };

  return { outDir, generate, close: trace.close };
}

function validationArm(
  report: E2eArmReport,
  kind: "proposed" | "control",
): ValidationArm {
  return {
    arm_id: report.arm_id,
    kind,
    assignment: report.assignment,
    cases: report.cases.length,
    rates: report.rates,
  };
}

/**
 * Protocol §8 step 3: run the single-model control and, when the step-level
 * recommendations propose a different combination, run that combination over
 * the same cases and decide whether it may be adopted.
 */
export async function maybeRunE2eValidation(params: {
  suites: Suite[];
  root: string;
  runId: string;
  chosenByStep: Record<string, string | null>;
}): Promise<E2eArms | null> {
  const { suites, root, runId, chosenByStep } = params;
  const chain = e2eChain(suites);
  if (!chain) return null;
  const controlCandidate = chain[0].controlCandidate;
  if (!controlCandidate) return null;

  const rootInputs = await Promise.all(
    chain[0].inputs.map(async (slug) => ({ slug, text: await readInput(slug, taskRootOf(chain[0])) })),
  );
  const trials = chain[0].trials ?? 2;

  const runArm = async (
    armId: string,
    armKind: "proposed" | "control",
    assignment: StepAssignment,
  ): Promise<E2eArmReport> => {
    const runner = await openArmRunner({ armId, chain, root, runId });
    console.log(
      `\n▶ ${armId} — ${chain.map((s) => `${s.step}:${assignment[s.step]}`).join(" → ")}`,
    );
    try {
      return await runChainArm({
        armId,
        armKind,
        assignment,
        chain,
        rootInputs,
        trials,
        generate: runner.generate,
      });
    } finally {
      await runner.close();
    }
  };

  const controlAssignment = constantAssignment(chain, controlCandidate);
  const controlArm = await runArm("e2e-control", "control", controlAssignment);
  const control: E2eControlReport = {
    ...controlArm,
    arm_kind: "control",
    kind: "single-model-e2e-control",
    candidate: controlCandidate,
  };
  const controlJson = JSON.stringify(control, null, 2);
  await fs.writeFile(path.join(root, "e2e-control", "e2e-control.json"), controlJson, "utf-8");
  await fs.writeFile(path.join(root, "e2e-control.json"), controlJson, "utf-8");
  console.log(
    `✔ e2e control ${controlCandidate}: ${control.totals.success} success / ${control.totals.failure} failure / ${control.totals.undetermined} undetermined`,
  );

  const chainIds = chain.map((s) => s.step);
  const proposal = proposedAssignment(chainIds, chosenByStep);
  const mode = workflowMode(chain);
  const thresholds = workflowThresholds(chain);
  const shared = {
    mmd: chain[0].mmd ?? null,
    thresholds,
    inputs: rootInputs.length,
    control: validationArm(control, "control"),
  };

  let proposed: E2eArmReport | null = null;
  let validation: E2eValidation;
  if ("reason" in proposal) {
    validation = decideValidation({ ...shared, mode: null, proposed: null, notValidatedReason: proposal.reason });
  } else if ("reason" in mode) {
    validation = decideValidation({ ...shared, mode: null, proposed: null, notValidatedReason: mode.reason });
  } else if (sameAssignment(proposal.assignment, controlAssignment)) {
    validation = decideValidation({
      ...shared,
      mode: mode.mode,
      proposed: null,
      blockedReason: `the proposed combination is the single-model control (${controlCandidate}); no second arm was run`,
    });
  } else {
    proposed = await runArm("e2e-proposed", "proposed", proposal.assignment);
    await fs.writeFile(
      path.join(root, "e2e-proposed", "e2e-proposed.json"),
      JSON.stringify(proposed, null, 2),
      "utf-8",
    );
    validation = decideValidation({
      ...shared,
      mode: mode.mode,
      proposed: validationArm(proposed, "proposed"),
      pairs: pairCases(proposed.cases, control.cases),
    });
  }

  await fs.writeFile(
    path.join(root, "e2e-validation.json"),
    JSON.stringify(validation, null, 2),
    "utf-8",
  );
  console.log(`✔ e2e validation: ${validation.verdict} (${validation.firmness}) — ${validation.reasons[0]}`);
  return { control, proposed, validation };
}

/**
 * Run a spec (one or more independent steps) or a legacy JSON suite.
 * Single-step output layout is unchanged. Multi-step writes each step under
 * runs/<runId>/<stepId>/ plus workflow.json at the root (no handoff).
 * When steps declare input_from, the end-to-end validation pass runs after the
 * independent eval: the single-model control arm, the proposed combination arm
 * when the step recommendations differ from it, and the verdict that decides
 * whether the combination may be adopted (e2e-validation.json).
 */
export async function runSuite(suitePath: string, html: boolean, opts: { yes?: boolean } = {}): Promise<Report | null> {
  const suites = await loadSuites(suitePath);
  const isSpec = /\.ya?ml$/i.test(suitePath);
  const reuse = process.env.EVAL_REUSE === "1";

  for (const suite of suites) {
    printPreview(suite, planRun(suite), resolveConcurrency(suite), reuse);
  }
  printE2ePreview(suites);
  if (isSpec && !opts.yes) {
    console.log("Preview only. Re-run with --yes (or EVAL_YES=1) to execute.");
    return null;
  }

  const generatedAt = new Date().toISOString();
  const runName = suites[0].runName ?? suites[0].suiteId;
  const runId = `${runName}-${generatedAt.replace(/[:.]/g, "-")}`;
  const nested = suites.length > 1;
  // The workspace the spec belongs to, not the one the user is standing in:
  // a run is written beside its task, and reuse is scanned around it.
  const ws = await workspaceForSpec(suitePath);
  const root = path.join(runsRootFor(taskRootOf(suites[0]), ws), runId);
  if (nested) await fs.mkdir(root, { recursive: true });

  const budget = new BudgetGuard(suites[0].budgetUsd);
  const steps: WorkflowStepInput[] = [];
  let last: Report | null = null;
  for (const suite of suites) {
    const layout = stepLayout(root, runId, suite.step, nested);
    const done = await executeSuite({
      suite,
      ws,
      outDir: layout.outDir,
      runId: layout.runId,
      html,
      reuse,
      generatedAt,
      budget,
    });
    last = done.report;
    if (nested) {
      steps.push({
        id: suite.step,
        dir: layout.dir,
        operatingMode: done.recommendation.operating_mode,
        chosen: done.recommendation.chosen,
        firmness: done.recommendation.firmness,
        eligible: done.recommendation.eligible,
        gated: done.recommendation.filters.flatMap((f) => f.removed),
        trials: done.trials,
        ledger: done.ledger,
        gaps: await fs.readFile(path.join(layout.outDir, "GAPS.md"), "utf-8").catch(() => ""),
      });
    }
  }

  if (nested) {
    const chosenByStep = Object.fromEntries(steps.map((s) => [s.id, s.chosen]));
    const e2e = await maybeRunE2eValidation({ suites, root, runId, chosenByStep });
    const control = e2e?.control ?? null;
    const record = buildWorkflowRecord({
      protocolVersion: suites[0].protocolVersion ?? "0.4",
      runId,
      runName,
      steps,
      control: control
        ? {
            kind: "control",
            candidate: control.candidate,
            assignment: control.assignment,
            chain: control.chain,
            cases: control.totals.cases,
            success: control.totals.success,
            failure: control.totals.failure,
            undetermined: control.totals.undetermined,
            cost_usd: control.totals.cost_usd,
          }
        : null,
      proposed: e2e?.proposed
        ? {
            kind: "proposed",
            assignment: e2e.proposed.assignment,
            chain: e2e.proposed.chain,
            cases: e2e.proposed.totals.cases,
            success: e2e.proposed.totals.success,
            failure: e2e.proposed.totals.failure,
            undetermined: e2e.proposed.totals.undetermined,
            cost_usd: e2e.proposed.totals.cost_usd,
          }
        : null,
      validation: e2e?.validation ?? null,
    });
    await fs.writeFile(path.join(root, "workflow.json"), JSON.stringify(record, null, 2), "utf-8");
    await fs.writeFile(path.join(root, "GAPS.md"), workflowGaps(steps, record.e2e_validation), "utf-8");
    if (html) await writeWorkflowReport(root);
    const picks = steps.map((s) => `${s.id}:${s.chosen ?? "none"}`).join(", ");
    const e2eBit = control
      ? ` · e2e ${control.candidate} ${control.totals.success}/${control.totals.cases}${e2e?.validation ? ` · ${e2e.validation.verdict}` : ""}`
      : " · no handoff";
    console.log(`✔ runs/${runId}/ — ${steps.length} independent steps${e2eBit} · ${picks} · total $${record.ledger.total.toFixed(4)}${html ? ", report.html" : ""}`);
  }
  return last;
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
