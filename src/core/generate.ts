/**
 * Generation: every candidate × input × trial, run through its adapter.
 *
 * The half of a run that spends money. Nothing here decides anything — it
 * produces records, emits an event per attempt, and hands both back. Failures
 * are recorded with whatever the provider billed, never thrown, so a partial
 * run is still evidence about the candidates that did answer.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LlmError, type LlmTrace } from "../llm.js";
import { AdapterError, adapterFor, modelRefOf, trialAdapterFields } from "../adapters/resolve.js";
import type { ArtifactFile } from "../adapters/types.js";
import { fixturePath, inputIdentity } from "./fixture.js";
import { killProcessesUnder } from "../proc.js";
import { finishForCompletion } from "./exit-policy.js";
import { priceFromSpec } from "../pricing.js";
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
  /** agent-cli: what the command printed (see CandidateResult.log). */
  log?: string;
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
  checkReason?: string;
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
  /** The input's fixture (`fixture_dir`), laid in before an agent starts. */
  fixtureDir?: string | null;
  /** A chained step's handoff: the previous step's files (`handoff: workdir`). */
  seedFiles?: readonly ArtifactFile[];
}): Promise<GenOutput> {
  // The trial runs outside the repo (a project with no config of its own
  // would otherwise pick up this repo's: vite.config.ts, tsconfig, .git).
  // What it left is kept under the run as evidence; installs are not.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "agenteval-trial-"));
  let log: string | undefined;
  try {
    const out = await generateIn(scratch, params);
    log = out.log;
    return out;
  } catch (err) {
    log = (err as { log?: string }).log;
    throw err;
  } finally {
    // Anything the agent detached from its process group dies with the trial.
    await killProcessesUnder(scratch);
    await keepEvidence(scratch, params.checkWorkDir);
    if (log) await fs.writeFile(path.join(params.checkWorkDir, AGENT_LOG), log, "utf-8");
    // A process the agent left behind may still be writing; the trial's
    // outcome must not hang on whether its temp dir could be removed.
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }).catch(() => undefined);
  }
}

/**
 * A reused trial whose check has since changed is graded again, on the files
 * it left (kept under its run), so fixing a check never means paying for the
 * generations again. Null when the check is unchanged, is not a command, or
 * the trial's files were not kept.
 */
async function regradeIfChanged(
  suite: Suite,
  reused: { record: RunRecord; dir: string },
  t: { candidate: string; inputSlug: string; inputText: string; trial: number; checkWorkDir: string },
): Promise<Partial<RunRecord> | null> {
  const check = suite.check;
  if (!check || check.kind !== "command") return null;
  const { commandCheckVersion, runCommandCheck } = await import("../check.js");
  const version = await commandCheckVersion(check.argv, check.versionFiles, suite.taskRoot);
  if (reused.record.checkVersion === version) return null;
  const kept = path.join(reused.dir, "checks", `${safeName(t.candidate)}__${t.inputSlug}__t${t.trial}`);
  if (!(await fs.stat(kept).then((s) => s.isDirectory(), () => false))) return null;
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "agenteval-regrade-"));
  try {
    await fs.cp(kept, scratch, { recursive: true });
    const fixture = fixturePath(suite, t.inputSlug);
    const result = await runCommandCheck({
      argv: check.argv,
      versionFiles: check.versionFiles,
      taskRoot: suite.taskRoot,
      timeoutMs: check.timeoutMs,
      files: [],
      output: reused.record.text,
      input: t.inputText,
      meta: { step: suite.step, candidate: t.candidate, input: t.inputSlug, trial: t.trial, ...(fixture ? { fixture } : {}), chained: false },
      workDir: scratch,
    });
    await keepEvidence(scratch, t.checkWorkDir);
    return {
      checkPassed: result.passed,
      checkOutput: result.output,
      checkReason: result.reason,
      checkState: result.state,
      checkVersion: result.version,
    };
  } finally {
    await fs.rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }).catch(() => undefined);
  }
}

/** What an agent command printed, kept beside the files it left. */
export const AGENT_LOG = "AGENT_OUTPUT.log";

/** Not kept as evidence: reinstallable, and large. */
const NOT_EVIDENCE = new Set(["node_modules", ".git"]);

async function keepEvidence(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  try {
    await fs.cp(from, to, { recursive: true, force: true, filter: (src) => !NOT_EVIDENCE.has(path.basename(src)) });
  } catch (err) {
    // Files changing under the copy (a process still running) cost evidence, not the trial.
    await fs.writeFile(path.join(to, "EVIDENCE_INCOMPLETE.txt"), `copying the work dir failed: ${err instanceof Error ? err.message : String(err)}\n`, "utf-8");
  }
}

async function generateIn(workDir: string, params: Parameters<typeof generateOne>[0]): Promise<GenOutput> {
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
      ...(def.price ? { price: priceFromSpec(def.price) } : {}),
      ...(suite.maxCostPerTrialUsd !== undefined ? { maxCostUsd: suite.maxCostPerTrialUsd } : {}),
      ...(params.fixtureDir ? { fixtureDir: params.fixtureDir } : {}),
      ...(params.seedFiles ? { seedFiles: params.seedFiles } : {}),
    },
    { workDir, taskRoot: suite.taskRoot, emit: trace, traceContext },
  );
  const out: GenOutput = {
    ...result,
    text: deliverableText(adapter.id, result.text, result.artifacts, suite.judgeShow),
    parsedUnits: parsedUnitsFor(adapter.id, result.artifacts, suite.check !== undefined),
  };
  if (!suite.check) return out;
  const { runCheck, runCommandCheck } = await import("../check.js");
  const check =
    suite.check.kind === "tsc"
      ? await runCheck({
          files: result.artifacts,
          scaffoldDir: await resolveTaskAsset(suite.taskRoot, suite.check.scaffoldDir),
          workDir,
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
            // Where this input's fixture is, so a check can compare against
            // the starting state; and whether the work dir was handed over.
            ...(params.fixtureDir ? { fixture: params.fixtureDir } : {}),
            chained: params.seedFiles !== undefined,
          },
          workDir,
        });
  return {
    ...out,
    checkPassed: check.passed,
    checkOutput: check.output,
    checkReason: check.reason,
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
): Promise<{ record: RunRecord; from: string; dir: string } | null> {
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

  // A multi-step run keeps each step under runs/<run>/<step>/.
  const dirs = candidates.flatMap(({ dir }) => [dir, path.join(dir, step)]);
  for (const dir of dirs) {
    const hit = await findTrialRow(dir, step, hash);
    if (!hit) {
      // The hash covers the step's producer, input and candidate, so a
      // journal line with it is this trial; the step is implied.
      const journaled = await findJournaled(dir, hash);
      if (journaled) return { record: journaled, from: displayPath(dir), dir };
      continue;
    }
    const text = await fs
      .readFile(path.join(dir, "raw", `${safeName(hit.candidate)}__${hit.input}__t${hit.trial}.txt`), "utf-8")
      .catch(() => null);
    // A row with no surviving output is not reusable: the point is to skip
    // the call, and there is nothing here to skip it with.
    if (text === null) continue;
    return { record: recordFromRow(hit, text), from: displayPath(dir), dir };
  }
  return null;
}

/**
 * Each finished trial, appended the moment it finishes. A run's rows are
 * written once every trial is done, so a run that dies at trial 50 of 81 used
 * to leave nothing `--reuse` could find, and the 50 were bought again.
 */
export const JOURNAL_FILE = "trials.partial.jsonl";

async function journal(outDir: string, record: RunRecord): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  await fs.appendFile(path.join(outDir, JOURNAL_FILE), JSON.stringify(record) + "\n", "utf-8");
}

/** A finished trial with that hash from a run's journal (a run that did not finish), or null. */
async function findJournaled(dir: string, hash: string): Promise<RunRecord | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(dir, JOURNAL_FILE), "utf-8");
  } catch {
    return null;
  }
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r = JSON.parse(line) as RunRecord;
      if (r.trialHash === hash && r.status === "ok") return r;
    } catch {
      // A line cut short by the crash itself.
    }
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
    checkReason: check?.reason,
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
    const fixture = fixturePath(suite, inputSlug);
    const identity = await inputIdentity(inputText, fixture);
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
            inputSha: sha256(identity),
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
        const regraded = await regradeIfChanged(suite, reused, { candidate, inputSlug, inputText, trial, checkWorkDir });
        params.emit({ type: "trial", step: suite.step, candidate, input: inputSlug, trial, state: "success", reusedFrom: reused.from, ...(regraded ? { check: regraded.checkState } : {}) });
        return { ...reused.record, ...regraded, candidate, inputSlug, trial, reusedFrom: reused.from };
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
        fixtureDir: fixturePath(suite, inputSlug),
      });
      budget.add(g.costUsd + (g.retryCostUsd ?? 0));
      const verdict = classifyCompletion({ finishReason: finishForCompletion(def, g.finishReason, suite), refusal: g.refusal, parsedUnits: g.parsedUnits });
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
      const record: RunRecord = {
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
        checkReason: g.checkReason,
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
      await journal(outDir, record);
      return record;
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
