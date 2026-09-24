/**
 * Read-only catalog for the demo UI: specs on disk, completed runs, and
 * committed fixtures as samples. Does not execute evals.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fixturesDir as installedFixturesDir } from "../paths.js";
import { findWorkspace, listRunDirs, runsDir, tasksDir, type Workspace } from "../core/workspace.js";
import { loadWorkflow } from "../spec/load-spec.js";
import { loadBundle } from "../report-v2.js";
import type { Recommendation } from "../canon/select.js";
import { planFromSuites, type TestPlan } from "../test-plan.js";
import { attributeFiles, type DefinitionFiles } from "./definition-files.js";
import type { Suite } from "../types.js";

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
  /** The spec in words: what it tests, how it judges, how it picks. */
  plan: TestPlan;
}

/**
 * A spec that failed to load, named with its reason. One bad spec used to
 * fail the whole catalog — every task vanished behind "cannot read this
 * workspace" and nothing said which file to fix.
 */
export interface BrokenSpec {
  /** Workspace-relative path to the spec. */
  path: string;
  task: string;
  error: string;
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
  /** Artifact-relative root: the workflow root for a multi-step run, the step dir otherwise. */
  dir: string;
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
  plan: TestPlan;
  /**
   * Files that make up the definition, relative to the task dir, `runs/`
   * excluded — the inputs, rubrics, prompts, checks and scaffold a reader
   * needs to answer "what was asked and how is it judged" without leaving
   * the page.
   */
  files: string[];
  /** The same files grouped by the step that references them, with each file's role. */
  definition: DefinitionFiles;
  /** Newest first. */
  runs: RunView[];
  /** Summed over runs that reported a ledger; null when none did. */
  spentUsd: number | null;
}

export interface CatalogRoots {
  /**
   * Workspace the catalog reads. Absent means "resolve from the working
   * directory" — a server passes the one it was started with, so every
   * request answers about the same workspace.
   */
  ws?: Workspace;
  specsDir?: string;
  runsRoot?: string;
  fixturesDir?: string;
}

async function wsOf(over?: CatalogRoots): Promise<Workspace> {
  return over?.ws ?? (await findWorkspace());
}

const FIXTURE_PREFIX = "fixture:";

/** Candidate id prefix used by the smoke specs' scripted stand-ins. */
const SYNTHETIC_CANDIDATE_PREFIX = "fake-";

/** The run the demo opens on: real models, one gated by a required check, one recommended on cost. */
const FEATURED_RUN_ID = "fixture:codegen-w38";

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

async function rootsOf(over?: CatalogRoots): Promise<Required<Omit<CatalogRoots, "ws">> & { ws: Workspace }> {
  const ws = await wsOf(over);
  return {
    ws,
    specsDir: over?.specsDir ?? path.join(ws.root, "specs"),
    runsRoot: over?.runsRoot ?? runsDir(ws),
    fixturesDir: over?.fixturesDir ?? installedFixturesDir(),
  };
}

/** tasks/<name>/runs/<id> -> "<name>"; anything else -> null. */
function taskOfRunDir(ws: Workspace, abs: string): string | null {
  const rel = path.relative(tasksDir(ws), abs);
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
  for (const e of await listRunDirs(await wsOf(over))) {
    if (safeId(e.name)) out.set(e.name, e.dir);
  }
  return out;
}

async function locateRun(id: string, over?: CatalogRoots): Promise<RunLocation | null> {
  const { ws, runsRoot, fixturesDir } = await rootsOf(over);
  const sample = id.startsWith(FIXTURE_PREFIX);
  const diskId = sample ? id.slice(FIXTURE_PREFIX.length) : id;
  if (!safeId(diskId)) return null;
  const abs = sample
    ? path.join(fixturesDir, diskId)
    : ((await liveRunIndex(over)).get(diskId) ?? path.join(runsRoot, diskId));
  return { id, sample, diskId, kind: sample ? "fixture" : "run", abs, task: taskOfRunDir(ws, abs) };
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
  const ws = await wsOf(over);
  const dirs = (await fs.readdir(tasksDir(ws), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const out: string[] = [];
  for (const d of dirs) {
    const p = path.join(tasksDir(ws), d, "spec.yaml");
    if (await fileExists(p)) out.push(p);
  }
  return out;
}

async function specView(rel: string, suites: Suite[]): Promise<SpecView> {
  return {
    path: rel,
    runName: suites[0].runName ?? suites[0].suiteId,
    budgetUsd: suites[0].budgetUsd ?? null,
    plan: await planFromSuites(suites),
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
  };
}

interface LoadedSpecs {
  loaded: Array<{ view: SpecView; suites: Suite[] }>;
  broken: BrokenSpec[];
}

/** Every spec in the workspace, each loaded on its own so one bad file cannot hide the rest. */
async function loadSpecs(over?: CatalogRoots): Promise<LoadedSpecs> {
  const ws = await wsOf(over);
  const out: LoadedSpecs = { loaded: [], broken: [] };
  for (const abs of await specPaths(over)) {
    const rel = path.relative(ws.root, abs);
    try {
      const suites = await loadWorkflow(abs);
      out.loaded.push({ view: await specView(rel, suites), suites });
    } catch (err) {
      out.broken.push({
        path: rel,
        task: path.basename(path.dirname(abs)),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

export async function listSpecs(over?: CatalogRoots): Promise<SpecView[]> {
  return (await loadSpecs(over)).loaded.map((l) => l.view);
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
  const { fixturesDir } = await rootsOf(over);
  const live: RunView[] = [];
  for (const name of [...(await liveRunIndex(over)).keys()].sort().reverse()) {
    const view = await loadRun(name, over);
    if (view) live.push(view);
  }
  const samples = await collectRuns(fixturesDir, FIXTURE_PREFIX, over);
  return [...live, ...samples].sort(byDemoOrder);
}

/** Directories that are output or vendored, never part of a task's definition. */
const NON_DEFINITION_DIRS = new Set(["runs", "node_modules"]);

/** Cap the listing: a task that somehow holds thousands of files is a bug, not a page. */
const MAX_DEFINITION_FILES = 400;

/** Definition files under a task dir, relative and sorted, `runs/` excluded. */
async function definitionFiles(taskDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    if (out.length >= MAX_DEFINITION_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_DEFINITION_FILES) return;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (prefix === "" && NON_DEFINITION_DIRS.has(e.name)) continue;
        await walk(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(taskDir, "");
  return out;
}

/**
 * Tasks with their runs attached, plus anything that belongs to no task —
 * legacy top-level runs and committed fixtures — kept separate rather than
 * hidden, so a run never silently disappears from the UI.
 */
export async function listTasks(
  over?: CatalogRoots,
): Promise<{ tasks: TaskView[]; unfiled: RunView[]; broken: BrokenSpec[] }> {
  const ws = await wsOf(over);
  const [{ loaded, broken }, runs] = await Promise.all([loadSpecs({ ...over, ws }), listRuns({ ...over, ws })]);
  // A broken task's runs are still evidence: list them as unfiled rather than lose them.
  const brokenTasks = new Set(broken.map((b) => b.task));
  const byTask = new Map<string, RunView[]>();
  const unfiled: RunView[] = [];
  for (const r of runs) {
    if (r.task === null || brokenTasks.has(r.task)) unfiled.push(r);
    else (byTask.get(r.task) ?? byTask.set(r.task, []).get(r.task)!).push(r);
  }

  const tasks = await Promise.all(loaded.map(async ({ view: spec, suites }) => {
    const name = path.basename(path.dirname(spec.path));
    const own = (byTask.get(name) ?? []).sort((a, b) =>
      (b.startedAt ?? "").localeCompare(a.startedAt ?? ""),
    );
    const files = await definitionFiles(path.join(tasksDir(ws), name));
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
      plan: spec.plan,
      files,
      definition: attributeFiles(suites, files),
      runs: own,
      spentUsd: spent,
    };
  }));

  // A task that has never run still belongs in the list — that is information.
  tasks.sort((a, b) => {
    const at = a.runs[0]?.startedAt ?? "";
    const bt = b.runs[0]?.startedAt ?? "";
    return bt.localeCompare(at) || a.name.localeCompare(b.name);
  });
  return { tasks, unfiled, broken };
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
    dir: `${loc.kind}/${loc.diskId}`,
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
    dir: `${loc.kind}/${loc.diskId}`,
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
