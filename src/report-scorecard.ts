/**
 * The scorecard a `decision: scorecard` step leads its page with: per
 * candidate, the required check's pass rate with a 95% interval, the check's
 * measures, cost and duration — over every input, then per tag and split —
 * and then every failed trial with the check's reason. Nothing is picked and
 * no gate is drawn: the reader compares.
 *
 * A check with a report of its own (canon/headline.ts) leads with its
 * headline numbers instead: a column each, who differs, and its slices.
 *
 * The pass-rate interval is Wilson's, counted per input as the selector's
 * gate intervals are (select.ts): repeated trials of one input do not narrow
 * it as if they were new inputs.
 */

import type { InputLabels } from "./canon/about.js";
import type { CandidateRates } from "./canon/rates.js";
import type { TrialRow } from "./canon/rows.js";
import { measureStats, measureSummary, type MeasureStats } from "./canon/measures.js";
import { wilson } from "./canon/stats.js";
import { trialNote } from "./canon/run-diff.js";
import { escapeHtml } from "./html.js";
import { fmtCost, fmtSec } from "./report-format.js";
import { sliceMembers } from "./report-slices.js";
import { headlineBoard, type CheckReport, type HeadlineEntry } from "./canon/headline.js";
import { headlineCell, headlineHeads, renderDifferences, renderHeadlineSlices } from "./report-headline.js";
import { renderHeadlineChart } from "./report-headline-charts.js";

/** Failed trials are listed open when there are at most this many for a candidate. */
const OPEN_FAILURES = 10;

export interface ScorecardCell {
  pass: number;
  graded: number;
  /** Inputs with a graded trial: the interval's unit. */
  inputs: number;
  low: number | null;
  high: number | null;
  measures: MeasureStats;
}

export interface ScorecardSlice {
  /** "all", a tag, or "split: <name>". */
  label: string;
  inputs: number;
  cells: Record<string, ScorecardCell>;
}

const GRADED = new Set(["pass", "fail"]);

function cellOf(trials: readonly TrialRow[], candidate: string, inputs: ReadonlySet<string> | undefined): ScorecardCell {
  const own = trials.filter((t) => t.candidate === candidate && (!inputs || inputs.has(t.input)));
  const cells = own.flatMap((t) => Object.values(t.checks ?? {}).filter((c) => GRADED.has(c.state)).map((c) => ({ input: t.input, pass: c.state === "pass" })));
  const pass = cells.filter((c) => c.pass).length;
  const graded = cells.length;
  const gradedInputs = new Set(cells.map((c) => c.input)).size;
  const n = Math.min(graded, gradedInputs);
  const ci = graded > 0 ? wilson((pass / graded) * n, n) : null;
  return { pass, graded, inputs: gradedInputs, low: ci?.low ?? null, high: ci?.high ?? null, measures: measureStats(own, candidate) };
}

/** Every input first, then each tag and split the labels declare. */
export function scorecardSlices(labels: InputLabels | null, trials: readonly TrialRow[], candidates: readonly string[]): ScorecardSlice[] {
  const all: Array<[string, Set<string> | undefined]> = [["all", undefined]];
  return [...all, ...sliceMembers(labels)].map(([label, inputs]) => ({
    label,
    inputs: inputs?.size ?? new Set(trials.map((t) => t.input)).size,
    cells: Object.fromEntries(candidates.map((c) => [c, cellOf(trials, c, inputs)])),
  }));
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

function passText(c: ScorecardCell): string {
  if (c.graded === 0) return "—";
  const ci = c.low === null || c.high === null ? "" : ` · ${pct(c.low)}–${pct(c.high)}`;
  return `${c.pass}/${c.graded}${ci}`;
}

/** The required check's count and interval; every measure on a line beneath it unless the check's headlines already lead. */
function passCell(c: ScorecardCell | undefined, withMeasures: boolean): string {
  if (!c) return `<td class="num muted">—</td>`;
  const line = withMeasures ? measureSummary(c.measures) : "";
  return `<td class="num">${passText(c)}${line ? `<span class="sub">${escapeHtml(line)}</span>` : ""}</td>`;
}

function headTable(all: ScorecardSlice, trials: readonly TrialRow[], rates: readonly CandidateRates[], candidates: readonly string[], board: readonly HeadlineEntry[]): string {
  const byId = new Map(rates.map((r) => [r.candidate, r]));
  const rows = candidates
    .map((c) => {
      const r = byId.get(c);
      // A trial whose spend nobody saw makes the cost unknown, not cheaper.
      const observed = trials.filter((t) => t.candidate === c).every((t) => t.cost.source !== "none");
      return `<tr><td class="cand">${escapeHtml(c)}</td>${board.map((h) => headlineCell(h.all[c])).join("")}${passCell(all.cells[c], board.length === 0)}
        <td class="num">${r ? fmtCost(r.generation_cost_per_success, observed) : "—"}</td>
        <td class="num">${fmtSec(r?.p50_ms ?? null)}</td><td class="num">${fmtSec(r?.p95_ms ?? null)}</td></tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table${board.length > 0 ? ` class="tight"` : ""}>
    <thead><tr><th>Candidate</th>${headlineHeads(board)}<th class="num wrap">Required check <span class="hint">passed/graded · 95% per input</span></th><th class="num wrap">Generation cost per success</th><th class="num">p50</th><th class="num">p95</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/** The required check per slice; folded under the headlines' own slices when the check has them. */
function sliceTable(slices: readonly ScorecardSlice[], candidates: readonly string[], folded: boolean): string {
  if (slices.length === 0) return "";
  const body = slices
    .map((s) => `<tr><td class="mono">${escapeHtml(s.label)}</td><td class="num">${s.inputs}</td>${candidates.map((c) => passCell(s.cells[c], !folded)).join("")}</tr>`)
    .join("");
  const table = `<div class="table-wrap"><table>
      <thead><tr><th>Slice</th><th class="num">Inputs</th>${candidates.map((c) => `<th class="num">${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  return folded ? `<details><summary>Required check, by input tag and split</summary>${table}</details>` : `<h3>By input tag and split</h3>\n    ${table}`;
}

/**
 * `report`: what the required check leads with (canon/headline.ts). With
 * one, its headline numbers take the columns and the slices, and every other
 * measure is left to the measures section; without, each cell lists them all.
 */
export function renderScorecard(labels: InputLabels | null, trials: readonly TrialRow[], rates: readonly CandidateRates[], candidates: readonly string[], report: CheckReport | null = null): string {
  const [all, ...slices] = scorecardSlices(labels, trials, candidates);
  const board = headlineBoard(report, labels, trials, candidates);
  if (board.length > 0) {
    return `<section class="card">
    <h2>Scorecard <span class="hint">decision: scorecard · no gate applied, no candidate picked</span></h2>
    ${renderHeadlineChart(board, candidates)}
    ${headTable(all!, trials, rates, candidates, board)}
    <p class="note">n is the inputs a number is over. A share is counted over graded trials (three trials of one defect are three chances); its 95% interval is Wilson's, counted per input, so repeated trials of one input do not narrow it. A plain number is the mean over inputs of each input's mean, with a t-interval. The required check passes a trial only when everything it asks for holds. Cost excludes judging; p50 and p95 are over completed trials.</p>
    ${renderDifferences(board)}
    ${renderHeadlineSlices(board, candidates)}
    ${sliceTable(slices, candidates, true)}
  </section>`;
  }
  return `<section class="card">
    <h2>Scorecard <span class="hint">decision: scorecard · no gate applied, no candidate picked · required check and its measures, every input then each tag and split</span></h2>
    ${headTable(all!, trials, rates, candidates, board)}
    ${sliceTable(slices, candidates, false)}
    <p class="note">The required check's 95% interval is Wilson's, counted per input, so repeated trials of one input do not narrow it. Measures are the mean over each input's graded trials, then over inputs. Cost excludes judging; p50 and p95 are over completed trials.</p>
  </section>`;
}

/** Every graded trial the required check failed, per candidate, with what the check said. */
export function renderFailedTrials(trials: readonly TrialRow[], candidates: readonly string[]): string {
  const failed = trials.filter((t) => Object.values(t.checks ?? {}).some((c) => c.state === "fail"));
  if (failed.length === 0) return "";
  const groups = candidates
    .map((c) => {
      const own = failed.filter((t) => t.candidate === c).sort((a, b) => a.input.localeCompare(b.input) || a.trial - b.trial);
      if (own.length === 0) return "";
      const rows = own
        .map((t) => {
          const note = trialNote(t);
          const reason = note.checks.map((ch) => ch.reason).filter((r): r is string => !!r).join("; ");
          const evidence = note.checks.map((ch) => ch.evidence).filter((e): e is string => !!e).join("; ");
          return `<tr><td class="mono">${escapeHtml(t.input)}</td><td class="num">t${t.trial}</td><td>${escapeHtml(reason || "—")}</td><td class="small muted">${escapeHtml(evidence)}</td></tr>`;
        })
        .join("");
      return `<details${own.length <= OPEN_FAILURES ? " open" : ""}><summary><b>${escapeHtml(c)}</b> — ${own.length} failed trial${own.length === 1 ? "" : "s"}</summary>
        <div class="table-wrap"><table><thead><tr><th>Input</th><th class="num">#</th><th>Reason</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
    })
    .join("");
  return `<section class="card">
    <h2>Failed trials <span class="hint">every graded trial the required check failed, with the check's reason and evidence</span></h2>
    ${groups}
  </section>`;
}
