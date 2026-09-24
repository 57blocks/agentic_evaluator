/**
 * Canonical run report — one self-contained HTML page rendered from the
 * protocol-shaped files in a run directory (manifest, scores, evaluations,
 * ledger, summary, GAPS).
 *
 *   pnpm run report -- runs/<runId>          → writes runs/<runId>/report.html
 *
 * Reads only; every number on the page traces to a row in those files.
 * Eligibility and the operating-mode recommendation are recomputed from
 * manifest + summary (select-v1) so an old run directory can still produce
 * recommendation.json without re-calling a model.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CostLedger } from "./canon/cost.js";
import type { RunManifest } from "./canon/manifest.js";
import type { EvaluationRow, TrialRow } from "./canon/rows.js";
import type { CanonSummary } from "./canon/write.js";
import { recommendFromCanon, type Recommendation } from "./canon/select.js";
import { FIRMNESS_LABEL, firmnessNote, gateRows, judgeNote, modeLabel } from "./report-copy.js";
import { NO_PICK, plural } from "./report-format.js";
import {
  candidateViews, evaluatorErrorSubject, fmtPct, fmtScore, fmtSec, fmtUsd, judgeFavourite,
  ledgerNote, sha8, stateTone, subtitleReasons, verdictFacts, verdictText,
  type CandidateView,
} from "./report-model.js";
import { judgeDiscrimination } from "./canon/discrimination.js";
import { escapeHtml } from "./html.js";
import { PAGE_STYLE } from "./report-style.js";
import { isWorkflowRun, writeWorkflowReport } from "./report-workflow.js";
import { CHART_STYLES, renderHeatmap, renderRadar, renderTrialStrip } from "./report-charts.js";
import {
  EVIDENCE_STYLES,
  loadRawOutputs,
  renderDimensionPreference,
  renderDuels,
  renderOutputs,
  renderTrials,
  type RawOutput,
} from "./report-evidence.js";

export interface RunBundle {
  dir: string;
  manifest: RunManifest;
  trials: TrialRow[];
  evaluations: EvaluationRow[];
  ledger: CostLedger;
  summary: CanonSummary;
  recommendation: Recommendation;
  gaps: string;
  outputs: RawOutput[];
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const raw = await fs.readFile(file, "utf-8");
  return raw.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as T);
}

export async function loadBundle(dir: string): Promise<RunBundle> {
  const read = async <T>(name: string): Promise<T> => JSON.parse(await fs.readFile(path.join(dir, name), "utf-8")) as T;
  const manifest = await read<RunManifest>("manifest.json");
  const summary = await read<CanonSummary>("summary.json");
  const trials = await readJsonl<TrialRow>(path.join(dir, "scores.jsonl"));
  const recommendation = recommendFromCanon(manifest, summary, trials);
  return {
    dir,
    manifest,
    outputs: await loadRawOutputs(dir, trials),
    trials,
    evaluations: await readJsonl<EvaluationRow>(path.join(dir, "evaluations.jsonl")),
    ledger: await read<CostLedger>("ledger.json"),
    summary,
    recommendation,
    gaps: await fs.readFile(path.join(dir, "GAPS.md"), "utf-8").catch(() => ""),
  };
}

// ── rendering helpers ──────────────────────────────────────────────────────

function filterList(rec: Recommendation): string {
  return gateRows(rec)
    .map((g) => {
      const removed =
        g.removed.length === 0
          ? "nobody removed"
          : g.removed.map((r) => `${escapeHtml(r.candidate)} (${escapeHtml(r.detail)})`).join("; ");
      const remaining = g.remaining.length > 0 ? g.remaining.map(escapeHtml).join(", ") : "none";
      return `<li><b>${escapeHtml(g.label)}</b> — removed: ${removed}. Remaining: ${remaining}.</li>`;
    })
    .join("");
}

function candidateMark(gated: boolean, chosen: boolean): string {
  if (gated) return `<span class="model">gated out</span>`;
  if (chosen) return `<span class="model">recommended</span>`;
  return "";
}

// ── render ─────────────────────────────────────────────────────────────────


/**
 * The headline, in the legacy report's idiom: one line you can read at a
 * glance. What it names is the RECOMMENDATION — eligibility gates first, then
 * the declared operating mode — not the judge's favourite. The judge's own
 * verdict sits beside it, because the two can disagree and that disagreement
 * is information: on this run the cheapest eligible candidate was also the one
 * the judge ranked last, which says the required check is too weak.
 */
function renderHero(b: RunBundle, views: readonly CandidateView[], support: readonly string[]): string {
  const rec = b.recommendation;
  const best = judgeFavourite(b);

  const headline = rec.chosen
    ? `Recommend <b>${escapeHtml(rec.chosen)}</b> <span class="mode">· ${escapeHtml(modeLabel(rec.operating_mode))}</span>`
    : `<b>No candidate to recommend</b> <span class="mode">· ${escapeHtml(modeLabel(rec.operating_mode))}</span>`;
  const facts = verdictFacts(rec, views.find((v) => v.id === rec.chosen));

  const judgeLine = escapeHtml(judgeNote(best, rec.chosen));

  return `<div class="verdict ${escapeHtml(rec.firmness)}">
    <span class="tag">${escapeHtml(FIRMNESS_LABEL[rec.firmness])}</span>
    <div>
      <p class="champ-line">${headline}</p>
      <p class="champ-facts">${facts.map(escapeHtml).join(" · ")}</p>
      <p class="sub">${escapeHtml(verdictText(b))}</p>
      <p class="sub">${judgeLine}</p>
      <p class="sub">${escapeHtml(firmnessNote(rec.firmness, support))}</p>
    </div>
  </div>`;
}


/** Required checks as a pill: green when every executed check passed. */
function checkPill(v: CandidateView): string {
  if (v.checkExecuted === 0) return "—";
  const all = v.checkPass === v.checkExecuted;
  return `<span class="pill ${all ? "pass" : "miss"}">${v.checkPass} / ${v.checkExecuted}</span>`;
}

/** The legacy report's inline win-rate bar; absent when nothing was compared. */
function winBar(winRate: number | null): string {
  if (winRate === null) return "";
  return `<span class="bar"><span style="width:${Math.max(0, Math.min(100, winRate)).toFixed(0)}%"></span></span>`;
}

export function renderRunReport(b: RunBundle): string {
  const m = b.manifest;
  const rec = b.recommendation;
  const views = candidateViews(b);
  const absoluteRan = b.trials.some((t) => t.judge.absolute_overall !== null);
  const support = subtitleReasons(rec, b.summary.directionality);
  const inputs = m.test_set.inputs;
  const trialsPer = m.execution.trials_per_case;
  const evaluatorErrors = b.evaluations.filter((e) => e.state === "evaluator_error");
  const gapsHtml = b.gaps
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => `<li>${escapeHtml(l.slice(2)).replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`)
    .join("");

  const colorOf = new Map(views.map((v, i) => [v.id, i % 4]));
  const candidateRows = views
    .map((v) => {
      const isControl = m.control_candidate === v.id;
      const gated = !rec.eligible.includes(v.id);
      const chosen = rec.chosen === v.id;
      const rowClass = [isControl ? "control" : "", gated ? "gated" : "", chosen ? "chosen" : ""]
        .filter(Boolean)
        .join(" ");
      const states = v.states
        .map(([s, n]) => `<span class="${stateTone(s)}">${n} ${escapeHtml(s)}</span>`)
        .join("");
      const outcomes = `<span class="ok">${v.outcomes.success} success</span><span class="bad">${v.outcomes.failure} failure</span><span class="warn">${v.outcomes.undetermined} undetermined</span>`;
      return `<tr${rowClass ? ` class="${rowClass}"` : ""}>
        <td class="cand"><span class="sw sw${colorOf.get(v.id) ?? 0}"></span>${escapeHtml(v.id)}${candidateMark(gated, chosen)}<span class="model">${escapeHtml(v.model)} · ${escapeHtml(v.deployment)}</span></td>
        <td><div class="state-list">${outcomes}</div></td>
        <td class="num">${checkPill(v)}</td>
        <td class="num">${winBar(v.winRate)}${fmtPct(v.winRate)}<span class="sub">${v.comparisons} matches</span></td>
        <td class="num">${fmtScore(v.absolute)}</td>
        <td class="num">${fmtUsd(v.costPerSuccess)}</td>
        <td class="num">${fmtSec(v.p50)}</td>
        <td><div class="state-list">${states}</div></td>
      </tr>`;
    })
    .join("");

  const coverageRows = b.summary.evaluation_coverage
    .map(
      (c) => `<tr><td>${escapeHtml(c.evaluator)}</td><td class="mono small">${escapeHtml(c.version)}</td>
        <td class="num">${c.pass + c.fail + c.not_evaluated + c.evaluator_error}</td>
        <td class="num">${c.pass} / ${c.fail}</td>
        <td class="num">${c.not_evaluated > 0 ? `<span class="pill warn">${c.not_evaluated}</span>` : "0"}</td>
        <td class="num">${c.evaluator_error > 0 ? `<span class="pill warn">${c.evaluator_error}</span>` : "0"}</td></tr>`,
    )
    .join("");

  const errorNotes = evaluatorErrors
    .map((e) => {
      return `<li><code>${escapeHtml(e.evaluator)}</code> ${escapeHtml(evaluatorErrorSubject(e))}: ${escapeHtml(e.reason ?? "")}</li>`;
    })
    .join("");

  const led = b.ledger;
  const sampleTrial = b.trials[0] ? JSON.stringify(b.trials[0], null, 1) : "{}";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(m.run_name)} run report</title>
<style>${PAGE_STYLE}${EVIDENCE_STYLES}${CHART_STYLES}</style></head>
<body><div class="page">
  <header class="run">
    <p class="eyebrow">Agentic Evaluator · run report · protocol ${escapeHtml(m.protocol_version)}</p>
    <h1>Step ${escapeHtml(m.step.id)} · <span class="id">${escapeHtml(m.run_name)}</span></h1>
    <dl class="kv">
      <div><dt>Spec</dt><dd>${escapeHtml(m.spec.path ?? "—")} · sha256 ${sha8(m.spec.sha256)}</dd></div>
      <div><dt>Test set</dt><dd>${escapeHtml(m.test_set.id ?? "—")} · ${Object.keys(inputs).length} input(s)</dd></div>
      <div><dt>Trial plan</dt><dd>${plural(views.length, "candidate")} × ${plural(Object.keys(inputs).length, "input")} × ${plural(trialsPer, "trial")} = ${b.trials.length}</dd></div>
      <div><dt>Judge</dt><dd>${escapeHtml(m.judge.model)} · rubric ${sha8(m.evaluators.rubric_sha256)}</dd></div>
      <div><dt>Mode</dt><dd>${escapeHtml(m.execution.benchmark_mode)} · ${escapeHtml(m.execution.cache_mode)} cache</dd></div>
      <div><dt>Run time</dt><dd>${escapeHtml(m.started_at.slice(0, 16).replace("T", " "))} → ${escapeHtml((m.finished_at ?? "").slice(11, 16))}</dd></div>
      <div><dt>Operating mode</dt><dd>${escapeHtml(modeLabel(m.operating_mode))} · ${escapeHtml(FIRMNESS_LABEL[rec.firmness])}${rec.chosen ? ` · recommend ${escapeHtml(rec.chosen)}` : ` · ${NO_PICK}`}</dd></div>
      <div><dt>harness</dt><dd>${escapeHtml(m.harness.version)} · ${escapeHtml(m.harness.git_sha ?? "—")}</dd></div>
    </dl>
  </header>

  ${renderHero(b, views, support)}

  <section class="card">
    <h2>Selection <span class="hint">each eligibility gate removes candidates, the operating mode picks among the rest · rule ${escapeHtml(rec.rule_version)}</span></h2>
    <ol class="trace">${filterList(rec)}</ol>
    <p class="note">Passed every gate: ${rec.eligible.length ? rec.eligible.map(escapeHtml).join(", ") : "none"}. The judge's win rate is for reference only and takes no part in selection.</p>
  </section>

  <section class="card">
    <h2>Candidates <span class="hint">the same inputs, paired by candidate; ${trialsPer} trial(s) per cell</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Candidate</th><th>Outcome</th><th class="num">Required check</th><th class="num">Pairwise win rate</th><th class="num">Absolute score 1–5</th><th class="num">Generation cost per success</th><th class="num">p50 duration</th><th>Completion</th></tr></thead>
      <tbody>${candidateRows}</tbody>
    </table></div>
    <p class="note">The required check's denominator is the number of times the check actually ran. Pairwise win rate uses only the first successful output per cell; a tie counts 0.5. Generation cost per success excludes judging; the full cost is in the cost breakdown.${m.control_candidate ? ` Control candidate: ${escapeHtml(m.control_candidate)}.` : ""}</p>
  </section>

  <div class="two-col">
    <section class="card">
      <h2>Evaluation coverage <span class="hint">the evaluators' own state, before any pass rate</span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Evaluator</th><th>Version</th><th class="num">Expected</th><th class="num">pass / fail</th><th class="num">Not evaluated</th><th class="num">Evaluator error</th></tr></thead>
        <tbody>${coverageRows}</tbody>
      </table></div>
      ${errorNotes ? `<ul class="gaps">${errorNotes}</ul>` : `<p class="note">No evaluator errors in this run.</p>`}
    </section>
    <section class="card">
      <h2>Cost breakdown <span class="hint">source: ${escapeHtml(led.source)}</span></h2>
      <div class="table-wrap"><table class="ledger"><tbody>
        <tr><td>Candidate generation · ${b.trials.length} trials</td><td class="num">${fmtUsd(led.generation)}</td></tr>
        <tr><td>Pairwise judging</td><td class="num">${fmtUsd(led.judging)}</td></tr>
        <tr><td>Absolute scoring</td><td class="num">${fmtUsd(led.scoring)}</td></tr>
        <tr><td>Deterministic checks</td><td class="num">${fmtUsd(led.checks)}</td></tr>
        <tr><td>Retries and recovery</td><td class="num">${fmtUsd(led.retries)}</td></tr>
        <tr class="total"><td>Total</td><td class="num">${fmtUsd(led.total)}</td></tr>
        <tr><td>Full cost per success</td><td class="num">${fmtUsd(led.cost_per_success)}</td></tr>
      </tbody></table></div>
      <p class="note">${ledgerNote(led)}</p>
    </section>
  </div>

  <section class="card">
    <h2>Scoring profile <span class="hint">${absoluteRan ? "two lenses: magnitude from absolute scores, direction from pairwise win rate" : "direction only: absolute scoring was not run, as the spec declares"}</span></h2>
    ${
      absoluteRan && judgeDiscrimination(b.trials).saturated.length > 0
        ? `<p class="note"><b>Note:</b> absolute scoring gave every candidate the same score on ${escapeHtml(judgeDiscrimination(b.trials).saturated.join(", "))}. Those scores measured no difference, and the recommendation does not use them.</p>`
        : ""
    }
    ${
      absoluteRan
        ? ""
        : `<p class="note"><b>Absolute scoring was not run.</b> This step's <code>methods</code> does not declare <code>absolute-1-5</code>, so this run has no "magnitude" ruler. The empty score columns are what was declared, not a skipped or failed run.</p>`
    }
    ${
      absoluteRan
        ? `<div class="viz-grid2">${renderRadar(b.trials)}${renderTrialStrip(b.trials)}</div>${renderHeatmap(b.trials)}`
        : ""
    }
    ${renderDimensionPreference(b.evaluations)}
    ${
      absoluteRan
        ? `<p class="note"><b>Two scales, two questions.</b> The upper table is <b>magnitude</b>: a 1–5 score given to each output on its own, showing how big the gap is. The lower table is <b>direction</b>: who was preferred in head-to-head comparisons, 0–100. Pairwise is zero-sum and its denominator is only the matches each candidate took part in. <code>0</code> means "lost every match", not "bad output", and likewise <code>100</code>. Both can be true at once: a candidate can narrowly lose every match (direction 0) while trailing by only 1 point on absolute score (magnitude 4.0 vs 5.0).</p>`
        : `<p class="note">Pairwise is zero-sum and its denominator is only the matches each candidate took part in. <code>0</code> means "lost every match", not "bad output".</p>`
    }
  </section>

  ${renderDuels(b.evaluations)}

  ${renderTrials(b.trials)}

  ${renderOutputs(b.outputs)}

  <section class="card">
    <h2>Fields this run did not observe <span class="hint">GAPS.md</span></h2>
    <ul class="gaps">${gapsHtml}</ul>
  </section>

  <section class="card">
    <h2>Raw records</h2>
    <details><summary>First line of scores.jsonl</summary><pre>${escapeHtml(sampleTrial)}</pre></details>
    <details><summary>manifest.json</summary><pre>${escapeHtml(JSON.stringify(m, null, 1))}</pre></details>
  </section>

  <footer><span>${escapeHtml(path.basename(b.dir))}/</span><span>opens offline, no external dependencies</span><span>trace.jsonl · evaluations.jsonl · ledger.json · summary.json · recommendation.json</span></footer>
</div></body></html>`;
}


export async function writeRunReport(runDir: string): Promise<string> {
  const bundle = await loadBundle(runDir);
  await fs.writeFile(path.join(runDir, "recommendation.json"), JSON.stringify(bundle.recommendation, null, 2), "utf-8");
  const out = path.join(runDir, "report.html");
  await fs.writeFile(out, renderRunReport(bundle), "utf-8");
  return out;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: report <runs/<runId>>");
    process.exit(2);
  }
  const root = path.resolve(dir);
  const out = (await isWorkflowRun(root)) ? await writeWorkflowReport(root) : await writeRunReport(root);
  console.log(`✔ ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
