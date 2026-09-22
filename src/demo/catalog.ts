/**
 * Read-only catalog for the demo UI: specs on disk, completed runs, and
 * committed fixtures as samples. Does not execute evals.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, listRunDirs, runsDir, tasksDir } from "../paths.js";
import { loadWorkflow } from "../spec/load-spec.js";
import { loadBundle } from "../report-v2.js";
import type { Recommendation } from "../canon/select.js";

export interface SpecStepView {
  id: string;
  producer: string;
  rubricFile: string;
  promptFile?: string;
  inputFrom?: string;
  inputs: string[];
  candidates: string[];
  requiredChecks: string[];
  operatingMode: string | null;
}

export interface SpecView {
  path: string;
  runName: string;
  budgetUsd: number | null;
  steps: SpecStepView[];
}

export interface RunStepView {
  id: string;
  dir: string;
  chosen: string | null;
  firmness: string;
  eligible: string[];
  gated: Array<{ candidate: string; reason: string }>;
  operatingMode: string | null;
  ledgerTotal: number | null;
  reportHref: string | null;
}

export interface RunView {
  id: string;
  /** Task directory that owns this run; null for a legacy top-level run or a fixture. */
  task: string | null;
  kind: "single" | "workflow";
  runName: string;
  startedAt: string | null;
  handoff: boolean;
  sample: boolean;
  /** Every candidate is a scripted stand-in, not a real model: a smoke run, not evidence. */
  synthetic: boolean;
  totalUsd: number | null;
  e2e?: {
    candidate: string;
    chain: string[];
    success: number;
    failure: number;
    undetermined: number;
  } | null;
  steps: RunStepView[];
}

/**
 * A task and everything it has produced. The demo's top-level unit: one
 * directory on disk, one row in the UI, its runs nested underneath newest
 * first — so "which experiments used this input, and how did they go" is one
 * click rather than a join the reader performs by eye across two flat lists.
 */
export interface TaskView {
  /** Directory name under tasks/. */
  name: string;
  specPath: string;
  runName: string;
  budgetUsd: number | null;
  steps: SpecStepView[];
  /** Newest first. */
  runs: RunView[];
  /** Summed over runs that reported a ledger; null when none did. */
  spentUsd: number | null;
}

export interface CatalogRoots {
  specsDir?: string;
  runsRoot?: string;
  fixturesDir?: string;
}

const FIXTURE_PREFIX = "fixture:";

/** Candidate id prefix used by the smoke specs' scripted stand-ins. */
const SYNTHETIC_CANDIDATE_PREFIX = "fake-";

/** The run the demo opens on: real models, one gated by a required check, one recommended on cost. */
export const FEATURED_RUN_ID = "fixture:codegen-w38";

interface RunLocation {
  id: string;
  sample: boolean;
  diskId: string;
  kind: "run" | "fixture";
  abs: string;
  /** Task that owns the run, derived from where the directory sits. */
  task: string | null;
}

interface WorkflowFile {
  run_name?: string;
  handoff?: boolean;
  e2e_control?: {
    candidate: string;
    chain: string[];
    success: number;
    failure: number;
    undetermined: number;
  } | null;
  steps?: Array<{ id: string; dir: string; chosen: string | null; firmness: string }>;
}

function rootsOf(over?: CatalogRoots): Required<CatalogRoots> {
  return {
    specsDir: over?.specsDir ?? path.join(REPO_ROOT, "specs"),
    runsRoot: over?.runsRoot ?? runsDir(),
    fixturesDir: over?.fixturesDir ?? path.join(REPO_ROOT, "fixtures"),
  };
}

/** tasks/<name>/runs/<id> -> "<name>"; anything else -> null. */
function taskOfRunDir(abs: string): string | null {
  const rel = path.relative(tasksDir(), abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep);
  return parts.length >= 3 && parts[1] === "runs" ? parts[0] : null;
}

/** Reject path segments that could escape a catalog root. */
export function safeId(id: string): boolean {
  return id.length > 0 && !path.isAbsolute(id) && !id.includes("..") && !id.includes("/") && !id.includes("\\");
}

/**
 * Run id -> directory, across every task's `runs/` plus the legacy top-level
 * one. An explicitly injected `runsRoot` (tests, fixtures) stays a single flat
 * root so callers can still point the catalog at a temp dir.
 */
export async function liveRunIndex(over?: CatalogRoots): Promise<Map<string, string>> {
  const root = over?.runsRoot;
  if (root !== undefined) {
    return new Map((await listRunNames(root)).map((n) => [n, path.join(root, n)]));
  }
  const out = new Map<string, string>();
  for (const e of await listRunDirs()) {
    if (safeId(e.name)) out.set(e.name, e.dir);
  }
  return out;
}

async function locateRun(id: string, over?: CatalogRoots): Promise<RunLocation | null> {
  const { runsRoot, fixturesDir } = rootsOf(over);
  const sample = id.startsWith(FIXTURE_PREFIX);
  const diskId = sample ? id.slice(FIXTURE_PREFIX.length) : id;
  if (!safeId(diskId)) return null;
  const abs = sample
    ? path.join(fixturesDir, diskId)
    : ((await liveRunIndex(over)).get(diskId) ?? path.join(runsRoot, diskId));
  return { id, sample, diskId, kind: sample ? "fixture" : "run", abs, task: taskOfRunDir(abs) };
}

/**
 * Spec files to list. A task owns its spec (`tasks/<name>/spec.yaml`); an
 * explicit `specsDir` override still means "every yaml directly in here", so
 * the tmp-dir tests keep working.
 */
async function specPaths(over?: CatalogRoots): Promise<string[]> {
  if (over?.specsDir !== undefined) {
    const names = (await fs.readdir(over.specsDir)).filter((n) => /\.ya?ml$/i.test(n)).sort();
    return names.map((n) => path.join(over.specsDir!, n));
  }
  const dirs = (await fs.readdir(tasksDir(), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const out: string[] = [];
  for (const d of dirs) {
    const p = path.join(tasksDir(), d, "spec.yaml");
    if (await fileExists(p)) out.push(p);
  }
  return out;
}

export async function listSpecs(over?: CatalogRoots): Promise<SpecView[]> {
  const out: SpecView[] = [];
  for (const abs of await specPaths(over)) {
    const rel = path.relative(REPO_ROOT, abs);
    const suites = await loadWorkflow(rel);
    out.push({
      path: rel,
      runName: suites[0].runName ?? suites[0].suiteId,
      budgetUsd: suites[0].budgetUsd ?? null,
      steps: suites.map((s) => ({
        id: s.step,
        producer: s.producer ?? "prompt",
        rubricFile: s.rubricFile,
        promptFile: s.promptFile,
        inputs: [...s.inputs],
        candidates: [...s.candidates],
        requiredChecks: [...(s.requiredChecks ?? [])],
        operatingMode: s.operatingMode ?? null,
        inputFrom: s.inputFrom,
      })),
    });
  }
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function gatedOf(rec: Recommendation | null): RunStepView["gated"] {
  if (!rec) return [];
  return rec.filters.flatMap((f) => f.removed.map((r) => ({ candidate: r.candidate, reason: r.reason })));
}

async function stepFromDir(abs: string, artifactRel: string, stepId?: string): Promise<RunStepView> {
  const reportHref = (await fileExists(path.join(abs, "report.html"))) ? `/artifact/${artifactRel}/report.html` : null;
  const bundle = await loadBundle(abs).catch(() => null);
  const rec = bundle?.recommendation ?? null;
  return {
    id: stepId ?? path.basename(abs),
    dir: artifactRel,
    chosen: rec?.chosen ?? null,
    firmness: rec?.firmness ?? "needs-review",
    eligible: rec?.eligible ?? [],
    gated: gatedOf(rec),
    operatingMode: bundle?.manifest.operating_mode ?? null,
    ledgerTotal: bundle?.ledger.total ?? null,
    reportHref,
  };
}

async function listRunNames(root: string): Promise<string[]> {
  try {
    const names = await fs.readdir(root);
    const dirs: string[] = [];
    for (const name of names) {
      if (!safeId(name)) continue;
      const st = await fs.stat(path.join(root, name)).catch(() => null);
      if (st?.isDirectory()) dirs.push(name);
    }
    return dirs.sort().reverse();
  } catch {
    return [];
  }
}

async function collectRuns(root: string, prefix: string, over?: CatalogRoots): Promise<RunView[]> {
  const out: RunView[] = [];
  for (const name of await listRunNames(root)) {
    const view = await loadRun(`${prefix}${name}`, over);
    if (view) out.push(view);
  }
  return out;
}

function candidatesOf(steps: readonly RunStepView[]): string[] {
  return steps.flatMap((s) => [
    ...(s.chosen ? [s.chosen] : []),
    ...s.eligible,
    ...s.gated.map((g) => g.candidate),
  ]);
}

function isSynthetic(steps: readonly RunStepView[]): boolean {
  const ids = candidatesOf(steps);
  return ids.length > 0 && ids.every((id) => id.startsWith(SYNTHETIC_CANDIDATE_PREFIX));
}

function totalUsdOf(steps: readonly RunStepView[]): number | null {
  const known = steps.map((s) => s.ledgerTotal).filter((n): n is number => n != null);
  return known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
}

/** ISO timestamp suffix of a run directory name, for runs whose manifest does not carry one. */
function startedAtFromId(diskId: string): string | null {
  const m = diskId.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}

/** Featured first, then real runs newest first, then synthetic smoke runs. */
function demoRank(run: RunView): number {
  if (run.id === FEATURED_RUN_ID) return 0;
  return run.synthetic ? 2 : 1;
}

function byDemoOrder(a: RunView, b: RunView): number {
  const rank = demoRank(a) - demoRank(b);
  if (rank !== 0) return rank;
  return (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
}

export async function listRuns(over?: CatalogRoots): Promise<RunView[]> {
  const { fixturesDir } = rootsOf(over);
  const live: RunView[] = [];
  for (const name of [...(await liveRunIndex(over)).keys()].sort().reverse()) {
    const view = await loadRun(name, over);
    if (view) live.push(view);
  }
  const samples = await collectRuns(fixturesDir, FIXTURE_PREFIX, over);
  return [...live, ...samples].sort(byDemoOrder);
}

/**
 * Tasks with their runs attached, plus anything that belongs to no task —
 * legacy top-level runs and committed fixtures — kept separate rather than
 * hidden, so a run never silently disappears from the UI.
 */
export async function listTasks(
  over?: CatalogRoots,
): Promise<{ tasks: TaskView[]; unfiled: RunView[] }> {
  const [specs, runs] = await Promise.all([listSpecs(over), listRuns(over)]);
  const byTask = new Map<string, RunView[]>();
  const unfiled: RunView[] = [];
  for (const r of runs) {
    if (r.task === null) unfiled.push(r);
    else (byTask.get(r.task) ?? byTask.set(r.task, []).get(r.task)!).push(r);
  }

  const tasks = specs.map((spec) => {
    const name = path.basename(path.dirname(spec.path));
    const own = (byTask.get(name) ?? []).sort((a, b) =>
      (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
    );
    const spent = own.reduce<number | null>(
      (acc, r) => (r.totalUsd === null ? acc : (acc ?? 0) + r.totalUsd),
      null,
    );
    return {
      name,
      specPath: spec.path,
      runName: spec.runName,
      budgetUsd: spec.budgetUsd,
      steps: spec.steps,
      runs: own,
      spentUsd: spent,
    };
  });

  // A task that has never run still belongs in the list — that is information.
  tasks.sort((a, b) => {
    const at = a.runs[0]?.startedAt ?? "";
    const bt = b.runs[0]?.startedAt ?? "";
    return bt.localeCompare(at) || a.name.localeCompare(b.name);
  });
  return { tasks, unfiled };
}

export async function loadRun(id: string, over?: CatalogRoots): Promise<RunView | null> {
  const loc = await locateRun(id, over);
  if (!loc) return null;
  const st = await fs.stat(loc.abs).catch(() => null);
  if (!st?.isDirectory()) return null;
  if (await fileExists(path.join(loc.abs, "workflow.json"))) return loadWorkflowRun(loc);
  return loadSingleRun(loc);
}

async function loadWorkflowRun(loc: RunLocation): Promise<RunView | null> {
  const wf = JSON.parse(await fs.readFile(path.join(loc.abs, "workflow.json"), "utf-8")) as WorkflowFile;
  const steps: RunStepView[] = [];
  for (const s of wf.steps ?? []) {
    if (!safeId(s.dir)) continue;
    const detailed = await stepFromDir(path.join(loc.abs, s.dir), `${loc.kind}/${loc.diskId}/${s.dir}`, s.id);
    steps.push({
      ...detailed,
      chosen: detailed.chosen ?? s.chosen,
      firmness: detailed.firmness || s.firmness,
    });
  }
  if (steps.length === 0) return null;
  return {
    id: loc.id,
    task: loc.task,
    kind: "workflow",
    runName: wf.run_name ?? loc.diskId,
    startedAt: startedAtFromId(loc.diskId),
    handoff: wf.handoff === true,
    sample: loc.sample,
    synthetic: isSynthetic(steps),
    totalUsd: totalUsdOf(steps),
    e2e: wf.e2e_control ?? null,
    steps,
  };
}

async function loadSingleRun(loc: RunLocation): Promise<RunView | null> {
  if (!(await fileExists(path.join(loc.abs, "summary.json")))) return null;
  let startedAt: string | null = null;
  let runName = loc.diskId;
  let stepId: string | undefined;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(loc.abs, "manifest.json"), "utf-8")) as {
      started_at?: string;
      run_name?: string;
      step?: { id?: string };
    };
    startedAt = manifest.started_at ?? null;
    runName = manifest.run_name ?? loc.diskId;
    if (manifest.step?.id) stepId = manifest.step.id;
  } catch {
    // ignore missing or unreadable manifest
  }
  const step = await stepFromDir(loc.abs, `${loc.kind}/${loc.diskId}`, stepId);
  const steps = [step];
  return {
    id: loc.id,
    task: loc.task,
    kind: "single",
    runName,
    startedAt: startedAt ?? startedAtFromId(loc.diskId),
    handoff: false,
    sample: loc.sample,
    synthetic: isSynthetic(steps),
    totalUsd: totalUsdOf(steps),
    e2e: null,
    steps,
  };
}
