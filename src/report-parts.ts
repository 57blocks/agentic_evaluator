/**
 * The check's parts on the run page (canon/parts.ts): the pass rate per part
 * tag, then every part as a row with each candidate's passes over graded
 * trials. Pure rendering.
 */

import type { PartBoard, PartRow } from "./canon/parts.js";
import { escapeHtml } from "./html.js";
import { headlineCell } from "./report-headline.js";
import { renderPartStrip } from "./report-headline-charts.js";

/** Parts are listed open up to this many; beyond it the grid is folded. */
const OPEN_PARTS = 40;

function pill(c: { pass: number; graded: number } | undefined): string {
  if (!c || c.graded === 0) return `<span class="muted">—</span>`;
  const tone = c.pass === c.graded ? "pass" : c.pass === 0 ? "miss" : "warn";
  return `<span class="pill ${tone}">${c.pass}/${c.graded}</span>`;
}

function tagTable(board: PartBoard, candidates: readonly string[]): string {
  if (board.groups.length === 0) return "";
  const width = candidates.length + 2;
  const body = board.groups
    .map((g) => {
      const head = g.title === null ? "" : `<tr class="group"><td colspan="${width}">${escapeHtml(g.title)}</td></tr>`;
      return head + g.rows.map((r) => `<tr><td class="mono">${escapeHtml(r.label)}</td><td class="num">${r.parts}</td>${candidates.map((c) => headlineCell(r.cells[c])).join("")}</tr>`).join("");
    })
    .join("");
  return `<div class="table-wrap"><table>
      <thead><tr><th>Tag</th><th class="num">Parts</th>${candidates.map((c) => `<th class="num">${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>
    <p class="note">Passes over graded trials of the parts carrying the tag; a part is counted under its own tags only. The 95% interval is Wilson's, counted per part (n), so repeated trials of one part do not narrow it.</p>`;
}

const tagChips = (r: PartRow): string => r.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join(" ");

function grid(board: PartBoard, candidates: readonly string[]): string {
  const body = board.rows
    .map((r) => `<tr><td class="mono">${escapeHtml(r.input)}</td><td>${escapeHtml(r.label ?? r.id)}<span class="sub">${tagChips(r)}</span></td>${candidates.map((c) => `<td class="num">${pill(r.cells[c])}</td>`).join("")}</tr>`)
    .join("");
  const table = `<div class="table-wrap"><table>
      <thead><tr><th>Input</th><th>Part</th>${candidates.map((c) => `<th class="num">${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  return board.rows.length > OPEN_PARTS ? `<details><summary>All ${board.rows.length} parts</summary>${table}</details>` : table;
}

/** The parts section; empty when no trial reported a part. */
export function renderParts(board: PartBoard | null, candidates: readonly string[]): string {
  if (!board) return "";
  return `<section class="card">
    <h2>${escapeHtml(board.title)} <span class="hint">each one across candidates · passes / graded trials</span></h2>
    ${renderPartStrip(board, candidates)}
    ${tagTable(board, candidates)}
    ${grid(board, candidates)}
  </section>`;
}
