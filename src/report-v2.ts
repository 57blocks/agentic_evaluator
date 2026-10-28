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
import { gapsFor, type CanonSummary } from "./canon/write.js";
import { recommendFromCanon, type Recommendation } from "./canon/select.js";
import { FIRMNESS_LABEL, firmnessNote, gateRows, judgeNote, modeLabel } from "./report-copy.js";
import { NO_PICK, plural } from "./report-format.js";
import {
  candidateViews, evaluatorErrorSubject, fmtCost, fmtPct, fmtScore, fmtSec, fmtUsd, judgeFavourite,
  ledgerNote, reviewGapLines, reviewSummary, sha8, stateTone, subtitleReasons, verdictFacts, verdictText,
  type CandidateView,
} from "./report-model.js";
import { latestVerdicts, type ReviewEntry, type ReviewRow } from "./canon/review.js";
import { escapeHtml } from "./html.js";
import { PAGE_STYLE } from "./report-style.js";
import { isWorkflowRun, writeWorkflowReport } from "./report-workflow.js";
import { CHART_STYLES, renderScoreDistribution, renderScoreSummary } from "./report-charts.js";
import { aboutOfRun, type RunAbout } from "./canon/about.js";
import { sliceRows } from "./report-slices.js";
import { renderCertainty } from "./report-certainty.js";
import { agentActivityRows, type AgentActivityRow } from "./report-model.js";
import { itemStats } from "./canon/item-stats.js";
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
  /**
   * Human verdicts from reviews/*.jsonl, latest per (reviewer, pair). Kept apart
   * from `evaluations` so nothing that selects a candidate can read them.
   */
  reviews?: ReviewRow[];
  /** What the run evaluated, in words (canon/about.ts); absent on bundles built in memory. */
  about?: RunAbout;
}

async function loadReviews(dir: string): Promise<ReviewRow[]> {
  const root = path.join(dir, "reviews");
  const files = (await fs.readdir(root).catch(() => [] as string[])).filter((f) => f.endsWith(".jsonl")).sort();
  const entries = (await Promise.all(files.map((f) => readJsonl<ReviewEntry>(path.join(root, f))))).flat();
  return latestVerdicts(entries);
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
    reviews: await loadReviews(dir),
    about: await aboutOfRun(dir, manifest),
  };
}

// ── rendering helpers ──────────────────────────────────────────────────────

/** What the run evaluated and what a pass means, before any number. Empty when the spec says neither. */
function renderAbout(b: RunBundle): string {
  const a = b.about;
  if (!a || (!a.description && !a.stepDescription && !a.checkDescription)) return "";
  const check = b.manifest.evaluators.required_checks[0];
  const stale = a.source === "current-spec" ? `<p class="note">This run predates these descriptions; they are read from the task's spec as it is now.</p>` : "";
  return `<section class="card">
    <h2>What this evaluates</h2>
    ${a.description ? `<p>${escapeHtml(a.description)}</p>` : ""}
    ${a.stepDescription ? `<p><b>This step (${escapeHtml(b.manifest.step.id)})</b>: ${escapeHtml(a.stepDescription)}</p>` : ""}
    ${a.checkDescription && check ? `<p class="note"><b>A pass of ${escapeHtml(check)}</b> means: ${escapeHtml(a.checkDescription)}</p>` : ""}
    ${stale}
  </section>`;
}

/** Required-check passes per input tag and split (report-slices.ts). Empty when the task labels no inputs. */
function renderSlices(b: RunBundle, candidates: string[]): string {
  const rows = sliceRows(b.about?.labels ?? null, b.trials, candidates, b.manifest.evaluators.required_checks[0] ?? null);
  if (rows.length === 0) return "";
  const cell = (c: { pass: number; graded: number }) => {
    const cls = c.graded === 0 ? "" : c.pass === c.graded ? " ok" : c.pass / c.graded < 0.5 ? " bad" : "";
    return `<td class="num${cls}">${c.graded === 0 ? "—" : `${c.pass}/${c.graded}`}</td>`;
  };
  const body = rows
    .map((r) => `<tr><td class="mono">${escapeHtml(r.label)}</td><td class="num">${r.inputs}</td>${candidates.map((c) => cell(r.cells[c] ?? { pass: 0, graded: 0 })).join("")}</tr>`)
    .join("");
  return `<section class="card">
    <h2>Results by input tag <span class="hint">required-check passes / graded trials, for the inputs carrying each tag or in each split</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Tag</th><th class="num">Inputs</th>${candidates.map((c) => `<th class="num">${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </section>`;
}

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

/**
 * What the judge said, in plain terms: a distribution of its 1–5 scores per
 * candidate, beside the required check, and — only when pairwise judging ran —
 * who it preferred head to head. Neither feeds the recommendation.
 */
function renderJudgeScores(b: RunBundle, absoluteRan: boolean, views: readonly CandidateView[]): string {
  const pairwise = renderDimensionPreference(b.evaluations);
  if (!absoluteRan && pairwise === "") return "";
  const checks = new Map(views.map((v) => [v.id, { pass: v.checkPass, executed: v.checkExecuted }]));
  const intro = absoluteRan
    ? `<p class="note">The judge read the free-text part of each answer against the rubric and gave it 1–5. Each bar is one candidate: how many of its trials got each score, red (1) to blue (5). Rows are ordered by <b>required check</b>, most answers right first. Read it beside <b>required check</b>, which says whether the answer itself was right: a well-written note on a wrong answer still scores high here. These scores do not affect the recommendation.</p>`
    : `<p class="note"><b>No 1–5 scores:</b> this step's <code>methods</code> does not declare <code>absolute-1-5</code>. That was declared, not missed.</p>`;
  const pairwiseNote = pairwise
    ? `<p class="note"><b>Pairwise win rate</b> (the table above) is a separate question: shown two outputs side by side, which did the judge prefer, 0–100, a tie counting 0.5. It only counts the matches each candidate took part in, so <code>0</code> means "lost every match", not "bad output".</p>`
    : "";
  return `<section class="card">
    <h2>Judge scores <span class="hint">${absoluteRan ? "1–5 per trial" : ""}${absoluteRan && pairwise ? " · " : ""}${pairwise ? "pairwise win rate" : ""} · not used by the recommendation</span></h2>
    ${intro}
    ${absoluteRan ? renderScoreSummary(b.trials, checks) + renderScoreDistribution(b.trials, checks) : ""}
    ${pairwise}${pairwiseNote}
  </section>`;
}

/** One row per command candidate whose trace was read; nothing when none was. */
function renderAgentActivity(rows: readonly AgentActivityRow[]): string {
  if (rows.length === 0) return "";
  const fmtN = (v: number | null): string => (v === null ? "—" : String(v));
  const body = rows
    .map(
      (r) => `<tr><td class="cand">${escapeHtml(r.id)}<span class="model">${r.traced} of ${r.trials} trial(s) traced${r.unreadable > 0 ? ` · ${r.unreadable} unreadable` : ""}</span></td>
        <td class="num">${fmtN(r.turnsP50)}</td><td class="num">${fmtN(r.toolCallsP50)}</td>
        <td>${r.topTools.map(([name, n]) => `<code>${escapeHtml(name)}</code> ×${n}`).join(", ") || "—"}</td>
        <td class="num">${fmtN(r.retries)}</td><td class="num">${fmtN(r.denials)}</td>
        <td>${r.ended.map(([e, n]) => `${n} ${escapeHtml(e)}`).join(", ")}</td></tr>`,
    )
    .join("");
  return `<section class="card">
      <h2>Agent activity <span class="hint">from the trace each command left (cli.trace); medians over traced trials; — where the format records nothing</span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Candidate</th><th class="num">Turns p50</th><th class="num">Tool calls p50</th><th>Most-called tools</th><th class="num">Retries</th><th class="num">Denials</th><th>Ended</th></tr></thead>
        <tbody>${body}</tbody>
      </table></div>
      <p class="note">Counts per trial are in <code>agent</code> on each row of scores.jsonl; the turn list is in traces/. Nothing here enters the selection.</p>
    </section>`;
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
  const review = reviewSummary(b);
  const gapsHtml = [
    ...b.gaps.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2)),
    ...reviewGapLines(review).map((g) => g.text),
  ]
    .map((t) => `<li>${escapeHtml(t).replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`)
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
        ${review ? `<td class="num">${winBar(v.human?.rate ?? null)}${fmtPct(v.human?.rate ?? null)}<span class="sub">${v.human?.comparisons ?? 0} reviewed</span></td>` : ""}
        <td class="num">${fmtScore(v.absolute)}</td>
        <td class="num">${fmtCost(v.costPerSuccess, v.costObserved)}</td>
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
      <div><dt>Operating mode</dt><dd>${escapeHtml(modeLabel(m.operating_mode))} · ${escapeHtml(FIRMNESS_LABEL[rec.firmness])}${rec.chosen ? ` · recommend ${escapeHtml(rec.chosen)}` : ` · ${NO_PICK}${rec.closest ? ` · closest ${escapeHtml(rec.closest.candidate)}` : ""}`}</dd></div>
      <div><dt>harness</dt><dd>${escapeHtml(m.harness.version)} · ${escapeHtml(m.harness.git_sha ?? "—")}</dd></div>
    </dl>
  </header>

  ${renderAbout(b)}

  ${renderHero(b, views, support)}

  <section class="card">
    <h2>Selection <span class="hint">each eligibility gate removes candidates, the operating mode picks among the rest · rule ${escapeHtml(rec.rule_version)}</span></h2>
    <ol class="trace">${filterList(rec)}</ol>
    ${review ? `<p class="note"><b>Blind human review</b> by ${escapeHtml(review.reviewers.join(", "))}: ${review.reviewed} of ${review.pairs} pairs.${review.agreement ? ` The judge agrees with the human on ${review.agreement.overall.agree} of ${review.agreement.overall.total} pair${review.agreement.overall.total === 1 ? "" : "s"}.` : ""} Human verdicts inform this report and do not enter the recommendation.</p>` : ""}
    <p class="note">Passed every gate: ${rec.eligible.length ? rec.eligible.map(escapeHtml).join(", ") : "none"}. The judge's win rate is for reference only and takes no part in selection.</p>
  </section>

  ${renderCertainty(rec, itemStats(b.trials))}

  <section class="card">
    <h2>Candidates <span class="hint">the same inputs, paired by candidate; ${trialsPer} trial(s) per cell</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Candidate</th><th>Outcome</th><th class="num">Required check</th><th class="num">Pairwise win rate</th>${review ? '<th class="num">Human win rate</th>' : ""}<th class="num">Absolute score 1–5</th><th class="num">Generation cost per success</th><th class="num">p50 duration</th><th>Completion</th></tr></thead>
      <tbody>${candidateRows}</tbody>
    </table></div>
    <p class="note">The required check's denominator is the number of times the check actually ran. Pairwise win rate uses only the first successful output per cell; a tie counts 0.5. Generation cost per success excludes judging; the full cost is in the cost breakdown.${m.control_candidate ? ` Control candidate: ${escapeHtml(m.control_candidate)}.` : ""}</p>
  </section>

  ${renderSlices(b, views.map((v) => v.id))}

  <div class="two-col">
    ${renderAgentActivity(agentActivityRows(b.trials, views.map((v) => v.id)))}
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
      <p class="note">${escapeHtml(ledgerNote(led, b.trials))}</p>
    </section>
  </div>

  ${renderJudgeScores(b, absoluteRan, views)}

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


/**
 * GAPS.md as the current rules derive it, keeping the bold notes later
 * commands appended (`- **combined run**`, `- **judged after the run**`).
 */
function refreshedGaps(bundle: RunBundle): string {
  const fresh = gapsFor(bundle);
  const kept = bundle.gaps.split("\n").filter((l) => l.startsWith("- **") && !fresh.includes(l));
  return kept.length === 0 ? fresh : `${fresh}\n${kept.join("\n")}\n`;
}

/** Re-derive everything a rule change can move — never a number from the rows. */
export async function writeRunReport(runDir: string): Promise<string> {
  const loaded = await loadBundle(runDir);
  const bundle = { ...loaded, gaps: refreshedGaps(loaded) };
  await Promise.all([
    fs.writeFile(path.join(runDir, "recommendation.json"), JSON.stringify(bundle.recommendation, null, 2), "utf-8"),
    fs.writeFile(path.join(runDir, "items.json"), JSON.stringify(itemStats(bundle.trials), null, 2), "utf-8"),
    fs.writeFile(path.join(runDir, "GAPS.md"), bundle.gaps, "utf-8"),
  ]);
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
