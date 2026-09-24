/**
 * Generation: every candidate × input × trial, run through its adapter.
 *
 * The half of a run that spends money. Nothing here decides anything — it
 * produces records, emits an event per attempt, and hands both back. Failures
 * are recorded with whatever the provider billed, never thrown, so a partial
 * run is still evidence about the candidates that did answer.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { LlmError, type LlmTrace } from "../llm.js";
import { AdapterError, adapterFor, modelRefOf, trialAdapterFields } from "../adapters/resolve.js";
import type { ArtifactFile } from "../adapters/types.js";
import { deliverableText, parsedUnitsFor } from "../adapters/deliverable.js";
import { displayPath, taskInputPath, resolveTaskAsset } from "../paths.js";
import { listRunDirs, type Workspace } from "./workspace.js";
import type { RunEventSink } from "./events.js";
import { CODEGEN_PRODUCER_VERSION } from "../producers/code-gen.js";
import { sha256, trialHash } from "../canon/hash.js";
import { classifyCompletion } from "../canon/states.js";
import { BudgetGuard } from "../canon/budget.js";
import type { CandidateDef, CostSource, EvaluationState,
  Isolation,
} from "../canon/types.js";
import type { TrialRow } from "../canon/rows.js";
import type { ProducerKind, RunRecord, Suite } from "../types.js";

/** A task's input text. Every task owns its inputs; there is no shared pool. */
export async function readInput(inputSlug: string, taskRoot: string): Promise<string> {
  return fs.readFile(taskInputPath(taskRoot, inputSlug), "utf-8");
}

/** Candidate ids may be OpenRouter model ids (legacy) with `/` and `:` — make fs-safe. */
export function safeName(candidate: string): string {
  return candidate.replace(/[/:]/g, "_");
}

/**
 * Map `fn` over `items` with at most `limit` calls in flight at once. Sliding
 * window; results return in INPUT order regardless of completion order.
 */
export async function mapWithConcurrency<T, R>(
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

/** Candidate definition for an id; a Suite built without definitions defaults to id = model. */
export function defOf(suite: Suite, candidateId: string): CandidateDef {
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
export interface GenOutput {
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
  /** agent-cli: whether the command ran in a container or on this host. */
  isolation?: Isolation;
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

export async function generateOne(params: {
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
    { workDir: params.checkWorkDir, taskRoot: suite.taskRoot, emit: trace, traceContext },
  );
  const out: GenOutput = {
    ...result,
    text: deliverableText(adapter.id, result.text, result.artifacts),
    parsedUnits: parsedUnitsFor(adapter.id, result.artifacts, suite.check !== undefined),
  };
  if (!suite.check) return out;
  const { runCheck, runCommandCheck } = await import("../check.js");
  const check =
    suite.check.kind === "tsc"
      ? await runCheck({
          files: result.artifacts,
          scaffoldDir: await resolveTaskAsset(suite.taskRoot, suite.check.scaffoldDir),
          workDir: params.checkWorkDir,
        })
      : await runCommandCheck({
          argv: suite.check.argv,
          versionFiles: suite.check.versionFiles,
          taskRoot: suite.taskRoot,
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
export interface GenTask {
  inputSlug: string;
  inputText: string;
  candidate: string;
  def: CandidateDef;
  trial: number;
  hash: string;
}


/**
 * Find a prior generation with the SAME trial hash (producer, prompt template,
 * input, model, sampling, trial) so nothing is regenerated when only judges or
 * evaluators changed — see EVAL_REUSE.
 *
 * Reads the canonical `scores.jsonl`, not the legacy `records.json`. The
 * canonical row already carries everything a reuse needs — the hash, the
 * tokens, what it was billed, how long it took, and whether it completed —
 * which is what made retiring the legacy writer possible at all.
 */
async function loadReusable(
  step: string,
  hash: string,
  currentRunId: string,
  ws: Workspace,
): Promise<{ record: RunRecord; from: string } | null> {
  // Every task's runs, not just this one's: `trialHash` is content-addressed,
  // so a generation produced under another task is the same generation.
  // Several tasks share `code-utils`; scanning per-task only would re-buy it
  // once per task.
  //
  // Which step a run holds is read from its rows, not guessed from its
  // directory name. The old filter was `name.startsWith(step + "-")`, which
  // is only true when a task's run_name happens to begin with its step id —
  // `codegen-w38/codegen` matched, `smoke-local/codegen` never did, and reuse
  // silently did nothing there.
  const candidates = (await listRunDirs(ws))
    .filter((e) => e.name !== currentRunId)
    .sort((a, b) => b.name.localeCompare(a.name));

  for (const { dir } of candidates) {
    const hit = await findTrialRow(dir, step, hash);
    if (!hit) continue;
    const text = await fs
      .readFile(path.join(dir, "raw", `${safeName(hit.candidate)}__${hit.input}__t${hit.trial}.txt`), "utf-8")
      .catch(() => null);
    // A row with no surviving output is not reusable: the point is to skip
    // the call, and there is nothing here to skip it with.
    if (text === null) continue;
    return { record: recordFromRow(hit, text), from: displayPath(dir) };
  }
  return null;
}

/** The first successful trial row in this run for that step and hash, or null. */
async function findTrialRow(dir: string, step: string, hash: string): Promise<TrialRow | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, "scores.jsonl"), "utf-8");
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let row: TrialRow;
    try {
      row = JSON.parse(line) as TrialRow;
    } catch {
      continue;
    }
    if (row.step === step && row.trial_hash === hash && row.legacy_status === "ok") return row;
  }
  return null;
}

function recordFromRow(row: TrialRow, text: string): RunRecord {
  // A step gates on exactly one required check, so the row carries at most
  // one cell. Carrying it over is not optional: without the check's state the
  // reused trial looks unchecked, eligibility removes the candidate, and the
  // run silently recommends nobody — the same evidence, a different answer.
  const [check] = Object.values(row.checks);
  return {
    candidate: row.candidate,
    inputSlug: row.input,
    trial: row.trial,
    text,
    promptTokens: row.tokens.prompt,
    completionTokens: row.tokens.completion,
    cachedTokens: row.tokens.cached ?? undefined,
    costUsd: row.cost.generation,
    retryCostUsd: row.cost.retry,
    costSource: row.cost.source,
    ms: row.ms,
    status: "ok",
    checkPassed: row.legacy_check_passed ?? undefined,
    checkState: check?.state,
    checkVersion: check?.version,
    checkOutput: check?.evidence,
    modelRef: row.model_ref,
    deploymentRef: row.deployment_ref ?? undefined,
    trialHash: row.trial_hash,
    completionState: row.completion_state,
    truncated: row.truncated,
    finishReason: row.finish_reason ?? undefined,
    // How the artifact was produced travels with it. The image is part of the
    // trial hash, so a reuse hit ran under the same isolation by construction
    // — dropping it here would report "not observed" for something recorded
    // one directory over, and "ran on the host" is precisely what a reader of
    // the evidence is entitled to see.
    isolation: row.isolation ?? undefined,
  };
}

export function errorRecord(task: GenTask, err: unknown): RunRecord {
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
export async function runAll(params: {
  suite: Suite;
  /** Workspace scanned for a reusable generation. */
  ws: Workspace;
  emit: RunEventSink;
  /**
   * Cooperative cancellation. A call already in flight finishes and is
   * recorded — aborting a provider call mid-flight would throw away a result
   * that has already been billed. Nothing new is dispatched after it fires.
   */
  signal?: AbortSignal;
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

  let dispatched = 0;
  let cancelled = 0;
  const done = await mapWithConcurrency(tasks, limit, async (task): Promise<RunRecord | null> => {
    const { inputSlug, inputText, candidate, def, trial } = task;
    if (params.signal?.aborted) {
      cancelled += 1;
      return null;
    }
    const temperature = def.generation_settings?.temperature ?? baseTemperature;
    const checkWorkDir = path.join(outDir, "checks", `${safeName(candidate)}__${inputSlug}__t${trial}`);

    if (reuse) {
      const reused = await loadReusable(suite.step, task.hash, runId, params.ws);
      if (reused) {
        params.emit({ type: "trial", step: suite.step, candidate, input: inputSlug, trial, state: "success", reusedFrom: reused.from });
        return { ...reused.record, candidate, inputSlug, trial, reusedFrom: reused.from };
      }
    }

    // Protocol §7: stop cleanly on the limit. The unit is counted as not run,
    // not recorded as a candidate failure — the candidate never got a turn.
    if (!budget.allows("generation")) {
      params.emit({ type: "trial", step: suite.step, candidate, input: inputSlug, trial, state: "skipped" });
      return null;
    }

    dispatched += 1;
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
      params.emit({
        type: "trial",
        step: suite.step,
        candidate,
        input: inputSlug,
        trial,
        state: verdict.state,
        ms: g.ms,
        costUsd: g.costUsd,
        costSource: g.costSource,
        check: g.checkState,
      });
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
        // Whether the candidate ran in a container or on this machine. The
        // adapter observes it; this literal names every field it keeps, so
        // leaving it out wrote `isolation: null` on every trial — "not
        // observed" for the one thing the sandbox exists to make visible.
        isolation: g.isolation,
      };
    } catch (err) {
      const rec = errorRecord(task, err);
      budget.add(rec.costUsd + (rec.retryCostUsd ?? 0));
      params.emit({
        type: "trial",
        step: suite.step,
        candidate,
        input: inputSlug,
        trial,
        state: rec.completionState ?? "error",
        error: rec.error,
      });
      return rec;
    }
  });

  if (cancelled > 0) {
    params.emit({ type: "run.cancelled", step: suite.step, dispatched, skipped: cancelled });
  }
  return done.filter((r): r is RunRecord => r !== null);
}

/** First successful output for a (candidate, input) pair, if any. */
