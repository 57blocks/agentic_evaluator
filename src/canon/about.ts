/**
 * What a run evaluated, in words: the spec's description, what its required
 * check's pass means, and each input's tags and split.
 *
 * A run freezes these into manifest.json when it starts. A run made before
 * they existed is described from the task's current spec instead, and the
 * report says so: the words may have changed since, the numbers have not.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseSpec } from "../spec/load-spec.js";
import type { RunManifest } from "./manifest.js";

export interface InputLabel {
  tags: string[];
  split?: string;
}

export type InputLabels = Record<string, InputLabel>;

export interface RunAbout {
  description: string | null;
  /** What this step's candidates do (the step's own description). */
  stepDescription: string | null;
  checkDescription: string | null;
  labels: InputLabels | null;
  /** "frozen": from this run's manifest. "current-spec": from the task's spec as it is now. */
  source: "frozen" | "current-spec" | "none";
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keep tags and split per input; refuse anything else, naming the input. Other keys (e.g. archetype) are ignored. */
export function parseLabels(json: unknown, file: string): InputLabels {
  if (!isRecord(json)) throw new Error(`${file}: expected an object of { "<input>": { "tags": [...], "split": "..." } }`);
  const out: InputLabels = {};
  for (const [input, value] of Object.entries(json)) {
    if (!isRecord(value) || !Array.isArray(value.tags) || !value.tags.every((t) => typeof t === "string")) {
      throw new Error(`${file}: input "${input}" needs "tags": an array of strings`);
    }
    if (value.split !== undefined && typeof value.split !== "string") throw new Error(`${file}: input "${input}" has a "split" that is not a string`);
    out[input] = { tags: [...value.tags], ...(typeof value.split === "string" ? { split: value.split } : {}) };
  }
  return out;
}

export async function readLabels(taskRoot: string, file: string): Promise<InputLabels> {
  const full = path.join(taskRoot, file);
  return parseLabels(JSON.parse(await fs.readFile(full, "utf-8")), file);
}

const frozen = (m: RunManifest): boolean =>
  m.description !== undefined || m.step.description !== undefined || m.test_set.labels !== undefined || m.evaluators.check_description !== undefined;

const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false);

/** The task dir holding the spec: <task>/runs/<run>/ for a step run, <task>/runs/<run>/<step>/ inside a workflow run. */
async function taskRootOf(dir: string, specName: string): Promise<string | null> {
  for (const up of [["..", ".."], ["..", "..", ".."]]) {
    const root = path.resolve(dir, ...up);
    if (await exists(path.join(root, specName))) return root;
  }
  return null;
}

/** A workflow run's description: its steps share one spec, so the first step that has a manifest says it. */
export async function aboutOfWorkflow(root: string, stepIds: readonly string[]): Promise<RunAbout | null> {
  for (const id of stepIds) {
    const stepDir = path.join(root, id);
    const raw = await fs.readFile(path.join(stepDir, "manifest.json"), "utf-8").catch(() => null);
    if (raw === null) continue;
    const about = await aboutOfRun(stepDir, JSON.parse(raw) as RunManifest);
    return about.description ? about : null;
  }
  return null;
}

/** What each step of a workflow run does, in step order; a step with no description is left out. */
export async function stepDescriptionsOf(root: string, stepIds: readonly string[]): Promise<Array<{ id: string; description: string }>> {
  const out: Array<{ id: string; description: string }> = [];
  for (const id of stepIds) {
    const stepDir = path.join(root, id);
    const raw = await fs.readFile(path.join(stepDir, "manifest.json"), "utf-8").catch(() => null);
    if (raw === null) continue;
    const about = await aboutOfRun(stepDir, JSON.parse(raw) as RunManifest);
    if (about.stepDescription) out.push({ id, description: about.stepDescription });
  }
  return out;
}

/** The run's own record when it has one; otherwise the task's current spec. */
export async function aboutOfRun(dir: string, m: RunManifest): Promise<RunAbout> {
  if (frozen(m)) {
    return {
      description: m.description ?? null,
      stepDescription: m.step.description ?? null,
      checkDescription: m.evaluators.check_description ?? null,
      labels: m.test_set.labels ?? null,
      source: "frozen",
    };
  }
  const none: RunAbout = { description: null, stepDescription: null, checkDescription: null, labels: null, source: "none" };
  if (!m.spec.path) return none;
  const taskRoot = await taskRootOf(dir, path.basename(m.spec.path));
  if (!taskRoot) return none;
  const specFile = path.join(taskRoot, path.basename(m.spec.path));
  try {
    const spec = parseSpec(await fs.readFile(specFile, "utf-8"), specFile);
    const step = spec.workflow.steps.find((s) => s.id === m.step.id);
    const checkId = step?.required_checks?.[0];
    const labelsFile = step?.test_set.labels_file;
    const about: RunAbout = {
      description: spec.description ?? null,
      stepDescription: step?.description ?? null,
      checkDescription: (checkId && spec.evaluators.required_checks?.[checkId]?.description) || null,
      labels: labelsFile ? await readLabels(taskRoot, labelsFile).catch(() => null) : null,
      source: "current-spec",
    };
    return about.description || about.stepDescription || about.checkDescription || about.labels ? about : none;
  } catch {
    return none;
  }
}
