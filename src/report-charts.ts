/**
 * Charts for the canonical run report.
 *
 * Every chart reads the canonical trial rows — the same file the tables and the
 * recommendation read — so a picture can never disagree with the numbers beside
 * it. Pure string rendering, no runtime dependency.
 *
 * The judge's 1–5 scores are drawn as a distribution, one bar per candidate:
 * how many trials got each score. A mean hides the shape that matters (a
 * candidate scoring 1 or 5 and nothing between averages 3), and the required
 * check sits on the same row, because a well-written note on a wrong answer
 * is the misreading this chart exists to prevent.
 *
 * Palette: a red ← gray → blue diverging ramp (1 red, 3 neutral, 5 blue),
 * validated with the dataviz validator in light and dark against the page
 * surfaces. Some steps sit below 3:1 on the surface, so values are never
 * colour-alone: the dominant segments are labelled, every segment has a hover
 * title, and a table carries the exact counts.
 */

import { judgeDiscrimination } from "./canon/discrimination.js";
import type { TrialRow } from "./canon/rows.js";
import { escapeHtml } from "./html.js";
import { SCORE_MAX, SCORE_MIN, heatTint } from "./report-format.js";

export { heatTint };

/** The scores a judge can give, low to high. */
const STEPS = [1, 2, 3, 4, 5] as const;

/** A segment narrower than this share of its bar gets no printed label (it would not fit). */
const LABEL_MIN_SHARE = 0.12;

export interface CandidateProfile {
  candidate: string;
  /** Mean absolute score per dimension; null when that dimension was never scored. */
  scores: Record<string, number | null>;
  overall: number | null;
  trials: number;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function dimensionKeys(trials: readonly TrialRow[]): string[] {
  return [...new Set(trials.flatMap((t) => Object.keys(t.judge?.absolute_dimensions ?? {})))];
}

export function profiles(trials: readonly TrialRow[]): CandidateProfile[] {
  const dims = dimensionKeys(trials);
  const order = [...new Set(trials.map((t) => t.candidate))];
  return order.map((candidate) => {
    const rows = trials.filter((t) => t.candidate === candidate);
    const scores: Record<string, number | null> = {};
    for (const dim of dims) {
      scores[dim] = mean(
        rows
          .map((r) => r.judge?.absolute_dimensions?.[dim])
          .filter((v): v is number => typeof v === "number"),
      );
    }
    return {
      candidate,
      scores,
      overall: mean(
        rows.map((r) => r.judge?.absolute_overall).filter((v): v is number => typeof v === "number"),
      ),
      trials: rows.length,
    };
  });
}

export interface ScoreRow {
  candidate: string;
  /** Trials per score, index 0 = score 1 … index 4 = score 5. */
  counts: number[];
  /** Trials this dimension has no score for: did not complete, or the judge skipped it. */
  unscored: number;
  /** All the candidate's trials. */
  n: number;
  /** Mean over scored trials; null when none was scored. */
  mean: number | null;
}

export interface ScoreBlock {
  dim: string;
  /** Every candidate got the same scores: the judge did not tell them apart here. */
  saturated: boolean;
  rows: ScoreRow[];
}

export interface CheckTally {
  pass: number;
  executed: number;
}

/** Share of executed checks that passed; -1 sorts a candidate the check never ran on last. */
const passRate = (c: CheckTally | undefined): number => (c && c.executed > 0 ? c.pass / c.executed : -1);

/**
 * How many trials got each score, per dimension and candidate. Candidates are
 * in one order for every dimension so blocks can be read across: most answers
 * right first (the required check), the judge's mean only breaking ties —
 * ordering by how well a note reads would put a fluent wrong answer on top.
 */
export function scoreDistribution(trials: readonly TrialRow[], checks: ReadonlyMap<string, CheckTally> = new Map()): ScoreBlock[] {
  const dims = dimensionKeys(trials);
  const order = profiles(trials)
    .map((p, i) => ({ p, i, rate: passRate(checks.get(p.candidate)) }))
    .sort((x, y) => y.rate - x.rate || (y.p.overall ?? -1) - (x.p.overall ?? -1) || x.i - y.i)
    .map(({ p }) => p.candidate);
  const saturated = new Set(judgeDiscrimination(trials).saturated);
  return dims.map((dim) => ({
    dim,
    saturated: saturated.has(dim),
    rows: order.map((candidate) => {
      const own = trials.filter((t) => t.candidate === candidate);
      const scores = own
        .map((t) => t.judge?.absolute_dimensions?.[dim])
        .filter((v): v is number => typeof v === "number");
      const counts = STEPS.map((s) => scores.filter((v) => Math.round(v) === s).length);
      return { candidate, counts, unscored: own.length - scores.length, n: own.length, mean: mean(scores) };
    }),
  }));
}

const pct = (part: number, whole: number): string => `${Math.round((part / whole) * 100)}%`;

function segment(cls: string, share: number, label: string, title: string): string {
  const text = share >= LABEL_MIN_SHARE ? label : "";
  return `<span class="sd-seg ${cls}" style="flex-grow:${share.toFixed(4)}" title="${escapeHtml(title)}">${text}</span>`;
}

function scoreRow(dim: string, r: ScoreRow, check: CheckTally | undefined): string {
  const segs = STEPS.map((s, i) =>
    r.counts[i] === 0 ? "" : segment(`sd-${s}`, r.counts[i] / r.n, pct(r.counts[i], r.n), `${r.candidate} · ${dim} = ${s}: ${r.counts[i]} of ${r.n} trials (${pct(r.counts[i], r.n)})`),
  ).join("");
  const missing = r.unscored === 0 ? "" : segment("sd-u", r.unscored / r.n, pct(r.unscored, r.n), `${r.candidate} · not scored: ${r.unscored} of ${r.n} trials (${pct(r.unscored, r.n)})`);
  return `<div class="sd-row">
      <span class="sd-name">${escapeHtml(r.candidate)}</span>
      <span class="sd-bar">${segs}${missing}</span>
      <span class="sd-mean">${r.mean === null ? "—" : r.mean.toFixed(1)}</span>
      <span class="sd-check">${checkCell(check)}</span>
    </div>`;
}

function countsTable(blocks: readonly ScoreBlock[]): string {
  const rows = blocks
    .flatMap((b) =>
      b.rows.map((r) => `<tr><td>${escapeHtml(r.candidate)}</td><td>${escapeHtml(b.dim)}</td>${r.counts.map((c) => `<td class="num">${c}</td>`).join("")}<td class="num">${r.unscored}</td><td class="num">${r.mean === null ? "—" : r.mean.toFixed(2)}</td></tr>`),
    )
    .join("");
  return `<details><summary>Exact counts</summary><div class="table-wrap"><table>
      <thead><tr><th>Candidate</th><th>Dimension</th>${STEPS.map((s) => `<th class="num">${s}</th>`).join("")}<th class="num">Not scored</th><th class="num">Mean</th></tr></thead>
      <tbody>${rows}</tbody></table></div></details>`;
}

export interface SummaryRow {
  candidate: string;
  /** Mean per dimension, in the blocks' order; null when that dimension was never scored. */
  means: Array<number | null>;
  overall: number | null;
}

/** One row per candidate in the distribution's order: its mean on every dimension, and overall. */
export function scoreSummary(trials: readonly TrialRow[], blocks: readonly ScoreBlock[]): SummaryRow[] {
  const overall = new Map(profiles(trials).map((p) => [p.candidate, p.overall]));
  return (blocks[0]?.rows ?? []).map(({ candidate }) => ({
    candidate,
    means: blocks.map((b) => b.rows.find((r) => r.candidate === candidate)?.mean ?? null),
    overall: overall.get(candidate) ?? null,
  }));
}

const fmtMean = (v: number | null): string => (v === null ? "—" : v.toFixed(1));

function checkCell(check: CheckTally | undefined): string {
  return check && check.executed > 0 ? `${check.pass} / ${check.executed} <span class="sd-sub">${pct(check.pass, check.executed)}</span>` : "—";
}

/**
 * Every candidate's mean on every dimension in one table, tinted red below 3
 * and blue above, values always printed. Rows in the same order as the bars
 * below it; the required check closes each row.
 */
export function renderScoreSummary(trials: readonly TrialRow[], checks: ReadonlyMap<string, CheckTally>): string {
  const blocks = scoreDistribution(trials, checks);
  if (blocks.length === 0) return "";
  const head = blocks
    .map((b) => `<th class="num">${escapeHtml(b.dim)}${b.saturated ? ` <span class="viz-flag">no spread</span>` : ""}</th>`)
    .join("");
  const body = scoreSummary(trials, blocks)
    .map((r) => {
      const cells = r.means
        .map((v, i) =>
          v === null
            ? `<td class="viz-cell viz-none" title="${escapeHtml(blocks[i].dim)}: not scored">—</td>`
            : `<td class="viz-cell" style="${heatTint(v, SCORE_MIN, SCORE_MAX)}" title="${escapeHtml(r.candidate)} · ${escapeHtml(blocks[i].dim)}: ${v.toFixed(1)}/5">${v.toFixed(1)}</td>`,
        )
        .join("");
      return `<tr><td class="sd-name">${escapeHtml(r.candidate)}</td>${cells}<td class="viz-cell"${r.overall === null ? "" : ` style="${heatTint(r.overall, SCORE_MIN, SCORE_MAX)}"`}>${fmtMean(r.overall)}</td><td class="num">${checkCell(checks.get(r.candidate))}</td></tr>`;
    })
    .join("");
  const scale = STEPS.map((v) => `<span class="viz-step" style="${heatTint(v, SCORE_MIN, SCORE_MAX)}"></span>`).join("");
  return `<figure class="viz">
    <figcaption>Mean score per dimension <span class="hint">above 3 leans blue, below 3 leans red, stronger the further away</span></figcaption>
    <div class="table-wrap"><table class="viz-heat"><thead><tr><th>Candidate</th>${head}<th class="num">Overall</th><th class="num" title="Whether the answer itself was right: a different measure, so not on the 1–5 colour scale">Required check ↓</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="viz-scale"><span>1</span>${scale}<span>5</span></div>
  </figure>`;
}

/**
 * One bar per candidate per dimension: the share of its trials at each score,
 * red (1) to blue (5), with the mean and the required check beside it.
 */
export function renderScoreDistribution(trials: readonly TrialRow[], checks: ReadonlyMap<string, CheckTally>): string {
  const blocks = scoreDistribution(trials, checks);
  if (blocks.length === 0) return "";
  const legend = STEPS.map((s) => `<span class="viz-lg"><span class="sd-key sd-${s}"></span>${s}</span>`).join("") +
    `<span class="viz-lg"><span class="sd-key sd-u"></span>not scored</span>`;
  const figures = blocks
    .map((b) => `<figure class="viz">
    <figcaption>${escapeHtml(b.dim)} <span class="hint">share of each candidate's trials at each score</span>${b.saturated ? ` <span class="viz-flag">no spread</span>` : ""}</figcaption>
    <div class="sd-row sd-head"><span></span><span>1 (red) → 5 (blue)</span><span class="sd-mean">mean</span><span class="sd-check">required check ↓</span></div>
    ${b.rows.map((r) => scoreRow(b.dim, r, checks.get(r.candidate))).join("")}
    ${b.saturated ? `<p class="viz-note">Every candidate got the same scores here: the judge did not tell them apart, which is not the same as them being equal.</p>` : ""}
  </figure>`)
    .join("");
  return `<div class="viz-legend sd-legend">${legend}</div>${figures}${countsTable(blocks)}`;
}

export const CHART_STYLES = `
.viz{margin:14px 0 0;padding:0}
.viz figcaption{font-size:13px;font-weight:600;margin-bottom:8px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.viz-legend{display:flex;gap:14px;flex-wrap:wrap;margin:4px 0;font-size:12px;color:var(--ink-2)}
.viz-lg{display:inline-flex;gap:6px;align-items:center}
.viz-flag{font-size:10px;font-weight:600;background:var(--warn-bg);color:var(--warn-fg);padding:0 5px;border-radius:3px;white-space:nowrap}
.viz-note{font-size:12px;color:var(--ink-3);margin:6px 0 0}
table.viz-heat{width:100%;border-collapse:separate;border-spacing:2px}
table.viz-heat th{font-size:12px;font-weight:500;color:var(--ink-2);text-align:left;white-space:nowrap}
table.viz-heat th.num,table.viz-heat td.num{text-align:right;font-variant-numeric:tabular-nums}
td.viz-cell{text-align:center;border-radius:4px;padding:8px 6px;font-variant-numeric:tabular-nums;color:var(--ink)}
td.viz-none{background:var(--surface-2);color:var(--ink-3)}
.viz-scale{display:flex;gap:2px;align-items:center;margin-top:8px;font-size:11px;color:var(--ink-3)}
.viz-step{width:26px;height:8px;border-radius:2px;display:inline-block}
.sd-1{--sd:#c93a39;--sd-fg:#fff}.sd-2{--sd:#f0a3a0;--sd-fg:#2B3038}.sd-3{--sd:#e2e1dd;--sd-fg:#2B3038}.sd-4{--sd:#8dbbf1;--sd-fg:#2B3038}.sd-5{--sd:#1c5cab;--sd-fg:#fff}
.sd-row{display:grid;grid-template-columns:minmax(90px,160px) 1fr 44px 96px;gap:10px;align-items:center;margin:3px 0;font-size:12px}
.sd-head{color:var(--ink-3);font-size:11px;margin-bottom:2px}
.sd-name{font-family:var(--mono);font-size:11px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sd-bar{display:flex;gap:2px;height:20px;min-width:0}
.sd-seg{flex-basis:0;min-width:2px;background:var(--sd);color:var(--sd-fg);font-size:10px;line-height:20px;text-align:center;overflow:hidden;white-space:nowrap}
.sd-seg:first-child{border-radius:4px 0 0 4px}.sd-seg:last-child{border-radius:0 4px 4px 0}.sd-seg:only-child{border-radius:4px}
.sd-u{background:var(--surface);color:var(--ink-3);box-shadow:inset 0 0 0 1px var(--ink-3)}
.sd-seg.sd-u{background:repeating-linear-gradient(45deg,var(--surface),var(--surface) 3px,var(--rule) 3px,var(--rule) 5px)}
.sd-mean,.sd-check{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink)}
.sd-sub{color:var(--ink-3)}
.sd-key{width:12px;height:12px;border-radius:2px;display:inline-block;background:var(--sd)}
.sd-legend{margin-top:10px}
@media(prefers-color-scheme:dark){
  .sd-1{--sd:#f29a97;--sd-fg:#1F2329}.sd-2{--sd:#a13b39;--sd-fg:#fff}.sd-3{--sd:#93938d;--sd-fg:#1F2329}.sd-4{--sd:#3470c4;--sd-fg:#fff}.sd-5{--sd:#a8cdf5;--sd-fg:#1F2329}
}
`;
