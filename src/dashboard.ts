/**
 * Combined cross-step dashboard — merges each step's report.json into ONE
 * self-contained HTML page (PRD / TRD / taskBreakdown / codeGen at a glance).
 *
 *   tsx eval/src/dashboard.ts
 *
 * Renders a top champions summary plus one per-step card (shared with the
 * single-suite report via `render.ts`). Same constraints: plain string
 * building, ZERO external deps, inline CSS, light/dark auto, wide tables inside
 * `overflow-x:auto`. `renderDashboardHtml` is pure so `run-all.ts` can render
 * the batch it just produced in-process.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Report } from "./types.js";
import {
  SHARED_STYLE,
  candidateColorClass,
  champion,
  escapeHtml,
  fmtRecord,
  fmtScore,
  hasAbsolute,
  hasObjective,
  overallRecord,
  passRatePill,
  renderAiRecommendations,
  renderAiVerdict,
  renderStepCard,
  type RunRecordLite,
} from "./render.js";
import {
  type Lang,
  LANGS,
  caveatHtml,
  duelCount,
  t,
  totalSpendLine,
} from "./i18n.js";
import { generateAiSummary, type AiSummary } from "./summarize.js";
import { loadEnvLocal } from "./run.js";

/** Re-exported for `run-all.ts` (its records reader is typed against this). */
export type { RunRecordLite };

import { REPO_ROOT, runsDir } from "./paths.js";

/** Canonical PDLC ordering for step sections; unknown steps sort last. */
const STEP_ORDER = ["prd", "trd", "taskbreakdown", "codegen"] as const;

/** Order reports by canonical PDLC step; stable within unknown steps. */
function orderReports(reports: Report[]): Report[] {
  const rank = (step: string): number => {
    const i = STEP_ORDER.indexOf(step as (typeof STEP_ORDER)[number]);
    return i === -1 ? STEP_ORDER.length : i;
  };
  return [...reports].sort((a, b) => rank(a.step) - rank(b.step));
}

// ── section renderers ──────────────────────────────────────────────────────

/**
 * Data-derived summary banner — FACTS only, not a hand-written verdict. Lists
 * each step's preference champion plus the cheapest model overall and the best
 * codegen tsc pass rate, all computed from the scorecards. Labelled "自动汇总"
 * so it's never mistaken for a human judgement call.
 */
function renderAutoVerdict(reports: Report[], lang: Lang): string {
  if (reports.length === 0) return "";
  const short = (c: string): string => c.split("/").pop() ?? c;

  const champs = reports
    .map((r) => {
      const c = champion(r);
      return c && c.winRate !== null
        ? `${escapeHtml(r.step.toUpperCase())} <b>${escapeHtml(short(c.candidate))}</b>`
        : null;
    })
    .filter((x): x is string => x !== null);

  // Cheapest overall: lowest summed avg cost across the steps it appears in.
  const cost = new Map<string, number>();
  for (const r of reports) {
    for (const s of r.scorecards) {
      cost.set(s.candidate, (cost.get(s.candidate) ?? 0) + s.avgCostUsd);
    }
  }
  let cheapest: string | null = null;
  let min = Infinity;
  for (const [cand, total] of cost) {
    if (total < min) {
      min = total;
      cheapest = cand;
    }
  }

  // Best objective (tsc) on codegen, if that step is present.
  const cg = reports.find((r) => r.step === "codegen");
  let bestTsc: string | null = null;
  if (cg) {
    let best = -1;
    for (const s of cg.scorecards) {
      if (s.objectivePassRate != null && s.objectivePassRate > best) {
        best = s.objectivePassRate;
        bestTsc = s.candidate;
      }
    }
  }

  const facts: string[] = [];
  if (cheapest) facts.push(`${t(lang, "cheapest")} <b>${escapeHtml(short(cheapest))}</b>`);
  if (bestTsc) facts.push(`${t(lang, "bestTsc")} <b>${escapeHtml(short(bestTsc))}</b>`);

  return `<div class="verdict">
    <p class="vlabel">${t(lang, "autoVerdictLabel")}</p>
    <p class="vbig">${t(lang, "perStepChamps")}${champs.join(" · ")}</p>
    ${facts.length ? `<p class="vsub">${facts.join(" · ")}</p>` : ""}
  </div>`;
}

/** Top summary: each step's champion + its head-to-head record + absolute score. */
function renderChampionsTable(
  reports: Report[],
  showScoreCol: boolean,
  showObjCol: boolean,
  lang: Lang,
): string {
  const scoreHead = showScoreCol ? `<th>${t(lang, "absScore")} <span class="sub">1–5</span></th>` : "";
  const objHead = showObjCol ? `<th>${t(lang, "objScore")}</th>` : "";
  const rows = reports
    .map((report) => {
      const best = champion(report);
      const ranked = best && best.winRate !== null;
      const nameCell = ranked
        ? `<span class="model"><span class="sw ${candidateColorClass(report, best!.candidate)}"></span><span class="m">${escapeHtml(best!.candidate)}</span></span>`
        : "—";
      const rec = ranked ? overallRecord(report, best!.candidate) : null;
      const winCell = rec
        ? `<b>${fmtRecord(rec)}</b> ${duelCount(lang, rec.comparisons)}`
        : "—";
      const scoreCell = showScoreCol
        ? `<td><b>${best ? fmtScore(best.absoluteScore) : "—"}</b></td>`
        : "";
      const objCell = showObjCol
        ? `<td>${best ? passRatePill(best) : "—"}</td>`
        : "";
      return `<tr>
        <td>${escapeHtml(report.step.toUpperCase())}</td>
        <td>${nameCell}</td>
        <td>${winCell}</td>${scoreCell}${objCell}
      </tr>`;
    })
    .join("\n");
  return `<h2>${t(lang, "championsHead")}</h2>
  <div class="scroll"><table>
    <thead><tr><th>${t(lang, "step")}</th><th>${t(lang, "champion")}</th><th>${t(lang, "record")} <span class="sub">${t(lang, "wlt")}</span></th>${scoreHead}${objHead}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/** Total spend across every recorded run, or "" when no records are present. */
function renderTotalSpend(
  recordsByStep: Record<string, RunRecordLite[]> | undefined,
  lang: Lang,
): string {
  if (!recordsByStep) return "";
  const all = Object.values(recordsByStep).flat();
  if (all.length === 0) return "";
  const total = all.reduce((sum, r) => sum + (r.costUsd || 0), 0);
  return `<div class="total">${totalSpendLine(lang, total.toFixed(4), all.length)}</div>`;
}

/**
 * Render the combined dashboard for one batch of step reports. Pure: given the
 * same reports (+ optional per-step records) it always produces the same HTML.
 * `recordsByStep` is keyed by `Report.step`; missing/undefined entries simply
 * hide the per-step objective-detail block and the footer total.
 */
/** The full page body for ONE language (everything below the toggle button). */
function renderBody(
  ordered: Report[],
  recordsByStep: Record<string, RunRecordLite[]> | undefined,
  aiSummary: AiSummary | undefined,
  lang: Lang,
): string {
  const generatedAt = ordered.map((r) => r.generatedAt).sort().at(-1) ?? "";
  const judges = [...new Set(ordered.map((r) => r.judge))];
  const candidates = [...new Set(ordered.flatMap((r) => r.candidates))];
  const showObjCol = ordered.some(hasObjective);
  const showScoreCol = ordered.some(hasAbsolute);

  const meta = ordered.length
    ? `${t(lang, "generatedAt")}:${escapeHtml(generatedAt)} · ${t(lang, "judge")}:${escapeHtml(judges.join(", "))}<br>
  ${t(lang, "candidates")}:${escapeHtml(candidates.join(", "))}`
    : t(lang, "noReports");

  const sections = ordered
    .map((report) => renderStepCard(report, lang, recordsByStep?.[report.step]))
    .join("\n");

  return `  <p class="eyebrow">${t(lang, "eyebrow")}</p>
  <h1>${t(lang, "dashTitle")}</h1>
  <p class="lede">${t(lang, "lede")}</p>
  <div class="meta">${meta}</div>
  ${ordered.length ? (aiSummary ? renderAiVerdict(aiSummary, lang) : renderAutoVerdict(ordered, lang)) : ""}
  ${ordered.length ? caveatHtml(lang) : ""}
  ${ordered.length ? renderChampionsTable(ordered, showScoreCol, showObjCol, lang) : ""}
  ${aiSummary ? renderAiRecommendations(aiSummary, lang) : ""}
  ${sections}
  ${renderTotalSpend(recordsByStep, lang)}`;
}

/**
 * Tiny inline script for the zh/EN toggle: flips which `.doc` is visible and
 * swaps the button label. Self-contained, no deps — matches the harness's
 * "zero external deps, inline everything" constraint.
 */
const LANG_TOGGLE_SCRIPT = `<script>
(function(){
  var btn=document.getElementById('langToggle');
  if(!btn)return;
  var labels={zh:${JSON.stringify(t("zh", "langToggle"))},en:${JSON.stringify(t("en", "langToggle"))}};
  function apply(l){
    document.querySelectorAll('.doc').forEach(function(d){d.hidden=(d.dataset.doc!==l)});
    document.documentElement.lang=(l==='zh'?'zh-CN':'en');
    btn.textContent=labels[l];
    btn.dataset.lang=l;
  }
  btn.addEventListener('click',function(){apply(btn.dataset.lang==='zh'?'en':'zh')});
  apply('zh');
})();
</script>`;

export function renderDashboardHtml(
  reports: Report[],
  recordsByStep?: Record<string, RunRecordLite[]>,
  aiSummary?: AiSummary,
): string {
  const ordered = orderReports(reports);

  const docs = LANGS.map(
    (lang) =>
      `<div class="doc" data-doc="${lang}"${lang === "zh" ? "" : " hidden"}>
${renderBody(ordered, recordsByStep, aiSummary, lang)}
</div>`,
  ).join("\n");

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${t("zh", "dashTitle")}</title>
${SHARED_STYLE}</head>
<body>
  <button id="langToggle" class="langbtn" type="button" data-lang="zh">${t("zh", "langToggle")}</button>
${docs}
${LANG_TOGGLE_SCRIPT}
</body></html>`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/** Narrow a parsed report.json to `Report`, or null when the shape is wrong. */
function coerceReport(raw: unknown): Report | null {
  if (!isObject(raw)) return null;
  const { suiteId, step, judge, generatedAt, candidates, inputs, scorecards, judgements } =
    raw;
  if (
    typeof suiteId !== "string" ||
    typeof step !== "string" ||
    typeof judge !== "string" ||
    typeof generatedAt !== "string" ||
    !Array.isArray(candidates) ||
    !Array.isArray(inputs) ||
    !Array.isArray(scorecards) ||
    !Array.isArray(judgements)
  ) {
    return null;
  }
  // Field-level shapes are trusted (harness-owned); the report is cast once the
  // top-level envelope validates.
  return raw as unknown as Report;
}

/** Narrow a parsed records.json to `RunRecordLite[]`, or undefined when absent/bad. */
function coerceRecords(raw: unknown): RunRecordLite[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  if (!raw.every((r) => isObject(r) && typeof r.candidate === "string")) {
    return undefined;
  }
  return raw as unknown as RunRecordLite[];
}

/** Read + parse a JSON file, returning null on any read/parse failure. */
async function readJson(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

interface Discovered {
  report: Report;
  records: RunRecordLite[] | undefined;
}

/**
 * Scan eval/results/*, parse each report.json, keep the newest per step (by
 * generatedAt), and attach the same dir's records.json when present.
 */
async function discoverLatestByStep(resultsDir: string): Promise<Discovered[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(resultsDir);
  } catch {
    return [];
  }

  const latest = new Map<string, Discovered>();
  for (const entry of entries) {
    const dir = path.join(resultsDir, entry);
    const parsed = await readJson(path.join(dir, "report.json"));
    const report = coerceReport(parsed);
    if (!report) continue;

    const existing = latest.get(report.step);
    if (existing && existing.report.generatedAt >= report.generatedAt) continue;

    const records = coerceRecords(await readJson(path.join(dir, "records.json")));
    latest.set(report.step, { report, records });
  }
  return [...latest.values()];
}

async function main(): Promise<void> {
  const resultsDir = runsDir();
  const found = await discoverLatestByStep(resultsDir);

  if (found.length === 0) {
    console.log(
      `No report.json found under ${path.relative(REPO_ROOT, resultsDir)}/. ` +
        "Run an eval first (pnpm run run --suite suites/<step>.json).",
    );
    return; // exit 0 — nothing to render is not an error.
  }

  const reports = found.map((f) => f.report);
  const recordsByStep: Record<string, RunRecordLite[]> = {};
  for (const f of found) {
    if (f.records) recordsByStep[f.report.step] = f.records;
  }

  // AI 讲评 is opt-in (one LLM call) so a plain re-render stays free.
  const wantAi =
    process.env.EVAL_AI_SUMMARY === "1" || process.argv.includes("--ai");
  let aiSummary: AiSummary | undefined;
  if (wantAi) {
    await loadEnvLocal();
    const model = process.env.EVAL_SUMMARY_MODEL || "anthropic/claude-sonnet-4";
    try {
      console.log(`▶ AI 讲评 (${model})…`);
      aiSummary = await generateAiSummary({ reports, model });
    } catch (err) {
      console.error(
        `AI summary failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(resultsDir, `dashboard-${ts}.html`);
  await fs.writeFile(
    outPath,
    renderDashboardHtml(reports, recordsByStep, aiSummary),
    "utf-8",
  );

  const steps = reports.map((r) => r.step).join(", ");
  console.log(`✔ dashboard written to ${path.relative(REPO_ROOT, outPath)} (steps: ${steps})`);
}

// Run main() only when invoked directly (tsx eval/src/dashboard.ts), NOT when
// run-all.ts imports `renderDashboardHtml` from this module.
const invokedDirectly =
  import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
