/**
 * A check's headline numbers on the scorecard: a column per headline beside
 * each candidate, one line per headline saying whether any two candidates
 * differ, and a table per headline by slice, in the check's groups with the
 * ungrouped slices folded away. Pure rendering of canon/headline.ts.
 */

import { OTHER_SLICES, type HeadlineDifference, type HeadlineEntry, type HeadlineValue } from "./canon/headline.js";
import { fmtMeasure } from "./canon/measures.js";
import { fmtP } from "./canon/stats.js";
import { escapeHtml } from "./html.js";

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const inputsText = (n: number): string => `n ${n}`;

/** A share as "13/39 · 33%", a mean as "1.00"; beneath, the 95% interval and n, the inputs it is over. */
export function headlineCell(v: HeadlineValue | null | undefined): string {
  if (!v) return `<td class="num muted">—</td>`;
  const fmt = v.kind === "share" ? pct : fmtMeasure;
  const main = v.kind === "share" ? `${v.numerator}/${v.denominator} · <b>${pct(v.value)}</b>` : `<b>${fmtMeasure(v.value)}</b>`;
  const ci = v.low === null || v.high === null ? "" : `95% ${fmt(v.low)}–${fmt(v.high)} · `;
  return `<td class="num">${main}<span class="sub">${ci}${inputsText(v.inputs)}</span></td>`;
}

/** A headline on one input, in a few words: "Defects caught 2/3", "Defect claims per clean item 1.00". */
export function headlineNote(label: string, v: HeadlineValue): string {
  return `${label} ${v.kind === "share" ? `${v.numerator}/${v.denominator}` : fmtMeasure(v.value)}`;
}

export function headlineHeads(board: readonly HeadlineEntry[]): string {
  return board.map((h) => `<th class="num wrap">${escapeHtml(h.decl.label)}</th>`).join("");
}

const pairText = (d: HeadlineDifference): string =>
  `${escapeHtml(d.a)} higher on ${d.a_better} input${d.a_better === 1 ? "" : "s"}, ${escapeHtml(d.b)} on ${d.b_better}, equal on ${d.same} (p ${fmtP(d.p_value)})`;

/** One line per headline: the pairs a sign test separates, or that none is and which came closest. */
function differenceLine(h: HeadlineEntry): string {
  const pairs = h.differences.filter((d) => d.compared > 0);
  if (pairs.length === 0) return "";
  const label = escapeHtml(h.decl.label);
  const firm = pairs.filter((d) => d.significant);
  if (firm.length > 0) return `<li><b>${label}</b>: ${firm.map(pairText).join("; ")}.</li>`;
  const closest = pairs.reduce((best, d) => (d.p_value < best.p_value ? d : best));
  return `<li><b>${label}: no difference shown.</b> Closest: ${pairText(closest)}.</li>`;
}

export function renderDifferences(board: readonly HeadlineEntry[]): string {
  const lines = board.map(differenceLine).filter((l) => l !== "");
  if (lines.length === 0) return "";
  return `<h3>Do the candidates differ?</h3>
    <ul class="gaps">${lines.join("")}</ul>
    <p class="note">Each pair is compared input by input with an exact two-sided sign test at 0.05, not adjusted for the number of pairs. A difference smaller than this set can show is not evidence of no difference.</p>`;
}

function sliceTable(groups: HeadlineEntry["groups"], candidates: readonly string[]): string {
  const width = candidates.length + 2;
  const body = groups
    .map((g) => {
      const head = g.title === null ? "" : `<tr class="group"><td colspan="${width}">${escapeHtml(g.title)}</td></tr>`;
      const rows = g.rows
        .map((r) => `<tr><td class="mono">${escapeHtml(r.label)}</td><td class="num">${r.inputs}</td>${candidates.map((c) => headlineCell(r.cells[c])).join("")}</tr>`)
        .join("");
      return head + rows;
    })
    .join("");
  return `<div class="table-wrap"><table>
      <thead><tr><th>Slice</th><th class="num">Inputs</th>${candidates.map((c) => `<th class="num">${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/** Each headline that asks for it, by slice: the check's groups open, the ungrouped slices folded away. */
export function renderHeadlineSlices(board: readonly HeadlineEntry[], candidates: readonly string[]): string {
  return board
    .filter((h) => h.groups.length > 0)
    .map((h) => {
      const main = h.groups.filter((g) => g.title !== OTHER_SLICES);
      const other = h.groups.filter((g) => g.title === OTHER_SLICES).map((g) => ({ ...g, title: null }));
      const folded = other.length === 0 ? "" : `<details><summary>Other slices (${other[0]!.rows.length})</summary>${sliceTable(other, candidates)}</details>`;
      return `<h3>${escapeHtml(h.decl.label)}, by slice</h3>
    ${main.length > 0 ? sliceTable(main, candidates) : ""}
    ${folded}`;
    })
    .join("\n    ")
    .concat(board.some((h) => h.groups.length > 0) ? `\n    <p class="note">A slice is every input carrying the tag: an input with several tags is counted under each, with everything it holds.</p>` : "");
}
