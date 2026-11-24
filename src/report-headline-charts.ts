/**
 * The check's headline numbers and parts as pictures (canon/headline.ts,
 * canon/parts.ts), beside the tables that carry the exact values.
 *
 * Interval chart: one panel per headline on its own axis (a share and a
 * count never share one), a row per candidate: a dot at the value and a
 * line over its 95% interval. Whether two intervals overlap is the thing to
 * see. Each candidate keeps one colour on the page (the series palette,
 * validated for colour-blind separation), and is named on its row, so
 * identity is never colour alone.
 *
 * Part strip: a row per candidate, a cell per part, split by the first tag
 * group. A cell's tint is how often the part passed (one hue, light to
 * dark) and the count is printed in it, so the tint is never the only
 * carrier. The parts nobody passed read as a pale column.
 *
 * Pure rendering: HTML and CSS, no script. Hover text is the title attribute.
 */

import { headlineScale, type HeadlineEntry, type HeadlineValue } from "./canon/headline.js";
import type { PartBoard, PartRow } from "./canon/parts.js";
import { fmtMeasure } from "./canon/measures.js";
import { escapeHtml } from "./html.js";

/** Series colours repeat after this many candidates; the row label still names each. */
const SERIES = 4;
const seriesVar = (i: number): string => `var(--s${(i % SERIES) + 1})`;
/** The darkest tint a cell gets, as a share of the series colour over the surface. */
const TINT_MAX_PCT = 85;
/** From this pass rate up, a cell's count is drawn light on the dark tint. */
const LIGHT_TEXT_FROM = 0.5;

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const left = (v: number, max: number): string => `${(Math.min(1, Math.max(0, max === 0 ? 0 : v / max)) * 100).toFixed(1)}%`;

function valueText(v: HeadlineValue): string {
  return v.kind === "share" ? `${v.numerator}/${v.denominator} · ${pct(v.value)}` : fmtMeasure(v.value);
}

function hoverText(candidate: string, v: HeadlineValue): string {
  const fmt = v.kind === "share" ? pct : fmtMeasure;
  const ci = v.low === null || v.high === null ? "" : `, 95% ${fmt(v.low)}–${fmt(v.high)}`;
  return `${candidate}: ${valueText(v)}${ci}, n ${v.inputs}`;
}

function panel(h: HeadlineEntry, candidates: readonly string[]): string {
  const scale = headlineScale(h);
  const grid = scale.ticks.map((t) => `<span class="iv-grid" style="left:${left(t, scale.max)}"></span>`).join("");
  const rows = candidates
    .map((c, i) => {
      const v = h.all[c];
      if (!v) return `<div class="iv-row"><span class="iv-name">${escapeHtml(c)}</span><span class="iv-track">${grid}</span><span class="iv-val muted">—</span></div>`;
      const bar =
        v.low === null || v.high === null
          ? ""
          : `<span class="iv-bar" style="left:${left(v.low, scale.max)};width:${(parseFloat(left(v.high, scale.max)) - parseFloat(left(v.low, scale.max))).toFixed(1)}%;background:${seriesVar(i)}"></span>`;
      return `<div class="iv-row" title="${escapeHtml(hoverText(c, v))}"><span class="iv-name">${escapeHtml(c)}</span><span class="iv-track">${grid}${bar}<span class="iv-dot" style="left:${left(v.value, scale.max)};background:${seriesVar(i)}"></span></span><span class="iv-val">${escapeHtml(valueText(v))}</span></div>`;
    })
    .join("");
  const axis = scale.ticks.map((t) => `<span style="left:${left(t, scale.max)}">${escapeHtml(scale.format(t))}</span>`).join("");
  return `<div class="iv-panel"><h4>${escapeHtml(h.decl.label)}</h4>${rows}<div class="iv-row iv-axis"><span></span><span class="iv-track">${axis}</span><span></span></div></div>`;
}

/** One panel per headline; empty when the check has none. */
export function renderHeadlineChart(board: readonly HeadlineEntry[], candidates: readonly string[]): string {
  if (board.length === 0) return "";
  return `<div class="iv">${board.map((h) => panel(h, candidates)).join("")}</div>
    <p class="note">A dot is the value, the line its 95% interval; each panel has its own axis. Intervals that overlap are not a difference.</p>`;
}

/** The parts in blocks by the first tag group, in the board's order; parts carrying none of its tags come last. */
function blocks(board: PartBoard): Array<{ title: string | null; rows: PartRow[] }> {
  const lead = board.groups[0];
  if (!lead || lead.title === null) return [{ title: null, rows: board.rows }];
  const tags = lead.rows.map((r) => r.label);
  const tagged = tags.map((tag) => ({ title: tag as string | null, rows: board.rows.filter((r) => tags.find((t) => r.tags.includes(t)) === tag) }));
  const rest = board.rows.filter((r) => !tags.some((t) => r.tags.includes(t)));
  return [...tagged, ...(rest.length > 0 ? [{ title: "other" as string | null, rows: rest }] : [])].filter((b) => b.rows.length > 0);
}

function cell(candidate: string, r: PartRow): string {
  const c = r.cells[candidate] ?? { pass: 0, graded: 0 };
  const what = `${candidate} · ${r.input} ${r.label ?? r.id}`;
  if (c.graded === 0) return `<span class="ps-cell ps-none" title="${escapeHtml(`${what}: not graded`)}">—</span>`;
  const title = escapeHtml(`${what}: ${c.pass}/${c.graded}`);
  if (c.pass === 0) return `<span class="ps-cell ps-zero" title="${title}">0</span>`;
  const rate = c.pass / c.graded;
  const tint = Math.round(rate * TINT_MAX_PCT);
  return `<span class="ps-cell${rate >= LIGHT_TEXT_FROM ? " ps-hi" : ""}" style="background:color-mix(in srgb,var(--s1) ${tint}%,var(--surface))" title="${title}">${c.pass}</span>`;
}

/** A row per candidate, a cell per part; empty when no part was reported. */
export function renderPartStrip(board: PartBoard | null, candidates: readonly string[]): string {
  if (!board) return "";
  const groups = blocks(board);
  const block = (b: { title: string | null; rows: PartRow[] }): string => {
    const head = `<div class="ps-row ps-head"><span class="ps-name"></span>${b.rows.map((r) => `<span class="ps-col" title="${escapeHtml(`${r.input} ${r.label ?? r.id}`)}">${escapeHtml(r.input)}</span>`).join("")}</div>`;
    const rows = candidates.map((c) => `<div class="ps-row"><span class="ps-name">${escapeHtml(c)}</span>${b.rows.map((r) => cell(c, r)).join("")}</div>`).join("");
    return `<div class="ps-block">${b.title === null ? "" : `<div class="ps-title">${escapeHtml(b.title)} <span class="muted">${b.rows.length}</span></div>`}${head}${rows}</div>`;
  };
  return `<div class="ps">${groups.map(block).join("")}</div>
    <p class="note">A column is one part, a row one candidate; the number is the trials that passed it, and the tint deepens with it. Hover a cell for what the part is.</p>`;
}

export const HEADLINE_CHART_STYLES = `
.iv{display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:18px 44px;margin:6px 0 2px}
.iv-panel h4{margin:0 0 6px;font-size:12.5px;font-weight:600;color:var(--ink)}
.iv-row{display:grid;grid-template-columns:8.5em 1fr 8em;gap:10px;align-items:center;height:24px;font-size:12px}
.iv-name{font-family:var(--mono);color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.iv-val{font-family:var(--mono);font-variant-numeric:tabular-nums;color:var(--ink);white-space:nowrap}
.iv-track{position:relative;height:24px}
.iv-grid{position:absolute;top:0;bottom:0;width:1px;background:var(--rule)}
.iv-bar{position:absolute;top:11px;height:2px;border-radius:1px}
.iv-dot{position:absolute;top:6px;width:12px;height:12px;margin-left:-6px;border-radius:50%;box-shadow:0 0 0 2px var(--surface)}
.iv-axis{height:16px}.iv-axis .iv-track span{position:absolute;top:2px;transform:translateX(-50%);font-size:10.5px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.ps{display:flex;flex-wrap:wrap;gap:10px 22px;margin:6px 0 2px;overflow-x:auto}
.ps-title{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);margin:0 0 4px 7.5em}
.ps-row{display:flex;gap:2px;align-items:center;margin-bottom:2px}
.ps-name{flex:none;width:7.5em;font-family:var(--mono);font-size:12px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ps-col{flex:none;width:26px;height:52px;writing-mode:vertical-rl;transform:rotate(180deg);font-family:var(--mono);font-size:10px;color:var(--ink-3);line-height:26px;overflow:hidden;white-space:nowrap}
.ps-cell{flex:none;width:26px;height:24px;border-radius:4px;display:grid;place-items:center;font-family:var(--mono);font-size:11px;font-variant-numeric:tabular-nums;color:var(--ink)}
.ps-cell.ps-hi{color:#fff}.ps-cell.ps-zero{background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--rule);color:var(--ink-3)}.ps-cell.ps-none{color:var(--ink-3)}
`;
