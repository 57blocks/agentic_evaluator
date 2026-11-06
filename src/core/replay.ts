/**
 * Re-decide a finished step under other rules, from its recorded rows only.
 *
 * Rates are recomputed from scores.jsonl and the gated decision is replayed
 * with the run's frozen manifest, so the baselines and the ablation are held
 * against exactly the rule that wrote recommendation.json. Never calls a model
 * and never writes into the run.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { compareAblation, countEvaluatorErrorsAsFailures, type AblationComparison } from "../canon/ablation.js";
import { compareBaselines, type BaselineComparison } from "../canon/baselines.js";
import type { RunManifest } from "../canon/manifest.js";
import { ratesFor, type Directionality } from "../canon/rates.js";
import type { TrialRow } from "../canon/rows.js";
import { recommendFromCanon } from "../canon/select.js";
import type { CanonSummary } from "../canon/write.js";

export interface StepReplay {
  run: string;
  step: string;
  operating_mode: string | null;
  baselines: BaselineComparison;
  ablation: AblationComparison;
}

export interface ReplayInput {
  manifest: RunManifest;
  /** Candidate ids in the summary's order, including any with no rows. */
  candidates: readonly string[];
  directionality: Directionality;
  trials: readonly TrialRow[];
}

function decide(input: ReplayInput, trials: readonly TrialRow[]) {
  const rates = input.candidates.map((c) => ratesFor(c, trials));
  return { rates, recommendation: recommendFromCanon(input.manifest, { candidates: rates, directionality: input.directionality }, trials) };
}

export function replayStep(input: ReplayInput): StepReplay {
  const original = decide(input, input.trials);
  const ablated = countEvaluatorErrorsAsFailures(input.trials);
  const afterAblation = decide(input, ablated.rows);
  return {
    run: input.manifest.run_id,
    step: input.manifest.step.id,
    operating_mode: input.manifest.operating_mode,
    baselines: compareBaselines(original.recommendation, original.rates),
    ablation: compareAblation(original.recommendation, afterAblation.recommendation, ablated.changed),
  };
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const text = await fs.readFile(file, "utf-8");
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

/** Replay one step directory (a single-step run, or one step of a workflow run). */
export async function replayRunDir(dir: string): Promise<StepReplay> {
  const read = async <T>(name: string): Promise<T> => JSON.parse(await fs.readFile(path.join(dir, name), "utf-8")) as T;
  const manifest = await read<RunManifest>("manifest.json");
  const summary = await read<CanonSummary>("summary.json");
  const trials = await readJsonl<TrialRow>(path.join(dir, "scores.jsonl"));
  return replayStep({
    manifest,
    candidates: summary.candidates.map((c) => c.candidate),
    directionality: summary.directionality,
    trials,
  });
}
