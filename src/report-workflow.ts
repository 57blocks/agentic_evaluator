/**
 * Canonical workflow report — the page above the per-step reports, rendered
 * from `workflow.json` and the workflow `GAPS.md` in a multi-step run root.
 *
 *   pnpm run report -- runs/<runId>          → workflow page when workflow.json exists
 *
 * It is the only view of three things: the §8 validation verdict with the
 * metric it was decided on, the whole-workflow cost, and the comparisons this
 * run did not make. Steps that are merely independent (no `input_from`) render
 * the same page without a verdict rather than pretending a workflow was tested.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { CostLedger } from "./canon/cost.js";
import { workflowGaps, workflowLedger, type WorkflowArm, type WorkflowRecord, type WorkflowStepRecord } from "./canon/workflow.js";
import { escapeHtml } from "./html.js";
import { PAGE_STYLE } from "./report-style.js";
import { workflowNoVerdictLine, workflowVerdictLine, workflowVerdictTone } from "./report-model.js";
import { STEPS_NOT_VALIDATED } from "./report-format.js";

const usd = (n: number): string => `$${n.toFixed(4)}`;
const num = (n: number | null, digits = 2): string => (n === null ? "—" : n.toFixed(digits));

function renderVerdict(record: WorkflowRecord): string {
  const v = record.e2e_validation ?? null;
  if (v === null) {
    const note = workflowNoVerdictLine(record.handoff);
    return `<div class="verdict">
    <span class="tag">no-validation</span>
    <div><p>${escapeHtml(note)}</p>
    <p class="sub">${STEPS_NOT_VALIDATED}</p></div>
  </div>`;
  }
  const reasons = (v.reasons ?? []).length > 0 ? v.reasons.map(escapeHtml).join("；") : "—";
  return `<div class="verdict ${workflowVerdictTone(v)}">
    <span class="tag">${escapeHtml(v.verdict)}</span>
    <div><p>${escapeHtml(workflowVerdictLine(v))}</p>
    <p class="sub">${escapeHtml(v.firmness)} · 运行模式 ${escapeHtml(v.operating_mode ?? "—")} · 规则 ${escapeHtml(v.rule_version ?? "—")}<br>${reasons}</p></div>
  </div>`;
}

function renderChain(record: WorkflowRecord): string {
  const v = record.e2e_validation ?? null;
  const control = v?.control_assignment ?? null;
  const proposed = v?.assignment ?? null;
  if (control === null && proposed === null) return "";
  const ids = record.steps.map((s) => s.id);
  const rows = ids
    .map((id) => {
      const c = control?.[id] ?? "—";
      const p = proposed?.[id] ?? "—";
      const same = c === p;
      return `<tr><td class="cand">${escapeHtml(id)}</td><td>${escapeHtml(c)}</td><td${same ? "" : ' class="cand"'}>${escapeHtml(p)}${same ? "" : " ←"}</td></tr>`;
    })
    .join("");
  return `<section class="card">
    <h2>两个臂的指派 <span class="hint">同一批 (输入, trial)</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>step</th><th>control 臂</th><th>proposed 臂</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="note">control 臂全链用同一个对照候选；proposed 臂用各 step 推荐的候选。箭头标出两者不同的 step。</p>
  </section>`;
}

function armRow(arm: WorkflowArm | null, label: string): string {
  if (arm === null) return `<tr><td>${escapeHtml(label)}</td><td colspan="5" class="note">未运行</td></tr>`;
  return `<tr><td class="cand">${escapeHtml(label)}</td><td class="num">${arm.cases ?? "—"}</td><td class="num">${arm.success}</td><td class="num">${arm.failure}</td><td class="num">${arm.undetermined}</td><td class="num">${usd(arm.cost_usd)}</td></tr>`;
}

function renderArms(record: WorkflowRecord): string {
  if (!record.e2e_control && !record.e2e_proposed) return "";
  const deltas = record.e2e_validation?.deltas ?? null;
  const delta = deltas
    ? `<p class="note">判定指标 <code>${escapeHtml(deltas.metric)}</code>：proposed ${num(deltas.proposed, 4)} vs control ${num(deltas.control, 4)}，改进 ${num(deltas.improvement, 4)}，最小有意义差异 ${deltas.mmd === null ? "未声明" : deltas.mmd}。配对 ${deltas.paired ? `${deltas.paired.compared} 例（两臂都成功 ${deltas.paired.both_success}，只有 proposed ${deltas.paired.proposed_only}，只有 control ${deltas.paired.control_only}，都失败 ${deltas.paired.neither}）` : "无"}。</p>`
    : `<p class="note">没有指标比较：判决不依赖差值。</p>`;
  return `<section class="card">
    <h2>端到端两臂</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>臂</th><th class="num">工作流数</th><th class="num">成功</th><th class="num">失败</th><th class="num">未判定</th><th class="num">成本</th></tr></thead>
      <tbody>${armRow(record.e2e_control ?? null, "control")}${armRow(record.e2e_proposed ?? null, "proposed")}</tbody>
    </table></div>
    ${delta}
  </section>`;
}

function stepRow(s: WorkflowStepRecord): string {
  const gated = (s.gated ?? []).length > 0 ? s.gated.map((g) => `${g.candidate}（${g.reason}）`).join("；") : "无";
  const link = `<a href="${encodeURIComponent(s.dir)}/report.html">${escapeHtml(s.dir)}/report.html</a>`;
  return `<tr class="${s.chosen ? "chosen" : ""}">
    <td class="cand">${escapeHtml(s.id)}<span class="model">${escapeHtml(s.operating_mode ?? "无运行模式")}</span></td>
    <td>${s.chosen ? escapeHtml(s.chosen) : '<span class="pill warn">无人合格</span>'}<span class="sub">${escapeHtml(s.firmness)}</span></td>
    <td class="small">${escapeHtml(gated)}</td>
    <td class="num">${s.trials}</td>
    <td class="num">${s.ledger_total == null ? "—" : usd(s.ledger_total)}</td>
    <td class="small">${link}</td>
  </tr>`;
}

function renderSteps(record: WorkflowRecord): string {
  return `<section class="card">
    <h2>各 step 的推荐 <span class="hint">独立评测，未经工作流验证</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>step</th><th>推荐</th><th>被资格门剔除</th><th class="num">trials</th><th class="num">成本</th><th>报告</th></tr></thead>
      <tbody>${record.steps.map(stepRow).join("")}</tbody>
    </table></div>
  </section>`;
}

function renderLedger(record: WorkflowRecord): string {
  const l = record.ledger;
  const row = (label: string, v: number, cls = ""): string =>
    `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="num">${usd(v)}</td></tr>`;
  return `<section class="card">
    <h2>全工作流成本 <span class="hint">来源：${escapeHtml(l.source)}</span></h2>
    <div class="table-wrap"><table class="ledger">
      <tbody>
        ${row("生成", l.generation)}${row("裁判", l.judging)}${row("打分", l.scoring)}${row("检查", l.checks)}${row("重试", l.retries)}
        ${row("各 step 合计", l.steps_total)}${row("端到端两臂", l.e2e_total)}${row("总系统成本", l.total, "total")}
      </tbody>
    </table></div>
    <p class="note">端到端的臂单列：那是额外的生成，不是对 step 证据的重复计数。</p>
  </section>`;
}

function renderGaps(gaps: string): string {
  const blocks = gaps
    .split("\n")
    .filter((l) => l.startsWith("- ") || l.startsWith("## "))
    .map((l) =>
      l.startsWith("## ")
        ? `<li class="sub"><b>${escapeHtml(l.slice(3))}</b></li>`
        : `<li>${escapeHtml(l.slice(2)).replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`,
    )
    .join("");
  return `<section class="card">
    <h2>未观测与未比较 <span class="hint">GAPS.md</span></h2>
    <ul class="gaps">${blocks}</ul>
  </section>`;
}

export function renderWorkflowReport(record: WorkflowRecord, gaps: string): string {
  const steps = record.steps.length;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(record.run_name)} 工作流报告</title>
<style>${PAGE_STYLE}</style></head>
<body><div class="page">
  <header class="run">
    <p class="eyebrow">Agentic Evaluator · workflow report · protocol ${escapeHtml(record.protocol_version)}</p>
    <h1>工作流 · <span class="id">${escapeHtml(record.run_name)}</span></h1>
    <dl class="kv">
      <div><dt>运行</dt><dd>${escapeHtml(record.run_id)}</dd></div>
      <div><dt>step 数</dt><dd>${steps} 个${record.handoff ? " · 链式交接" : " · 相互独立"}</dd></div>
      <div><dt>总系统成本</dt><dd>${usd(record.ledger.total)}</dd></div>
      <div><dt>端到端</dt><dd>${record.e2e_validation ? escapeHtml(`${record.e2e_validation.verdict} · ${record.e2e_validation.firmness}`) : "未做"}</dd></div>
    </dl>
  </header>
  ${renderVerdict(record)}
  ${renderChain(record)}
  ${renderArms(record)}
  ${renderSteps(record)}
  ${renderLedger(record)}
  ${renderGaps(gaps)}
  <footer><span>${escapeHtml(record.run_id)}/</span><span>workflow.json · e2e-validation.json</span><span>每个 step 的证据在各自目录</span></footer>
</div></body></html>
`;
}

/** True when this run directory is a multi-step root rather than one step. */
export async function isWorkflowRun(dir: string): Promise<boolean> {
  return fs
    .access(path.join(dir, "workflow.json"))
    .then(() => true)
    .catch(() => false);
}

/**
 * Read `workflow.json`, filling in what a run written before the workflow
 * ledger existed does not carry. Missing cost is read back from each step's
 * `ledger.json` — never invented — and a step whose file is gone is left out
 * of the total rather than counted as zero.
 */
export async function loadWorkflowRecord(root: string): Promise<WorkflowRecord> {
  const raw = JSON.parse(await fs.readFile(path.join(root, "workflow.json"), "utf-8")) as WorkflowRecord;
  if (raw.ledger && raw.steps.every((s) => s.ledger)) return raw;

  const steps: WorkflowStepRecord[] = [];
  for (const s of raw.steps) {
    const ledger =
      s.ledger ??
      (JSON.parse(
        await fs.readFile(path.join(root, s.dir, "ledger.json"), "utf-8").catch(() => "null"),
      ) as CostLedger | null);
    steps.push({ ...s, ...(ledger ? { ledger, ledger_total: ledger.total } : {}) });
  }
  const arms = [raw.e2e_control, raw.e2e_proposed].filter((a): a is WorkflowArm => a != null);
  const priced = steps.filter((s) => s.ledger);
  return { ...raw, steps, ledger: raw.ledger ?? workflowLedger(priced, arms) };
}

/** Root GAPS.md, or — for a run written before it existed — rebuilt from the steps'. */
export async function workflowGapsFor(root: string, record: WorkflowRecord): Promise<string> {
  const written = await fs.readFile(path.join(root, "GAPS.md"), "utf-8").catch(() => "");
  if (written !== "") return written;
  const steps = await Promise.all(
    record.steps.map(async (s) => ({
      id: s.id,
      gaps: await fs.readFile(path.join(root, s.dir, "GAPS.md"), "utf-8").catch(() => ""),
    })),
  );
  return workflowGaps(steps, record.e2e_validation ?? null);
}

export async function writeWorkflowReport(root: string): Promise<string> {
  const record = await loadWorkflowRecord(root);
  const gaps = await workflowGapsFor(root, record);
  const out = path.join(root, "report.html");
  await fs.writeFile(out, renderWorkflowReport(record, gaps), "utf-8");
  return out;
}
