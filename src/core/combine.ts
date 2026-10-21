/**
 * One run from several (`agenteval combine`).
 *
 * A long workflow is rarely right in one go: a check gets fixed and a step is
 * re-graded (`--reuse --step code`), or a few candidates are run again after a
 * fix that concerned only them (`--candidate`). Each of those writes a run of
 * its own, and none of them alone is the answer. This builds the answer from
 * them, generating and judging nothing: for each step, every trial is taken
 * from the latest of the given runs that has it, keyed on (candidate, input,
 * trial), and the rates, the recommendation, the ledger and the reports are
 * worked out again from the combined rows, by the spec's current selection
 * rules (operating mode, eligibility, control candidate): changing a
 * threshold after the runs is a decision about the evidence, not new evidence.
 *
 * What follows a trial: its check rows. What survives only if both sides do:
 * a judge's pair verdict, since it compared two particular outputs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { buildLedger, type CostLedger } from "../canon/cost.js";
import { resolveEligibility, type Recommendation } from "../canon/select.js";
import { judgeDiscrimination } from "../canon/discrimination.js";
import type { RunManifest } from "../canon/manifest.js";
import { directionality, ratesFor } from "../canon/rates.js";
import type { EvaluationRow, TrialRow } from "../canon/rows.js";
import { buildWorkflowRecord, workflowGaps, type WorkflowStepInput } from "../canon/workflow.js";
import { evaluationCoverage, writeCanonBundle, type CanonSummary } from "../canon/write.js";
import { PAIRWISE_EVALUATOR_ID } from "../judge.js";
import { ABSOLUTE_EVALUATOR_ID } from "../score.js";
import { writeRunReport } from "../report-v2.js";
import { writeWorkflowReport } from "../report-workflow.js";
import { loadWorkflow } from "../spec/load-spec.js";
import { safeName } from "./generate.js";
import { runsRootFor } from "./workspace.js";
import { applyExitPolicy } from "./exit-policy.js";

/** One step's evidence inside one run: runs/<run>/<step>/ or, for a one-step run, runs/<run>/. */
interface StepSource {
  run: string;
  dir: string;
  manifest: RunManifest;
  trials: TrialRow[];
  evaluations: EvaluationRow[];
  summary: CanonSummary | null;
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const raw = await fs.readFile(file, "utf-8").catch(() => "");
  return raw.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as T);
}

async function stepSource(runDir: string, step: string): Promise<StepSource | null> {
  for (const dir of [path.join(runDir, safeName(step)), runDir]) {
    const manifest = await fs.readFile(path.join(dir, "manifest.json"), "utf-8").then((t) => JSON.parse(t) as RunManifest, () => null);
    if (!manifest || manifest.step.id !== step) continue;
    return {
      run: path.basename(runDir),
      dir,
      manifest,
      trials: await readJsonl<TrialRow>(path.join(dir, "scores.jsonl")),
      evaluations: await readJsonl<EvaluationRow>(path.join(dir, "evaluations.jsonl")),
      summary: await fs.readFile(path.join(dir, "summary.json"), "utf-8").then((t) => JSON.parse(t) as CanonSummary, () => null),
    };
  }
  return null;
}

const trialKey = (candidate: string, input: string, trial: number): string => `${candidate}\u0000${input}\u0000${trial}`;

/** The step's rows, each trial from the latest source holding it. Exported for tests. */
export function combineStep(sources: readonly StepSource[], run: string): { trials: TrialRow[]; evaluations: EvaluationRow[]; from: Map<string, string> } {
  const owner = new Map<string, number>();
  sources.forEach((s, i) => {
    for (const t of s.trials) owner.set(trialKey(t.candidate, t.input, t.trial), i);
  });
  const from = new Map<string, string>();
  for (const [k, i] of owner) from.set(k, sources[i]!.run);
  // A pair verdict stands only where both outputs it compared still do: the
  // first-ok trial of each candidate on that input, from the pair's own run.
  const pairStands = (e: EvaluationRow, i: number): boolean => {
    if (e.subject.kind !== "pair") return true;
    const { a, b, input } = e.subject;
    return [a, b].every((c) => sources[i]!.trials.some((t) => t.candidate === c && t.input === input && owner.get(trialKey(c, input, t.trial)) === i));
  };
  const trials: TrialRow[] = [];
  const evaluations: EvaluationRow[] = [];
  sources.forEach((s, i) => {
    for (const t of s.trials) {
      if (owner.get(trialKey(t.candidate, t.input, t.trial)) !== i) continue;
      const pairwise = t.judge.pairwise?.filter((p) => s.trials.some((o) => o.candidate === p.vs && o.input === t.input && owner.get(trialKey(o.candidate, o.input, o.trial)) === i)) ?? null;
      trials.push({ ...t, run, judge: { ...t.judge, pairwise: pairwise && pairwise.length > 0 ? pairwise : t.judge.pairwise === null ? null : [] } });
    }
    for (const e of s.evaluations) {
      const own = e.subject.kind === "trial" ? owner.get(trialKey(e.subject.candidate, e.subject.input, e.subject.trial)) === i : pairStands(e, i);
      if (own) evaluations.push({ ...e, run });
    }
  });
  return { trials, evaluations, from };
}

/**
 * workflow.json, its GAPS.md and report from the step dirs on disk: after a
 * run is combined, or a step is judged again, the workflow view follows.
 */
export async function writeWorkflowFromSteps(
  root: string,
  suites: readonly { step: string; protocolVersion?: string }[],
  runId: string,
  runName: string,
  html: boolean,
): Promise<void> {
  const steps: WorkflowStepInput[] = [];
  for (const suite of suites) {
    const dir = path.join(root, safeName(suite.step));
    const rec = await fs.readFile(path.join(dir, "recommendation.json"), "utf-8").then((t) => JSON.parse(t) as Recommendation, () => null);
    if (!rec) continue;
    const ledger = JSON.parse(await fs.readFile(path.join(dir, "ledger.json"), "utf-8")) as CostLedger;
    steps.push({
      id: suite.step,
      dir: safeName(suite.step),
      operatingMode: rec.operating_mode,
      chosen: rec.chosen,
      firmness: rec.firmness,
      eligible: rec.eligible,
      gated: rec.filters.flatMap((f) => f.removed),
      trials: (await readJsonl<TrialRow>(path.join(dir, "scores.jsonl"))).length,
      ledger,
      gaps: await fs.readFile(path.join(dir, "GAPS.md"), "utf-8").catch(() => ""),
    });
  }
  const record = buildWorkflowRecord({
    protocolVersion: suites[0]?.protocolVersion ?? "0.3",
    runId,
    runName,
    steps,
    control: null,
    proposed: null,
    validation: null,
  });
  await fs.writeFile(path.join(root, "workflow.json"), JSON.stringify(record, null, 2), "utf-8");
  await fs.writeFile(path.join(root, "GAPS.md"), workflowGaps(steps, record.e2e_validation), "utf-8");
  if (html) await writeWorkflowReport(root);
}

export interface CombineResult {
  dir: string;
  runId: string;
  steps: Array<{ id: string; chosen: string | null; sources: string[] }>;
}

export async function combineRuns(specPath: string, runIds: readonly string[], opts: { html?: boolean } = {}): Promise<CombineResult> {
  const suites = await loadWorkflow(specPath);
  const runsRoot = runsRootFor(suites[0]!.taskRoot);
  const runDirs = runIds.map((id) => path.join(runsRoot, path.basename(id)));
  for (const d of runDirs) {
    if (!(await fs.stat(d).then((s) => s.isDirectory(), () => false))) throw new Error(`no run ${path.basename(d)} under ${runsRoot}`);
  }
  const runName = suites[0]!.runName ?? suites[0]!.suiteId;
  const runId = `${runName}-combined-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const root = path.join(runsRoot, runId);
  const nested = suites.length > 1;
  const out: CombineResult["steps"] = [];

  for (const suite of suites) {
    const sources = (await Promise.all(runDirs.map((d) => stepSource(d, suite.step)))).filter((s): s is StepSource => s !== null);
    if (sources.length === 0) continue;
    const stepDir = nested ? path.join(root, safeName(suite.step)) : root;
    const stepRun = nested ? `${runId}/${suite.step}` : runId;
    const combined = combineStep(sources, stepRun);
    const { evaluations, from } = combined;
    const trials = applyExitPolicy(combined.trials, suite);
    const latest = sources[sources.length - 1]!;
    const candidates = suite.candidates.filter((c) => trials.some((t) => t.candidate === c));
    const manifest: RunManifest = {
      ...latest.manifest,
      run_id: stepRun,
      candidates: Object.assign({}, ...sources.map((s) => s.manifest.candidates)),
      control_candidate: suite.controlCandidate ?? null,
      success_criteria: suite.successCriteria ?? null,
      operating_mode: suite.operatingMode ?? null,
      eligibility: resolveEligibility(suite.requiredChecks ?? [], suite.eligibility),
      finished_at: new Date().toISOString(),
    };
    const summary: CanonSummary = {
      run: stepRun,
      step: suite.step,
      inputs: suite.inputs,
      candidates: candidates.map((c) => ratesFor(c, trials)),
      directionality: directionality(suite.inputs.length, suite.mmd),
      // Wall-clock integrity belongs to a run's own trace; the latest source's stands in.
      integrity: latest.summary?.integrity ?? { events: 0, gaps_over_threshold: 0, longest_gap_ms: 0, threshold_ms: 0, wall_ms: 0, in_flight_gaps: 0 },
      judge_discrimination: judgeDiscrimination(trials),
      evaluation_coverage: evaluationCoverage(evaluations),
    };
    const ledger = buildLedger(trials, evaluations, PAIRWISE_EVALUATOR_ID, ABSOLUTE_EVALUATOR_ID);
    const recommendation = await writeCanonBundle(stepDir, { manifest, trials, evaluations, ledger, summary });
    // Say where every trial came from, beside the rows.
    const provenance = [...from].map(([k, r]) => ({ trial: k.split("\u0000").join(" · "), from: r }));
    await fs.writeFile(path.join(stepDir, "combined-from.json"), JSON.stringify({ runs: sources.map((s) => s.run), trials: provenance }, null, 2), "utf-8");
    await fs.appendFile(
      path.join(stepDir, "GAPS.md"),
      `\n- **combined run**: built from ${sources.map((s) => s.run).join(", ")} (later runs supersede earlier ones per trial); nothing was generated or judged for it. combined-from.json says which run each trial came from.\n`,
      "utf-8",
    );
    if (opts.html) await writeRunReport(stepDir);
    out.push({ id: suite.step, chosen: recommendation.chosen, sources: sources.map((s) => s.run) });
  }
  if (out.length === 0) throw new Error(`none of ${runIds.join(", ")} holds a step of ${specPath}`);

  if (nested) await writeWorkflowFromSteps(root, suites, runId, runName, opts.html === true);
  return { dir: root, runId, steps: out };
}
