/**
 * The evidence layer of the canonical report: what each candidate actually
 * wrote, what the judge said about it, and what happened on every single trial.
 *
 * The aggregate tables answer "who won". These answer "why, and can I check
 * it" — which is the only form in which a judge verdict is worth anything.
 *
 * Pure rendering: takes rows already read from the run directory, returns HTML.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { DimensionDetail, EvaluationRow, TrialRow } from "./canon/rows.js";
import type { Winner } from "./types.js";
import { escapeHtml } from "./html.js";
import { heatTint } from "./report-charts.js";
import { dimensionPreference } from "./report-model.js";

/** Longer outputs are cut for display only; the file on disk stays whole. */
const MAX_OUTPUT_CHARS = 30_000;

export interface RawOutput {
  candidate: string;
  input: string;
  trial: number;
  /** Absent when the run has no raw/ directory (older or partial runs). */
  text: string | null;
  /** Characters before display truncation. */
  totalChars: number;
}

/** Mirrors run.ts: candidate ids may be model ids with `/` and `:`. */
function safeName(candidate: string): string {
  return candidate.replace(/[/:]/g, "_");
}

/** Reads `raw/<candidate>__<input>__t<n>.txt` for every trial row. */
export async function loadRawOutputs(
  dir: string,
  trials: readonly TrialRow[],
): Promise<RawOutput[]> {
  return Promise.all(
    trials.map(async (t) => {
      const file = path.join(dir, "raw", `${safeName(t.candidate)}__${t.input}__t${t.trial}.txt`);
      const text = await fs.readFile(file, "utf-8").catch(() => null);
      return {
        candidate: t.candidate,
        input: t.input,
        trial: t.trial,
        text: text === null ? null : text.slice(0, MAX_OUTPUT_CHARS),
        totalChars: text === null ? 0 : text.length,
      };
    }),
  );
}

function winnerChip(winner: Winner, a: string, b: string): string {
  if (winner === "tie") return `<span class="chip tie">tie</span>`;
  const label = winner === "a" ? a : b;
  return `<span class="chip win">${escapeHtml(label)}</span>`;
}

function detailRow(
  key: string,
  detail: DimensionDetail,
  a: string,
  b: string,
): string {
  const disagreed = detail.forward !== detail.reverse;
  const rounds = disagreed
    ? `<span class="chip warn" title="The two orders gave opposite verdicts; recorded as a tie by rule">order disagreement: ${escapeHtml(detail.forward)} / ${escapeHtml(detail.reverse)}</span>`
    : "";
  const reason = detail.reason ? escapeHtml(detail.reason) : `<span class="muted">the judge gave no reason</span>`;
  return `<tr><th>${escapeHtml(key)}</th><td>${winnerChip(detail.resolved, a, b)} ${rounds}</td><td>${reason}</td></tr>`;
}

/** One card per duel: overall verdict, per-dimension verdicts, full rationale. */
export function renderDuels(rows: readonly EvaluationRow[]): string {
  const duels = rows.filter((r) => r.subject.kind === "pair");
  if (duels.length === 0) return "";

  const cards = duels
    .map((row) => {
      const subject = row.subject as Extract<EvaluationRow["subject"], { kind: "pair" }>;
      const { a, b } = subject;
      const detail = row.dimension_detail;
      const body = detail
        ? Object.entries(detail).map(([k, d]) => detailRow(k, d, a, b)).join("")
        : Object.entries(row.dimensions ?? {})
            .map(
              ([k, v]) =>
                `<tr><th>${escapeHtml(k)}</th><td>${winnerChip(v as Winner, a, b)}</td><td><span class="muted">this run did not record per-dimension reasons</span></td></tr>`,
            )
            .join("");
      const calls = row.cost?.calls ?? 0;
      const retries = calls > 2 ? `<span class="chip warn">${calls} calls (incl. retries)</span>` : "";
      const overall = row.overall === undefined ? "" : winnerChip(row.overall as Winner, a, b);
      return `
      <article class="duel">
        <header>
          <strong>${escapeHtml(a)}</strong> vs <strong>${escapeHtml(b)}</strong>
          <span class="muted">${escapeHtml(subject.input)}</span>
          ${overall} ${retries}
        </header>
        <p class="evidence">${row.evidence ? escapeHtml(row.evidence) : '<span class="muted">the judge gave no overall reason</span>'}</p>
        <table class="dims"><tbody>${body}</tbody></table>
      </article>`;
    })
    .join("");

  return `
  <section class="card">
    <h2>Match evidence <span class="hint">each dimension judged separately; an order disagreement is recorded as a tie by rule</span></h2>
    ${cards}
  </section>`;
}

function truncatedChip(trial: TrialRow): string {
  return trial.truncated
    ? `<span class="chip warn" title="finish_reason=length: the output was cut off at the limit">truncated</span>`
    : "";
}

function scoreCells(trial: TrialRow, dimensions: readonly string[]): string {
  const scores = trial.judge?.absolute_dimensions ?? {};
  return dimensions.map((d) => `<td class="num">${scores[d] ?? "—"}</td>`).join("");
}

/** One row per trial — the averages in the ranking table are made of these. */
export function renderTrials(trials: readonly TrialRow[]): string {
  if (trials.length === 0) return "";
  const dimensions = [
    ...new Set(trials.flatMap((t) => Object.keys(t.judge?.absolute_dimensions ?? {}))),
  ];
  const head = dimensions.map((d) => `<th class="num">${escapeHtml(d)}</th>`).join("");
  const body = trials
    .map((t) => {
      const pairwise = (t.judge?.pairwise ?? [])
        .map((p) => `${escapeHtml(p.resolved)} vs ${escapeHtml(p.vs)}`)
        .join("; ");
      return `<tr>
        <td>${escapeHtml(t.candidate)}</td>
        <td>${escapeHtml(t.input)}</td>
        <td class="num">t${t.trial}</td>
        <td>${escapeHtml(t.completion_state)} ${truncatedChip(t)}</td>
        <td>${escapeHtml(t.task_outcome)}</td>
        <td class="num">${t.judge?.absolute_overall ?? "—"}</td>
        ${scoreCells(t, dimensions)}
        <td>${pairwise || "—"}</td>
        <td class="num">${t.tokens?.completion ?? "—"}</td>
        <td class="num">$${(t.cost?.generation ?? 0).toFixed(4)}</td>
        <td class="num">${t.ms === null || t.ms === undefined ? "—" : Math.round(t.ms / 1000) + "s"}</td>
      </tr>`;
    })
    .join("");

  return `
  <section class="card">
    <h2>Every trial <span class="hint">the averages in the standings are computed from these rows</span></h2>
    <table>
      <thead><tr>
        <th>Candidate</th><th>Input</th><th class="num">#</th><th>Completion</th><th>Outcome</th>
        <th class="num">Overall</th>${head}<th>Pairwise</th>
        <th class="num">Output tokens</th><th class="num">Cost</th><th class="num">Duration</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

/** The outputs themselves — collapsed, escaped, capped for display. */
export function renderOutputs(outputs: readonly RawOutput[]): string {
  if (outputs.length === 0) return "";
  const blocks = outputs
    .map((o) => {
      const title = `${escapeHtml(o.candidate)} · ${escapeHtml(o.input)} · t${o.trial}`;
      if (o.text === null) {
        return `<details><summary>${title} <span class="muted">— this file is not in raw/</span></summary></details>`;
      }
      const cut =
        o.totalChars > o.text.length
          ? `<p class="muted">Showing the first ${o.text.length.toLocaleString()} of ${o.totalChars.toLocaleString()} characters; the full text is in raw/</p>`
          : "";
      return `<details>
        <summary>${title} <span class="muted">${o.totalChars.toLocaleString()} characters</span></summary>
        ${cut}<pre class="raw">${escapeHtml(o.text)}</pre>
      </details>`;
    })
    .join("");

  return `
  <section class="card">
    <h2>Candidate outputs <span class="hint">exactly the text the judge saw</span></h2>
    ${blocks}
  </section>`;
}

export const EVIDENCE_STYLES = `
.pref-high{color:var(--ok-fg);font-weight:600}.pref-low{color:var(--ink-3)}

.duel{border:1px solid var(--rule);border-radius:8px;padding:12px 14px;margin:10px 0}
.duel header{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.duel .evidence{margin:6px 0 10px;color:var(--ink-2)}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid var(--rule)}
.chip.win{background:var(--ok-bg);color:var(--ok-fg);border-color:transparent}
.chip.tie{background:var(--surface-2);color:var(--ink-2);border-color:transparent}
.chip.warn{background:var(--warn-bg);color:var(--warn-fg);border-color:transparent}
table.dims{width:100%}table.dims th{text-align:left;font-weight:500;white-space:nowrap;width:1%;padding-right:14px}
details>summary{cursor:pointer;padding:6px 0;color:var(--ink-2)}
pre.raw{max-height:460px;overflow:auto;background:var(--surface-2);border:1px solid var(--rule);border-radius:6px;padding:10px;white-space:pre-wrap;word-break:break-word;font-size:12px}
.muted{color:var(--ink-3)}
`;

/**
 * Dimension preference: per-dimension pairwise win rate, the legacy report's
 * most useful table and the one the canonical page lacked. A tie counts 0.5,
 * so a row of 50 means "indistinguishable", not "no data" — an empty cell is
 * what no data looks like.
 *
 * This is judge opinion, shown next to the recommendation, never inside it.
 */
export function renderDimensionPreference(evaluations: readonly EvaluationRow[]): string {
  const table = dimensionPreference(evaluations);
  if (table === null) return "";
  const { dims } = table;

  const head = dims.map((d) => `<th class="num">${escapeHtml(d)}</th>`).join("");
  const rows = table.rows
    .map(({ candidate, cells: values }) => {
      const cells = values
        .map((value) => {
          if (value === null) return `<td class="num muted">—</td>`;
          return `<td class="num" style="${heatTint(value, 0, 100)}">${value.toFixed(0)}</td>`;
        })
        .join("");
      return `<tr><td>${escapeHtml(candidate)}</td>${cells}</tr>`;
    })
    .join("");

  return `<figure class="viz">
    <figcaption>Direction · pairwise win rate 0–100 <span class="hint">who was preferred; a tie counts 0.5</span></figcaption>
    <div class="table-wrap"><table class="pref">
      <thead><tr><th>Candidate</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </figure>`;
}
