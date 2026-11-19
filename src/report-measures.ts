/**
 * The check's measures on the run page: one table per candidate, a row per
 * slice (every input, then each tag and split), a column per measure. Each
 * cell is the mean over inputs of the per-input mean, its 95% t-interval,
 * and how many inputs reported it. Nothing here decides anything.
 */

import { escapeHtml } from "./html.js";
import { fmtMeasure, measureSummary, type MeasureStat, type MeasureStats } from "./canon/measures.js";
import type { MeasureSliceRow } from "./report-slices.js";

/** Mean, then its interval on the same line; n only when fewer inputs reported it than the slice holds. */
function cell(s: MeasureStat | undefined, sliceInputs: number): string {
  if (!s) return `<td class="num muted">—</td>`;
  const ci = s.low === null || s.high === null ? "" : ` <span class="muted small">[${fmtMeasure(s.low)}–${fmtMeasure(s.high)}]</span>`;
  const n = s.n < sliceInputs ? ` <span class="muted small">· ${s.n} input${s.n === 1 ? "" : "s"}</span>` : "";
  return `<td class="num">${fmtMeasure(s.mean)}${ci}${n}</td>`;
}

function candidateTable(candidate: string, rows: readonly MeasureSliceRow[]): string {
  const names = [...new Set(rows.flatMap((r) => Object.keys(r.byCandidate[candidate] ?? {})))].sort();
  if (names.length === 0) return `<h3>${escapeHtml(candidate)}</h3><p class="muted">No graded trial reported a measure.</p>`;
  const body = rows
    .map((r) => `<tr><td class="mono">${escapeHtml(r.label)}</td><td class="num">${r.inputs}</td>${names.map((n) => cell(r.byCandidate[candidate]?.[n], r.inputs)).join("")}</tr>`)
    .join("");
  return `<h3>${escapeHtml(candidate)}</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Slice</th><th class="num">Inputs</th>${names.map((n) => `<th class="num">${escapeHtml(n)} <span class="hint">mean [95%]</span></th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
}

/** The measures section; empty when the check reported none, so older runs render as before. */
export function renderMeasures(rows: readonly MeasureSliceRow[], candidates: readonly string[]): string {
  if (rows.length === 0) return "";
  return `<section class="card">
    <h2>Check measures <span class="hint">what the required check counted on each trial · mean per input over its graded trials, then over inputs, with a 95% interval · not used by the recommendation</span></h2>
    ${candidates.map((c) => candidateTable(c, rows)).join("")}
    <p class="note">Each measure has its own n: one that only some inputs report is averaged over those inputs. The interval is over the per-input means, so repeated trials of one input are not counted as independent; none is shown for a single input.</p>
  </section>`;
}

/** The candidate's means over every input, one line under the required check: "comments 2.88 · defect_claims 0.40". */
export function measureLine(m: MeasureStats): string {
  const line = measureSummary(m);
  return line === "" ? "" : `<span class="sub">${escapeHtml(line)}</span>`;
}
