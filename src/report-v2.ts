/**
 * Canonical run report — one self-contained HTML page rendered from the
 * protocol-shaped files in a run directory (manifest, scores, evaluations,
 * ledger, summary, GAPS). The legacy report stays as legacy-report.html.
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
import { modelRefOf } from "./adapters/types.js";
import type { CostLedger } from "./canon/cost.js";
import type { RunManifest } from "./canon/manifest.js";
import type { EvaluationRow, TrialRow } from "./canon/rows.js";
import type { CanonSummary } from "./canon/write.js";
import { recommendFromCanon, type Recommendation } from "./canon/select.js";
import { escapeHtml } from "./html.js";
import { CHART_STYLES, renderHeatmap, renderRadar, renderTrialStrip } from "./report-charts.js";
import {
  EVIDENCE_STYLES,
  loadRawOutputs,
  renderDuels,
  renderOutputs,
  renderTrials,
  type RawOutput,
} from "./report-evidence.js";

interface RunBundle {
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

// ── derived views ──────────────────────────────────────────────────────────

interface CandidateView {
  id: string;
  model: string;
  deployment: string;
  attempts: number;
  checkPass: number;
  checkExecuted: number;
  winRate: number | null;
  comparisons: number;
  absolute: number | null;
  costPerSuccess: number | null;
  p50: number | null;
  states: Array<[string, number]>;
  outcomes: { success: number; failure: number; undetermined: number };
}

function winRate(candidate: string, rows: EvaluationRow[]): { rate: number | null; comparisons: number } {
  let wins = 0;
  let comparisons = 0;
  for (const r of rows) {
    if (r.evaluator !== "pairwise-swap" || r.state !== "pass" || r.subject.kind !== "pair") continue;
    const { a, b } = r.subject;
    if (a !== candidate && b !== candidate) continue;
    comparisons += 1;
    const side = a === candidate ? "a" : "b";
    if (r.overall === side) wins += 1;
    else if (r.overall === "tie") wins += 0.5;
  }
  return { rate: comparisons > 0 ? (wins / comparisons) * 100 : null, comparisons };
}

function candidateViews(b: RunBundle): CandidateView[] {
  return b.summary.candidates.map((c) => {
    const own = b.trials.filter((t) => t.candidate === c.candidate);
    const def = b.manifest.candidates[c.candidate];
    const deployments = [...new Set(own.map((t) => t.deployment_ref).filter((d): d is string => d !== null))];
    const abs = own.map((t) => t.judge.absolute_overall).filter((v): v is number => v !== null);
    const wr = winRate(c.candidate, b.evaluations);
    return {
      id: c.candidate,
      model: def ? modelRefOf(def) : c.candidate,
      deployment: deployments.join(", ") || "—",
      attempts: c.valid_attempts,
      checkPass: c.check_states.pass,
      checkExecuted: c.check_states.pass + c.check_states.fail,
      winRate: wr.rate,
      comparisons: wr.comparisons,
      absolute: abs.length ? abs.reduce((s, v) => s + v, 0) / abs.length : null,
      costPerSuccess: c.generation_cost_per_success,
      p50: c.p50_ms,
      states: Object.entries(c.completion_states).filter(([, n]) => n > 0),
      outcomes: c.outcomes,
    };
  });
}

// ── formatting ─────────────────────────────────────────────────────────────

const fmtUsd = (v: number | null | undefined): string => (v == null ? "—" : `$${v.toFixed(4)}`);
const fmtPct = (v: number | null | undefined): string => (v == null ? "—" : `${v.toFixed(0)}%`);
const fmtScore = (v: number | null | undefined): string => (v == null ? "—" : v.toFixed(1));
const fmtSec = (ms: number | null | undefined): string => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);
const sha8 = (s: string | null | undefined): string => (s ? s.slice(0, 8) : "—");

function stateClass(state: string): string {
  if (state === "success" || state === "pass") return "ok";
  if (state === "undetermined" || state === "not_evaluated" || state === "evaluator_error") return "warn";
  return "bad";
}

function withPeriod(text: string): string {
  return text.endsWith("。") ? text : `${text}。`;
}

function verdictText(b: RunBundle): string {
  const rec = b.recommendation;
  const step = b.manifest.step.id;
  const parts: string[] = [];
  if (rec.eligible.length === 0) {
    parts.push(`步骤 ${step} 没有合格候选，选择器不给出配置推荐。`);
  } else if (rec.chosen) {
    parts.push(`运行模式 ${rec.operating_mode ?? "未声明"} 下推荐 ${rec.chosen}。`);
    if (rec.compared_to_control) parts.push(rec.compared_to_control.reason + "。");
  } else {
    parts.push(`步骤 ${step} 有合格候选，但选择器未能选出推荐。`);
  }
  if (rec.reasons[0]) parts.push(withPeriod(rec.reasons[0]));
  return parts.join(" ");
}

function filterList(rec: Recommendation): string {
  return rec.filters
    .map((f) => {
      const removed =
        f.removed.length === 0
          ? "无人被剔除"
          : f.removed.map((r) => `${escapeHtml(r.candidate)}（${escapeHtml(r.reason)}）`).join("；");
      const remaining = f.remaining.length > 0 ? f.remaining.map(escapeHtml).join("、") : "无";
      return `<li><b>${escapeHtml(f.id)}</b> — ${escapeHtml(f.description)}。剔除：${removed}。剩余：${remaining}。</li>`;
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

function subtitleReasons(rec: Recommendation, directionality: { reasons: string[] }): string[] {
  return rec.firmness === "directional" ? directionality.reasons : rec.reasons;
}

function candidateMark(gated: boolean, chosen: boolean): string {
  if (gated) return `<span class="model">未过门</span>`;
  if (chosen) return `<span class="model">推荐</span>`;
  return "";
}

// ── render ─────────────────────────────────────────────────────────────────

export function renderRunReport(b: RunBundle): string {
  const m = b.manifest;
  const rec = b.recommendation;
  const views = candidateViews(b);
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

  const candidateRows = views
    .map((v) => {
      const isControl = m.control_candidate === v.id;
      const gated = !rec.eligible.includes(v.id);
      const chosen = rec.chosen === v.id;
      const rowClass = [isControl ? "control" : "", gated ? "gated" : "", chosen ? "chosen" : ""]
        .filter(Boolean)
        .join(" ");
      const states = v.states
        .map(([s, n]) => `<span class="${stateClass(s)}">${n} ${escapeHtml(s)}</span>`)
        .join("");
      const outcomes = `<span class="ok">${v.outcomes.success} success</span><span class="bad">${v.outcomes.failure} failure</span><span class="warn">${v.outcomes.undetermined} undetermined</span>`;
      return `<tr${rowClass ? ` class="${rowClass}"` : ""}>
        <td class="cand">${escapeHtml(v.id)}${candidateMark(gated, chosen)}<span class="model">${escapeHtml(v.model)} · ${escapeHtml(v.deployment)}</span></td>
        <td><div class="state-list">${outcomes}</div></td>
        <td class="num">${v.checkExecuted > 0 ? `${v.checkPass} / ${v.checkExecuted}` : "—"}</td>
        <td class="num">${fmtPct(v.winRate)}<span class="sub">${v.comparisons} 场</span></td>
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
      const subject =
        e.subject.kind === "pair" ? `${e.subject.a} vs ${e.subject.b} · ${e.subject.input}` : `${e.subject.candidate} · ${e.subject.input} · t${e.subject.trial}`;
      return `<li><code>${escapeHtml(e.evaluator)}</code> ${escapeHtml(subject)}: ${escapeHtml(e.reason ?? "")}</li>`;
    })
    .join("");

  const led = b.ledger;
  const sampleTrial = b.trials[0] ? JSON.stringify(b.trials[0], null, 1) : "{}";

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(m.run_name)} 运行报告</title>
<style>${STYLE}${EVIDENCE_STYLES}${CHART_STYLES}</style></head>
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
      <div><dt>运行模式</dt><dd>${escapeHtml(m.operating_mode ?? "—")} · ${escapeHtml(rec.firmness)}${rec.chosen ? ` · 推荐 ${escapeHtml(rec.chosen)}` : " · 无推荐"}</dd></div>
      <div><dt>harness</dt><dd>${escapeHtml(m.harness.version)} · ${escapeHtml(m.harness.git_sha ?? "—")}</dd></div>
    </dl>
  </header>

  <div class="verdict ${escapeHtml(rec.firmness)}">
    <span class="tag">${tag} · ${Object.keys(inputs).length} INPUTS</span>
    <div><p>${escapeHtml(verdictText(b))}</p>
    <p class="sub">${support.map((r) => escapeHtml(r)).join("；") || "样本与阈值满足决策级要求"}</p></div>
  </div>

  <section class="card">
    <h2>推荐轨迹 <span class="hint">select-v1 · 只读 summary.json，不重跑模型</span></h2>
    <ol class="trace">${filterList(rec)}</ol>
    <p class="note">合格：${rec.eligible.length ? rec.eligible.map(escapeHtml).join("、") : "无"}。成对胜率仍展示但不进入选择器。</p>
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
      <p class="note">${led.generation > 0 ? `评估花费是生成的 ${((led.judging + led.scoring + led.retries) / led.generation).toFixed(1)} 倍。` : ""}${led.cost_per_success === null ? "没有成功的任务，每次成功成本无定义。" : ""}</p>
    </section>
  </div>

  <section class="card">
    <h2>评分画像 <span class="hint">同一份 scores.jsonl，图与表不会打架</span></h2>
    <div class="viz-grid2">
      ${renderRadar(b.trials)}
      ${renderTrialStrip(b.trials)}
    </div>
    ${renderHeatmap(b.trials)}
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

  <footer><span>${escapeHtml(path.basename(b.dir))}/</span><span>legacy-report.html 保留用于对账</span><span>trace.jsonl · evaluations.jsonl · ledger.json · summary.json · recommendation.json</span></footer>
</div></body></html>`;
}

const STYLE = `
:root{--ground:#F3F4F6;--surface:#fff;--surface-2:#E9ECF0;--ink:#1A1F26;--ink-2:#4B5563;--ink-3:#8A94A3;--rule:#D6DBE2;--accent:#2F5D8A;--accent-soft:#DCE7F2;--ok-bg:#DDF1E4;--ok-fg:#1E6B3A;--bad-bg:#F8DEDC;--bad-fg:#9B2C25;--warn-bg:#F8ECD2;--warn-fg:#7D5410}
@media(prefers-color-scheme:dark){:root{--ground:#12161B;--surface:#1A2027;--surface-2:#232B34;--ink:#E7EAEE;--ink-2:#B3BCC7;--ink-3:#7C8794;--rule:#2E3741;--accent:#7FB0DE;--accent-soft:#24384D;--ok-bg:#1F3A2A;--ok-fg:#8FD6A8;--bad-bg:#43231F;--bad-fg:#F0A29C;--warn-bg:#3F3319;--warn-fg:#EACB7C}}
body{margin:0;background:var(--ground);color:var(--ink);font:14px/1.6 "IBM Plex Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif;padding:28px 20px 64px}
.page{max-width:68rem;margin:0 auto;display:grid;gap:20px}
.mono,td.num,.kv dd,code,pre{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.small{font-size:12px}
header.run{display:grid;gap:6px}.eyebrow{margin:0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600}
h1{margin:0;font-size:26px;font-weight:600;letter-spacing:-.01em}h1 .id{font-family:"IBM Plex Mono",monospace;font-weight:500}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 20px;margin:8px 0 0;padding:12px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
.kv div{display:grid;gap:2px}.kv dt{font-size:12px;color:var(--ink-3)}.kv dd{margin:0;font-size:13px;overflow-wrap:anywhere}
.verdict{display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:start;background:var(--surface);border-left:4px solid var(--warn-fg);padding:14px 18px;border-radius:6px}
.verdict.firm{border-left-color:var(--ok-fg)}.verdict.needs-review{border-left-color:var(--bad-fg)}
.verdict .tag{font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:12px;letter-spacing:.08em;background:var(--warn-bg);color:var(--warn-fg);padding:4px 10px;border-radius:4px;white-space:nowrap}
.verdict.firm .tag{background:var(--ok-bg);color:var(--ok-fg)}.verdict.needs-review .tag{background:var(--bad-bg);color:var(--bad-fg)}
.verdict p{margin:0}.verdict .sub{color:var(--ink-2);font-size:13px;margin-top:4px}
section.card{background:var(--surface);border-radius:8px;padding:18px 20px;display:grid;gap:12px}
section.card h2{margin:0;font-size:15px;font-weight:600;display:flex;gap:10px;align-items:baseline}section.card h2 .hint{font-size:12px;color:var(--ink-3);font-weight:400}
.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th{text-align:left;font-weight:500;color:var(--ink-3);font-size:12px;padding:6px 10px;border-bottom:1px solid var(--rule);white-space:nowrap}
th.num,td.num{text-align:right}td{padding:9px 10px;border-bottom:1px solid var(--rule);vertical-align:top}tr:last-child td{border-bottom:none}
td.cand{font-weight:600}td.cand .model{display:block;font-weight:400;font-size:12px;color:var(--ink-3);font-family:"IBM Plex Mono",monospace}
td .sub{display:block;font-size:11px;color:var(--ink-3)}
tr.control td.cand::after{content:"对照";margin-left:8px;font-size:11px;color:var(--accent);background:var(--accent-soft);padding:1px 6px;border-radius:3px;font-weight:500}
tr.chosen td.cand{color:var(--ok-fg)}tr.gated td{color:var(--ink-3)}
ol.trace{margin:0;padding-left:1.2em;font-size:13px;color:var(--ink-2);display:grid;gap:8px}
.pill{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:999px;white-space:nowrap}.pill.warn{background:var(--warn-bg);color:var(--warn-fg)}
.state-list{font-size:12px;color:var(--ink-2);display:flex;flex-wrap:wrap;gap:4px 10px}.state-list .bad{color:var(--bad-fg)}.state-list .warn{color:var(--warn-fg)}.state-list .ok{color:var(--ok-fg)}
.two-col{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}
.ledger td:first-child{color:var(--ink-2)}.ledger tr.total td{font-weight:600;border-top:2px solid var(--rule)}
.note{font-size:12.5px;color:var(--ink-2);margin:0}code{background:var(--surface-2);padding:0 5px;border-radius:3px;font-size:12px}
ul.gaps{margin:0;padding-left:1.1em;font-size:13px;color:var(--ink-2);display:grid;gap:4px}
details{font-size:13px}summary{cursor:pointer;color:var(--accent);font-weight:500}
pre{margin:8px 0 0;padding:12px;background:var(--surface-2);border-radius:6px;overflow-x:auto;font-size:12px;line-height:1.55;max-height:420px}
footer{font-size:12px;color:var(--ink-3);display:flex;gap:16px;flex-wrap:wrap}
@media(max-width:480px){h1{font-size:20px}.verdict{grid-template-columns:1fr}section.card{padding:14px}}
`;

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
  const out = await writeRunReport(path.resolve(dir));
  console.log(`✔ ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
