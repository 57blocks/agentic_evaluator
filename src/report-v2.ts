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
import { NO_PICK } from "./report-format.js";
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
          ? "无人淘汰"
          : g.removed.map((r) => `${escapeHtml(r.candidate)}（${escapeHtml(r.detail)}）`).join("；");
      const remaining = g.remaining.length > 0 ? g.remaining.map(escapeHtml).join("、") : "无";
      return `<li><b>${escapeHtml(g.label)}</b> — 淘汰：${removed}。剩下：${remaining}。</li>`;
    })
    .join("");
}

function firmnessTag(firmness: Recommendation["firmness"]): string {
  switch (firmness) {
    case "firm":
      return "FIRM";
    case "directional":
      return "DIRECTIONAL";
    case "needs-review":
      return "NEEDS-REVIEW";
  }
}

function candidateMark(gated: boolean, chosen: boolean): string {
  if (gated) return `<span class="model">未过门</span>`;
  if (chosen) return `<span class="model">推荐</span>`;
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
    ? `推荐 <b>${escapeHtml(rec.chosen)}</b> <span class="mode">· ${escapeHtml(modeLabel(rec.operating_mode))}</span>`
    : `<b>没有可推荐的候选</b> <span class="mode">· ${escapeHtml(modeLabel(rec.operating_mode))}</span>`;
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
  const tag = firmnessTag(rec.firmness);
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
        <td class="num">${winBar(v.winRate)}${fmtPct(v.winRate)}<span class="sub">${v.comparisons} 场</span></td>
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
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(m.run_name)} 运行报告</title>
<style>${PAGE_STYLE}${EVIDENCE_STYLES}${CHART_STYLES}</style></head>
<body><div class="page">
  <header class="run">
    <p class="eyebrow">Agentic Evaluator · run report · protocol ${escapeHtml(m.protocol_version)}</p>
    <h1>${escapeHtml(m.step.id)} 步骤 · <span class="id">${escapeHtml(m.run_name)}</span></h1>
    <dl class="kv">
      <div><dt>规格</dt><dd>${escapeHtml(m.spec.path ?? "—")} · sha256 ${sha8(m.spec.sha256)}</dd></div>
      <div><dt>测试集</dt><dd>${escapeHtml(m.test_set.id ?? "—")} · ${Object.keys(inputs).length} 个输入</dd></div>
      <div><dt>试验计划</dt><dd>${views.length} 候选 × ${Object.keys(inputs).length} 输入 × ${trialsPer} 次 = ${b.trials.length}</dd></div>
      <div><dt>裁判</dt><dd>${escapeHtml(m.judge.model)} · rubric ${sha8(m.evaluators.rubric_sha256)}</dd></div>
      <div><dt>模式</dt><dd>${escapeHtml(m.execution.benchmark_mode)} · ${escapeHtml(m.execution.cache_mode)} cache</dd></div>
      <div><dt>运行时间</dt><dd>${escapeHtml(m.started_at.slice(0, 16).replace("T", " "))} → ${escapeHtml((m.finished_at ?? "").slice(11, 16))}</dd></div>
      <div><dt>运行模式</dt><dd>${escapeHtml(modeLabel(m.operating_mode))} · ${escapeHtml(FIRMNESS_LABEL[rec.firmness])}${rec.chosen ? ` · 推荐 ${escapeHtml(rec.chosen)}` : ` · ${NO_PICK}`}</dd></div>
      <div><dt>harness</dt><dd>${escapeHtml(m.harness.version)} · ${escapeHtml(m.harness.git_sha ?? "—")}</dd></div>
    </dl>
  </header>

  ${renderHero(b, views, support)}

  <section class="card">
    <h2>筛选过程 <span class="hint">逐道门槛淘汰，剩下的按运行模式选 · 规则 ${escapeHtml(rec.rule_version)}</span></h2>
    <ol class="trace">${filterList(rec)}</ol>
    <p class="note">通过全部门槛：${rec.eligible.length ? rec.eligible.map(escapeHtml).join("、") : "无"}。裁判胜率只作参考，不参与筛选。</p>
  </section>

  <section class="card">
    <h2>候选结果 <span class="hint">同一组输入，按候选配对；每格 ${trialsPer} 次</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>候选</th><th>任务结果</th><th class="num">必过检查</th><th class="num">成对胜率</th><th class="num">绝对分 1–5</th><th class="num">每次成功生成成本</th><th class="num">p50 耗时</th><th>完成状态</th></tr></thead>
      <tbody>${candidateRows}</tbody>
    </table></div>
    <p class="note">必过检查的分母是检查实际执行的次数。成对胜率只用每格第一次成功输出，tie 计 0.5。每次成功生成成本不含裁判费用，全口径见成本分账。${m.control_candidate ? `对照候选：${escapeHtml(m.control_candidate)}。` : ""}</p>
  </section>

  <div class="two-col">
    <section class="card">
      <h2>评估覆盖 <span class="hint">评估器自己的状态，先于任何通过率</span></h2>
      <div class="table-wrap"><table>
        <thead><tr><th>评估器</th><th>版本</th><th class="num">应执行</th><th class="num">pass / fail</th><th class="num">未评估</th><th class="num">评估器错误</th></tr></thead>
        <tbody>${coverageRows}</tbody>
      </table></div>
      ${errorNotes ? `<ul class="gaps">${errorNotes}</ul>` : `<p class="note">本次没有评估器错误。</p>`}
    </section>
    <section class="card">
      <h2>成本分账 <span class="hint">来源：${escapeHtml(led.source)}</span></h2>
      <div class="table-wrap"><table class="ledger"><tbody>
        <tr><td>候选生成 · ${b.trials.length} 次</td><td class="num">${fmtUsd(led.generation)}</td></tr>
        <tr><td>成对裁判</td><td class="num">${fmtUsd(led.judging)}</td></tr>
        <tr><td>绝对打分</td><td class="num">${fmtUsd(led.scoring)}</td></tr>
        <tr><td>确定性检查</td><td class="num">${fmtUsd(led.checks)}</td></tr>
        <tr><td>重试与恢复</td><td class="num">${fmtUsd(led.retries)}</td></tr>
        <tr class="total"><td>合计</td><td class="num">${fmtUsd(led.total)}</td></tr>
        <tr><td>每次成功的全口径成本</td><td class="num">${fmtUsd(led.cost_per_success)}</td></tr>
      </tbody></table></div>
      <p class="note">${ledgerNote(led)}</p>
    </section>
  </div>

  <section class="card">
    <h2>评分画像 <span class="hint">${absoluteRan ? "两个透镜：幅度看绝对分，方向看成对胜率" : "只有方向：绝对打分按 spec 声明未运行"}</span></h2>
    ${
      absoluteRan && judgeDiscrimination(b.trials).saturated.length > 0
        ? `<p class="note"><b>注意：</b>绝对打分在 ${escapeHtml(judgeDiscrimination(b.trials).saturated.join("、"))} 上对所有候选给了同一个分。这些分数没有测出差异，推荐不会采用它们。</p>`
        : ""
    }
    ${
      absoluteRan
        ? ""
        : `<p class="note"><b>绝对打分未运行。</b>这个 step 的 <code>methods</code> 里没有声明 <code>absolute-1-5</code>，所以本次没有"幅度"这把尺子——空的分数列是声明的结果，不是漏跑或失败。</p>`
    }
    ${
      absoluteRan
        ? `<div class="viz-grid2">${renderRadar(b.trials)}${renderTrialStrip(b.trials)}</div>${renderHeatmap(b.trials)}`
        : ""
    }
    ${renderDimensionPreference(b.evaluations)}
    ${
      absoluteRan
        ? `<p class="note"><b>两个刻度，两个问题。</b>上表是<b>幅度</b>：每份输出单独打的 1–5 分，看差距有多大。下表是<b>方向</b>：捉对比较里谁被偏好，0–100。成对是零和的，分母只有每个候选参与的对局数——<code>0</code> 意味「每场都输」，不是「输出差」，<code>100</code> 同理。两者可以同时为真：一个候选可能每场都略输（方向 0），绝对分却只差 1 分（幅度 4.0 对 5.0）。</p>`
        : `<p class="note">成对是零和的，分母只有每个候选参与的对局数——<code>0</code> 意味「每场都输」，不是「输出差」。</p>`
    }
  </section>

  ${renderDuels(b.evaluations)}

  ${renderTrials(b.trials)}

  ${renderOutputs(b.outputs)}

  <section class="card">
    <h2>本次未观测到的字段 <span class="hint">GAPS.md</span></h2>
    <ul class="gaps">${gapsHtml}</ul>
  </section>

  <section class="card">
    <h2>原始记录</h2>
    <details><summary>scores.jsonl 第一行</summary><pre>${escapeHtml(sampleTrial)}</pre></details>
    <details><summary>manifest.json</summary><pre>${escapeHtml(JSON.stringify(m, null, 1))}</pre></details>
  </section>

  <footer><span>${escapeHtml(path.basename(b.dir))}/</span><span>离线可开，无外部依赖</span><span>trace.jsonl · evaluations.jsonl · ledger.json · summary.json · recommendation.json</span></footer>
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
