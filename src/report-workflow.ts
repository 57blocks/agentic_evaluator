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
  const reasons = (v.reasons ?? []).length > 0 ? v.reasons.map(escapeHtml).join("; ") : "—";
  return `<div class="verdict ${workflowVerdictTone(v)}">
    <span class="tag">${escapeHtml(v.verdict)}</span>
    <div><p>${escapeHtml(workflowVerdictLine(v))}</p>
    <p class="sub">${escapeHtml(v.firmness)} · operating mode ${escapeHtml(v.operating_mode ?? "—")} · rule ${escapeHtml(v.rule_version ?? "—")}<br>${reasons}</p></div>
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
    <h2>Arm assignments <span class="hint">the same (input, trial) pairs</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Step</th><th>Control arm</th><th>Proposed arm</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="note">The control arm runs the control candidate on every step; the proposed arm runs each step's recommended candidate. Arrows mark the steps where the two differ.</p>
  </section>`;
}

function armRow(arm: WorkflowArm | null, label: string): string {
  if (arm === null) return `<tr><td>${escapeHtml(label)}</td><td colspan="5" class="note">not run</td></tr>`;
  return `<tr><td class="cand">${escapeHtml(label)}</td><td class="num">${arm.cases ?? "—"}</td><td class="num">${arm.success}</td><td class="num">${arm.failure}</td><td class="num">${arm.undetermined}</td><td class="num">${usd(arm.cost_usd)}</td></tr>`;
}

function renderArms(record: WorkflowRecord): string {
  if (!record.e2e_control && !record.e2e_proposed) return "";
  const deltas = record.e2e_validation?.deltas ?? null;
  const delta = deltas
    ? `<p class="note">Decision metric <code>${escapeHtml(deltas.metric)}</code>: proposed ${num(deltas.proposed, 4)} vs control ${num(deltas.control, 4)}, improvement ${num(deltas.improvement, 4)}, minimum meaningful difference ${deltas.mmd === null ? "not declared" : deltas.mmd}. Paired: ${deltas.paired ? `${deltas.paired.compared} cases (both arms succeeded ${deltas.paired.both_success}, only proposed ${deltas.paired.proposed_only}, only control ${deltas.paired.control_only}, neither ${deltas.paired.neither})` : "none"}.</p>`
    : `<p class="note">No metric comparison: the verdict does not depend on a difference.</p>`;
  return `<section class="card">
    <h2>End-to-end arms</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Arm</th><th class="num">Workflows</th><th class="num">Success</th><th class="num">Failure</th><th class="num">Undetermined</th><th class="num">Cost</th></tr></thead>
      <tbody>${armRow(record.e2e_control ?? null, "control")}${armRow(record.e2e_proposed ?? null, "proposed")}</tbody>
    </table></div>
    ${delta}
  </section>`;
}

function stepRow(s: WorkflowStepRecord): string {
  const gated = (s.gated ?? []).length > 0 ? s.gated.map((g) => `${g.candidate} (${g.reason})`).join("; ") : "none";
  const link = `<a href="${encodeURIComponent(s.dir)}/report.html">${escapeHtml(s.dir)}/report.html</a>`;
  return `<tr class="${s.chosen ? "chosen" : ""}">
    <td class="cand">${escapeHtml(s.id)}<span class="model">${escapeHtml(s.operating_mode ?? "no operating mode")}</span></td>
    <td>${s.chosen ? escapeHtml(s.chosen) : '<span class="pill warn">no recommendation</span>'}<span class="sub">${escapeHtml(s.firmness)}</span></td>
    <td class="small">${escapeHtml(gated)}</td>
    <td class="num">${s.trials}</td>
    <td class="num">${s.ledger_total == null ? "—" : usd(s.ledger_total)}</td>
    <td class="small">${link}</td>
  </tr>`;
}

function renderSteps(record: WorkflowRecord): string {
  return `<section class="card">
    <h2>Recommendation per step <span class="hint">evaluated independently, not validated as a workflow</span></h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Step</th><th>Recommended</th><th>Gated out</th><th class="num">Trials</th><th class="num">Cost</th><th>Report</th></tr></thead>
      <tbody>${record.steps.map(stepRow).join("")}</tbody>
    </table></div>
  </section>`;
}

function renderLedger(record: WorkflowRecord): string {
  const l = record.ledger;
  const row = (label: string, v: number, cls = ""): string =>
    `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="num">${usd(v)}</td></tr>`;
  return `<section class="card">
    <h2>Whole-workflow cost <span class="hint">source: ${escapeHtml(l.source)}</span></h2>
    <div class="table-wrap"><table class="ledger">
      <tbody>
        ${row("Generation", l.generation)}${row("Judging", l.judging)}${row("Scoring", l.scoring)}${row("Checks", l.checks)}${row("Retries", l.retries)}
        ${row("All steps", l.steps_total)}${row("End-to-end arms", l.e2e_total)}${row("Total system cost", l.total, "total")}
      </tbody>
    </table></div>
    <p class="note">The end-to-end arms are listed separately: they are extra generations, not a double count of the step evidence.</p>
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
    <h2>Not observed and not compared <span class="hint">GAPS.md</span></h2>
    <ul class="gaps">${blocks}</ul>
  </section>`;
}

export function renderWorkflowReport(record: WorkflowRecord, gaps: string): string {
  const steps = record.steps.length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(record.run_name)} workflow report</title>
<style>${PAGE_STYLE}</style></head>
<body><div class="page">
  <header class="run">
    <p class="eyebrow">Agentic Evaluator · workflow report · protocol ${escapeHtml(record.protocol_version)}</p>
    <h1>Workflow · <span class="id">${escapeHtml(record.run_name)}</span></h1>
    <dl class="kv">
      <div><dt>Run</dt><dd>${escapeHtml(record.run_id)}</dd></div>
      <div><dt>Steps</dt><dd>${steps}${record.handoff ? " · chained handoff" : " · independent"}</dd></div>
      <div><dt>Total system cost</dt><dd>${usd(record.ledger.total)}</dd></div>
      <div><dt>End-to-end</dt><dd>${record.e2e_validation ? escapeHtml(`${record.e2e_validation.verdict} · ${record.e2e_validation.firmness}`) : "not run"}</dd></div>
    </dl>
  </header>
  ${renderVerdict(record)}
  ${renderChain(record)}
  ${renderArms(record)}
  ${renderSteps(record)}
  ${renderLedger(record)}
  ${renderGaps(gaps)}
  <footer><span>${escapeHtml(record.run_id)}/</span><span>workflow.json · e2e-validation.json</span><span>each step's evidence is in its own directory</span></footer>
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
