/**
 * Parity: the canonical rows must reproduce the ORIGINAL harness aggregate.
 *
 * For every fixture run that has both `scores.jsonl` and `report.json`, rebuild
 * RunRecord[] / Judgement[] / ScoreRecord[] from the canonical files and feed
 * them to the pristine `legacyAggregate` (tests/legacy-aggregate.ts). The result
 * must equal the scorecards the run itself wrote. Also: generation cost in the
 * canonical rows must sum to the cost in records.json.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { legacyAggregate } from "./legacy-aggregate.js";
import type { EvaluationRow, TrialRow } from "../src/canon/rows.js";
import type { RunManifest } from "../src/canon/manifest.js";
import type { DimensionVerdict, Judgement, Report, RunRecord, ScoreRecord, Suite, Winner } from "../src/types.js";

const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures");
const EPS = 1e-9;

async function readJsonl<T>(file: string): Promise<T[]> {
  const raw = await fs.readFile(file, "utf-8");
  return raw.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as T);
}

async function canonicalFixtures(): Promise<string[]> {
  const entries = await fs.readdir(FIXTURES, { withFileTypes: true });
  const dirs: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(FIXTURES, e.name);
    try {
      await fs.access(path.join(dir, "scores.jsonl"));
      await fs.access(path.join(dir, "report.json"));
      dirs.push(dir);
    } catch {
      // legacy-only fixture; not a parity subject
    }
  }
  return dirs;
}

function recordsFrom(trials: TrialRow[]): RunRecord[] {
  return trials.map((t) => ({
    candidate: t.candidate,
    inputSlug: t.input,
    trial: t.trial,
    text: t.legacy_status === "ok" ? "x" : "",
    promptTokens: t.tokens.prompt,
    completionTokens: t.tokens.completion,
    costUsd: t.cost.generation,
    ms: t.ms,
    status: t.legacy_status,
    checkPassed: t.legacy_check_passed ?? undefined,
  }));
}

function judgementsFrom(rows: EvaluationRow[], dims: string[]): Judgement[] {
  const verdict = (w: Winner): DimensionVerdict => ({ forward: w, reverse: w, resolved: w });
  return rows
    .filter((r) => r.evaluator === "pairwise-swap" && r.state === "pass" && r.subject.kind === "pair")
    .map((r) => {
      const subject = r.subject as { a: string; b: string; input: string };
      const dimensions: Record<string, DimensionVerdict> = {};
      for (const d of dims) {
        const v = r.dimensions?.[d];
        if (typeof v === "string") dimensions[d] = verdict(v);
      }
      return { inputSlug: subject.input, a: subject.a, b: subject.b, dimensions, overall: verdict(r.overall as Winner) };
    });
}

function scoresFrom(rows: EvaluationRow[]): ScoreRecord[] {
  return rows
    .filter((r) => r.evaluator === "absolute-1-5" && r.state === "pass" && r.subject.kind === "trial")
    .map((r) => {
      const subject = r.subject as { candidate: string; input: string; trial: number };
      const dimensions: Record<string, number> = {};
      for (const [k, v] of Object.entries(r.dimensions ?? {})) if (typeof v === "number") dimensions[k] = v;
      return { candidate: subject.candidate, inputSlug: subject.input, trial: subject.trial, dimensions, overall: r.overall as number };
    });
}

function close(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Math.abs(a - b) < EPS;
}

const fixtures = await canonicalFixtures();

test("at least one canonical fixture exists", () => {
  assert.ok(fixtures.length > 0, "no fixtures/<run>/ with scores.jsonl + report.json");
});

for (const dir of fixtures) {
  const name = path.basename(dir);

  test(`${name}: pristine aggregate over canonical rows equals report.json scorecards`, async () => {
    const trials = await readJsonl<TrialRow>(path.join(dir, "scores.jsonl"));
    const evaluations = await readJsonl<EvaluationRow>(path.join(dir, "evaluations.jsonl"));
    const report = JSON.parse(await fs.readFile(path.join(dir, "report.json"), "utf-8")) as Report;
    const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf-8")) as RunManifest;

    const dims = Object.keys(report.scorecards[0]?.dimensionWinRates ?? {});
    const suite = {
      suiteId: report.suiteId,
      step: report.step,
      rubricFile: "",
      candidates: report.candidates,
      judge: report.judge,
      inputs: report.inputs,
      trials: manifest.execution.trials_per_case,
      dimensions: dims,
    } satisfies Suite;

    const rebuilt = legacyAggregate(suite, recordsFrom(trials), judgementsFrom(evaluations, dims), scoresFrom(evaluations));

    assert.equal(rebuilt.length, report.scorecards.length);
    for (const expected of report.scorecards) {
      const got = rebuilt.find((s) => s.candidate === expected.candidate);
      assert.ok(got, `missing scorecard for ${expected.candidate}`);
      assert.ok(close(got.winRate, expected.winRate), `${expected.candidate} winRate ${got.winRate} vs ${expected.winRate}`);
      assert.ok(close(got.okRate, expected.okRate), `${expected.candidate} okRate`);
      assert.ok(close(got.objectivePassRate, expected.objectivePassRate), `${expected.candidate} objectivePassRate`);
      assert.ok(close(got.avgCostUsd, expected.avgCostUsd), `${expected.candidate} avgCostUsd`);
      assert.ok(close(got.avgMs, expected.avgMs), `${expected.candidate} avgMs`);
      assert.ok(close(got.absoluteScore, expected.absoluteScore), `${expected.candidate} absoluteScore`);
      for (const d of dims) {
        assert.ok(close(got.dimensionWinRates[d], expected.dimensionWinRates[d]), `${expected.candidate} dim win ${d}`);
        assert.ok(close(got.dimensionScores?.[d], expected.dimensionScores?.[d]), `${expected.candidate} dim score ${d}`);
      }
    }
  });

  test(`${name}: canonical generation cost sums to records.json cost`, async () => {
    const trials = await readJsonl<TrialRow>(path.join(dir, "scores.jsonl"));
    const records = JSON.parse(await fs.readFile(path.join(dir, "records.json"), "utf-8")) as Array<{ costUsd: number }>;
    const canon = trials.reduce((s, t) => s + t.cost.generation, 0);
    const legacy = records.reduce((s, r) => s + r.costUsd, 0);
    assert.ok(close(canon, legacy), `${canon} vs ${legacy}`);
  });

  test(`${name}: every evaluator failure is visible, none silently dropped`, async () => {
    const evaluations = await readJsonl<EvaluationRow>(path.join(dir, "evaluations.jsonl"));
    const trials = await readJsonl<TrialRow>(path.join(dir, "scores.jsonl"));
    const okPerInput = new Map<string, Set<string>>();
    for (const t of trials) {
      if (t.legacy_status !== "ok") continue;
      const set = okPerInput.get(t.input) ?? new Set<string>();
      okPerInput.set(t.input, set.add(t.candidate));
    }
    const candidates = [...new Set(trials.map((t) => t.candidate))];
    const inputs = [...new Set(trials.map((t) => t.input))];
    const expectedPairs = inputs.length * ((candidates.length * (candidates.length - 1)) / 2);
    const pairRows = evaluations.filter((e) => e.evaluator === "pairwise-swap").length;
    assert.equal(pairRows, expectedPairs, "each candidate pair per input has exactly one pairwise row (pass, evaluator_error or not_evaluated)");
  });
}
