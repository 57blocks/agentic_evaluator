/**
 * Absolute re-scoring over FROZEN outputs — the cheap path.
 *
 *   tsx eval/src/rescore.ts                 # re-score the latest run per step
 *   EVAL_SCORE_MODEL=openai/gpt-5.4-mini tsx eval/src/rescore.ts   # cheaper grader
 *
 * For each target run dir it reads the already-generated `raw/*.txt` outputs
 * (NO regeneration — zero generation cost), grades each 1–5 against the suite
 * rubric (see `score.ts`), re-aggregates the scorecards (pairwise judgements are
 * kept as-is), and rewrites report.{json,md,html}. Finally it re-renders the
 * combined dashboard. Only grader (judge-model) calls cost money — O(n) in
 * outputs, far cheaper than the O(n²) pairwise pass.
 *
 * Grader model: `EVAL_SCORE_MODEL` if set, else the run's original judge.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { aggregate, loadEnvLocal, scoreAll } from "./run.js";
import { renderMarkdown, renderHtml } from "./report.js";
import { renderDashboardHtml } from "./dashboard.js";
import type { RunRecordLite } from "./render.js";
import type { Report, RunRecord, Suite } from "./types.js";

import { REPO_ROOT, runsDir, suitesDir } from "./paths.js";

/** Steps we know how to map back to `eval/suites/<step>.json`. */
const STEP_ORDER = ["prd", "trd", "taskbreakdown", "codegen"] as const;

/** OpenRouter ids contain `/` (and `:`) — must match run.ts's raw-file naming. */
function safeName(candidate: string): string {
  return candidate.replace(/[/:]/g, "_");
}

/** Fallback concurrency; mirrors run.ts's default. */
function resolveConcurrency(): number {
  const parsed = parseInt(process.env.EVAL_CONCURRENCY ?? "", 10);
  return Number.isNaN(parsed) ? 5 : Math.max(1, parsed);
}

async function readJson(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

/** Newest run dir per step under `resultsDir` (dir names sort by embedded ts). */
async function latestRunDirs(
  resultsDir: string,
): Promise<Array<{ step: string; dir: string }>> {
  let names: string[];
  try {
    const entries = await fs.readdir(resultsDir, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const best = new Map<string, string>();
  for (const name of names) {
    const step = STEP_ORDER.find((s) => name.startsWith(`${s}-`));
    if (!step) continue;
    const cur = best.get(step);
    if (!cur || name.localeCompare(cur) > 0) best.set(step, name);
  }
  // Preserve canonical PDLC order.
  return STEP_ORDER.filter((s) => best.has(s)).map((step) => ({
    step,
    dir: path.join(resultsDir, best.get(step)!),
  }));
}

/** Rebuild full RunRecords (with text) from a text-stripped records.json + raw/. */
async function loadRecordsWithText(
  dir: string,
  lite: RunRecordLite[],
): Promise<RunRecord[]> {
  const records: RunRecord[] = [];
  for (const r of lite) {
    let text = "";
    if (r.status === "ok") {
      const rawPath = path.join(
        dir,
        "raw",
        `${safeName(r.candidate)}__${r.inputSlug}__t${r.trial}.txt`,
      );
      try {
        text = await fs.readFile(rawPath, "utf-8");
      } catch {
        // Missing raw file → leave empty; scoreAll skips blank outputs.
      }
    }
    records.push({ ...r, text });
  }
  return records;
}

interface Rescored {
  report: Report;
  records: RunRecordLite[];
}

/** Re-score one run dir in place; returns the updated report (+ its lite records
 *  for the dashboard), or null when the dir can't be processed. */
async function rescoreDir(
  step: string,
  dir: string,
  scoreModelOverride: string | undefined,
  limit: number,
): Promise<Rescored | null> {
  const shortDir = path.basename(dir);
  const report = (await readJson(path.join(dir, "report.json"))) as Report | null;
  if (!report || !Array.isArray(report.scorecards)) {
    console.error(`  skip ${shortDir}: no valid report.json`);
    return null;
  }
  const suiteRaw = (await readJson(
    path.join(suitesDir(), `${step}.json`),
  )) as Suite | null;
  if (!suiteRaw) {
    console.error(`  skip ${shortDir}: no suites/${step}.json`);
    return null;
  }
  const lite = (await readJson(path.join(dir, "records.json"))) as
    | RunRecordLite[]
    | null;
  if (!Array.isArray(lite)) {
    console.error(`  skip ${shortDir}: no records.json`);
    return null;
  }

  // Trust the report for what actually ran (candidates/inputs/judge); take the
  // rubric + dimensions from the suite. `EVAL_SCORE_MODEL` overrides the grader.
  const suite: Suite = {
    ...suiteRaw,
    step: report.step,
    candidates: report.candidates,
    inputs: report.inputs,
    judge: scoreModelOverride ?? report.judge,
  };
  const rubric = await fs.readFile(
    path.resolve(REPO_ROOT, suite.rubricFile),
    "utf-8",
  );

  const records = await loadRecordsWithText(dir, lite);
  const okCount = records.filter((r) => r.status === "ok" && r.text.trim()).length;
  console.log(`\n▶ Re-scoring ${step} (${shortDir}) — ${okCount} outputs · grader ${suite.judge}\n`);

  const scores = await scoreAll(suite, rubric, records, limit);
  const scorecards = aggregate(suite, records, report.judgements, scores);
  const updated: Report = { ...report, scorecards, scores };

  await fs.writeFile(
    path.join(dir, "report.json"),
    JSON.stringify(updated, null, 2),
    "utf-8",
  );
  await fs.writeFile(path.join(dir, "report.md"), renderMarkdown(updated), "utf-8");
  await fs.writeFile(path.join(dir, "report.html"), renderHtml(updated), "utf-8");
  console.log(`  ✔ ${scores.length} scored · updated report.{json,md,html}`);
  return { report: updated, records: lite };
}

async function main(): Promise<void> {
  await loadEnvLocal();
  const resultsDir = runsDir();
  const targets = await latestRunDirs(resultsDir);
  if (targets.length === 0) {
    console.error(`No run dirs found under ${path.relative(REPO_ROOT, resultsDir)}/.`);
    process.exit(1);
  }

  const scoreModelOverride = process.env.EVAL_SCORE_MODEL || undefined;
  const limit = resolveConcurrency();
  const updated: Rescored[] = [];
  for (const { step, dir } of targets) {
    const r = await rescoreDir(step, dir, scoreModelOverride, limit);
    if (r) updated.push(r);
  }

  if (updated.length === 0) {
    console.error("\nNothing re-scored.");
    process.exit(1);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const recordsByStep: Record<string, RunRecordLite[]> = {};
  for (const u of updated) recordsByStep[u.report.step] = u.records;
  const dashPath = path.join(resultsDir, `dashboard-${ts}.html`);
  await fs.writeFile(
    dashPath,
    renderDashboardHtml(updated.map((u) => u.report), recordsByStep),
    "utf-8",
  );
  console.log(
    `\n✔ re-scored ${updated.length} step(s); combined dashboard → ${path.relative(REPO_ROOT, dashPath)}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
