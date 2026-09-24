/**
 * Execute one step, then assemble the run around it.
 *
 * `executeSuite` is one step: generate, judge, score, write both output
 * layers, choose. `runSuite` is the whole spec: every independent step, then
 * the end-to-end validation pass when the steps declare a handoff. Neither
 * prints — both emit, and a caller decides whether anybody is watching.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { judgePromptTemplateSha, PAIRWISE_EVALUATOR_ID } from "../judge.js";
import { scorePromptTemplateSha, ABSOLUTE_EVALUATOR_ID } from "../score.js";
import { checkVersion as tscCheckVersion, commandCheckVersion, TSC_CHECK_ID } from "../check.js";
import { loadWorkflow } from "../spec/load-spec.js";
import { displayPath, resolveTaskAsset } from "../paths.js";
import { runsRootFor, workspaceForSpec, type Workspace } from "./workspace.js";
import { silentSink, type RunEventSink } from "./events.js";
import { methodsOf, planE2e, planStep, resolveConcurrency } from "./plan.js";
import { readInput, runAll, safeName } from "./generate.js";
import { judgeAll, scoreAll } from "./evaluate.js";
import { maybeRunE2eValidation } from "./e2e-arms.js";
import { CODEGEN_PREAMBLE } from "../producers/code-gen.js";
import { sha256, short } from "../canon/hash.js";
import { openTrace, traceIntegrity } from "../canon/trace.js";
import { buildManifest } from "../canon/manifest.js";
import { buildLedger, type CostLedger } from "../canon/cost.js";
import { BudgetGuard } from "../canon/budget.js";
import { buildWorkflowRecord, workflowGaps, type WorkflowStepInput } from "../canon/workflow.js";
import { directionality, ratesFor } from "../canon/rates.js";
import { judgeDiscrimination } from "../canon/discrimination.js";
import { evaluationCoverage, writeCanonBundle, writeManifest } from "../canon/write.js";
import type { Recommendation } from "../canon/select.js";
import { writeRunReport } from "../report-v2.js";
import { writeWorkflowReport } from "../report-workflow.js";
import {
  toEvaluationRows,
  toTrialRows,
  type ScoredRecord,
  type TrialFailure,
} from "../canon/adapt.js";
import type { ProducerKind, Suite } from "../types.js";

export async function loadPromptTemplate(
  suite: Suite,
  producer: ProducerKind,
): Promise<{ promptTpl: string; promptTemplateSha: string }> {
  if (producer !== "prompt") {
    return { promptTpl: "", promptTemplateSha: sha256(CODEGEN_PREAMBLE) };
  }
  if (!suite.promptFile) {
    throw new Error(`suite "${suite.suiteId}" step "${suite.step}" uses producer "prompt" but has no promptFile`);
  }
  const promptTpl = await fs.readFile(await resolveTaskAsset(suite.taskRoot, suite.promptFile), "utf-8");
  return { promptTpl, promptTemplateSha: sha256(promptTpl) };
}

/** What one step produced. The canonical files on disk are the record; this is the handle. */
export interface StepResult {
  step: string;
  /** Absolute path to the step's output directory. */
  dir: string;
  recommendation: Recommendation;
  trials: number;
  ledgerTotal: number;
  ledger: CostLedger;
}

async function executeSuite(params: {
  suite: Suite;
  ws: Workspace;
  emit: RunEventSink;
  signal?: AbortSignal;
  outDir: string;
  runId: string;
  html: boolean;
  reuse: boolean;
  generatedAt: string;
  /** Shared across the steps of a multi-step run; one spec, one limit. */
  budget?: BudgetGuard;
}): Promise<StepResult> {
  const { suite, outDir, runId, html, reuse, generatedAt } = params;
  const producer: ProducerKind = suite.producer ?? "prompt";
  const rubric = await fs.readFile(await resolveTaskAsset(suite.taskRoot, suite.rubricFile), "utf-8");
  const { promptTpl, promptTemplateSha } = await loadPromptTemplate(suite, producer);

  const inputTextBySlug = new Map<string, string>();
  const inputShas: Record<string, string> = {};
  for (const slug of suite.inputs) {
    const text = await readInput(slug, suite.taskRoot);
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
      ? await tscCheckVersion(await resolveTaskAsset(suite.taskRoot, suite.check.scaffoldDir))
      : await commandCheckVersion(suite.check.argv, suite.check.versionFiles, suite.taskRoot);
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
  const records = await runAll({ suite, ws: params.ws, emit: params.emit, signal: params.signal, producer, promptTpl, promptTemplateSha, inputTextBySlug, outDir, limit, runId, reuse, trace: trace.emit, budget });
  const methods = methodsOf(suite);
  params.emit({ type: "phase", step: suite.step, phase: "judging", declared: methods.pairwise });
  const judged = methods.pairwise
    ? await judgeAll(suite, rubric, records, limit, trace.emit, budget, params.emit)
    : { judgements: [], failures: [], skipped: [] };
  params.emit({ type: "phase", step: suite.step, phase: "scoring", declared: methods.absolute });
  const scored: ScoredRecord[] = [];
  const scoreFailures: TrialFailure[] = [];
  if (methods.absolute) {
    await scoreAll(
      suite,
      rubric,
      records,
      limit,
      {
        trace: trace.emit,
        emit: params.emit,
        onScored: (s) => scored.push(s),
        onFailure: (f) => scoreFailures.push(f),
      },
      budget,
    );
  }

  const rawDir = path.join(outDir, "raw");
  await fs.mkdir(rawDir, { recursive: true });
  await Promise.all(
    records
      .filter((r) => r.text.trim() !== "")
      .map((r) => fs.writeFile(path.join(rawDir, `${safeName(r.candidate)}__${r.inputSlug}__t${r.trial}.txt`), r.text, "utf-8")),
  );

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
    params.emit({ type: "budget.stopped", limitUsd: st.limit_usd ?? null, spentUsd: st.spent_usd, skipped: st.skipped });
  }
  if (integrity.gaps_over_threshold > 0) {
    params.emit({ type: "integrity.gaps", gaps: integrity.gaps_over_threshold, thresholdMs: integrity.threshold_ms });
  }
  const recommendation = await writeCanonBundle(outDir, {
    manifest: { ...manifest, finished_at: new Date().toISOString() },
    trials,
    evaluations,
    ledger,
    summary,
  });
  if (html) await writeRunReport(outDir);

  params.emit({
    type: "step.done",
    step: suite.step,
    dir: displayPath(outDir),
    trials: trials.length,
    evaluations: evaluations.length,
    traceEvents: traceRows,
    ledgerTotal: ledger.total,
    ledgerSource: ledger.source,
    chosen: recommendation.chosen,
    firmness: recommendation.firmness,
    html,
    gated: recommendation.filters.flatMap((f) => f.removed),
    rows: trials,
    candidates: suite.candidates,
  });
  return {
    step: suite.step,
    dir: outDir,
    recommendation,
    trials: trials.length,
    ledgerTotal: ledger.total,
    ledger,
  };
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

export interface RunOptions {
  /** Without it a spec is planned and reported, never executed. */
  yes?: boolean;
  /** Where progress goes. Silent by default: a library call prints nothing. */
  onEvent?: RunEventSink;
  /**
   * Stop dispatching. Calls in flight finish and are recorded; the run writes
   * whatever it has, and `run.cancelled` says how much never got a turn.
   */
  signal?: AbortSignal;
}

export async function runSuite(suitePath: string, html: boolean, opts: RunOptions = {}): Promise<StepResult | null> {
  const emit = opts.onEvent ?? silentSink;
  const suites = await loadWorkflow(suitePath);
  const isSpec = /\.ya?ml$/i.test(suitePath);
  const reuse = process.env.EVAL_REUSE === "1";

  for (const suite of suites) emit({ type: "step.planned", plan: planStep(suite, { reuse }) });
  const e2ePlan = planE2e(suites);
  if (e2ePlan) emit({ type: "workflow.planned", e2e: e2ePlan });
  if (isSpec && !opts.yes) {
    emit({ type: "preview.only" });
    return null;
  }

  const generatedAt = new Date().toISOString();
  const runName = suites[0].runName ?? suites[0].suiteId;
  const runId = `${runName}-${generatedAt.replace(/[:.]/g, "-")}`;
  const nested = suites.length > 1;
  // The workspace the spec belongs to, not the one the user is standing in:
  // a run is written beside its task, and reuse is scanned around it.
  const ws = await workspaceForSpec(suitePath);
  const root = path.join(runsRootFor(suites[0].taskRoot), runId);
  if (nested) await fs.mkdir(root, { recursive: true });

  const budget = new BudgetGuard(suites[0].budgetUsd);
  const steps: WorkflowStepInput[] = [];
  let last: StepResult | null = null;
  for (const suite of suites) {
    if (opts.signal?.aborted && last !== null) break;
    const layout = stepLayout(root, runId, suite.step, nested);
    const done = await executeSuite({
      suite,
      ws,
      emit,
      signal: opts.signal,
      outDir: layout.outDir,
      runId: layout.runId,
      html,
      reuse,
      generatedAt,
      budget,
    });
    last = done;
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
    const e2e = await maybeRunE2eValidation({ suites, root, runId, chosenByStep, emit });
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
    emit({
      type: "run.done",
      runId,
      dir: displayPath(root),
      steps: steps.map((s) => ({ id: s.id, chosen: s.chosen })),
      totalUsd: record.ledger.total,
      html,
    });
  }
  return last;
}
