/**
 * Cost against success, one dot per candidate: the picture of a lowest-cost
 * pick. Up is the required check passing more often, left is cheaper per
 * success — the same generation cost per success the selector ranks on, so the
 * chart can never disagree with the recommendation. The required-check gate is
 * the dashed line; a candidate any gate removed is a hollow dot.
 *
 * This file only lays the chart out. Both renderers draw these numbers:
 * `renderCostSuccess` here for report.html, `charts/CostSuccess.tsx` for the
 * dashboard, so the two never place a dot differently.
 *
 * Two kinds of cost do not fit a log axis and get their own lane instead of
 * being dropped: $0 (a non-model candidate) on the far left, and "cost n/a"
 * (nothing passed, or spend was not reported) on the far right.
 */

import { escapeHtml } from "./html.js";

export interface ScatterCandidate {
  id: string;
  checkPass: number;
  checkExecuted: number;
  costPerSuccess: number | null;
  costObserved: boolean;
  gated: boolean;
  chosen: boolean;
  isControl: boolean;
}

export interface ScatterPoint {
  candidate: string;
  cx: number;
  cy: number;
  /** `leader` is set when the label had to move off the dot's row: draw a line back to it. */
  label: { x: number; y: number; anchor: "start" | "end"; leader: boolean };
  gated: boolean;
  chosen: boolean;
  isControl: boolean;
  /** One line for the hover title: the numbers the dot stands for. */
  title: string;
}

export interface Tick {
  at: number;
  label: string;
}

export interface CostSuccessChart {
  width: number;
  height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  /** The plot plus its lanes: where grid lines and the gate line run. */
  frame: { left: number; right: number };
  xTicks: Tick[];
  yTicks: Tick[];
  /** The $0 and "no cost per success" lanes, when a candidate sits in one. */
  lanes: Array<{ x: number; label: string }>;
  /** The required-check gate; null when the step declares none. */
  gate: { y: number; label: string } | null;
  points: ScatterPoint[];
  /** Candidates with no executed check: no y to put them at. */
  unplotted: string[];
}

const WIDTH = 640;
const HEIGHT = 320;
/** The top margin leaves room for labels stacked above a crowded 100% row. */
const MARGIN = { left: 52, right: 24, top: 36, bottom: 40 };
const LANE_GAP = 72;
const LABEL_OFFSET = 9;
const LABEL_LINE = 13;
/** 11px text: a conservative width per character, so labels err towards not touching. */
const CHAR_WIDTH = 6.4;

const pctText = (r: number): string => `${Math.round(r * 100)}%`;

function usdTick(v: number): string {
  if (v >= 1) return `$${v.toFixed(0)}`;
  const digits = Math.max(0, -Math.floor(Math.log10(v)));
  return `$${v.toFixed(digits)}`;
}

function usdExact(v: number): string {
  return v === 0 ? "$0" : `$${v < 0.01 ? v.toPrecision(2) : v.toFixed(4)}`;
}

/** Decades that cover the positive costs, widened to at least one full decade. */
function logDomain(costs: readonly number[]): [number, number] {
  const lo = Math.floor(Math.log10(Math.min(...costs)));
  const hi = Math.ceil(Math.log10(Math.max(...costs)));
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/**
 * The pass-rate axis: from just below the lowest rate (or the gate) up to
 * 100%, on round ticks. A step where every candidate passes 90%+ would
 * otherwise leave nine tenths of the chart empty and stack every dot on one
 * line. The axis labels say where it starts; it starts at 0% when anything is
 * low.
 */
function rateDomain(values: readonly number[]): [number, number] {
  const low = Math.min(...values);
  const step = low >= 0.8 ? 0.05 : low >= 0.5 ? 0.1 : 0.25;
  const lo = Math.max(0, Math.floor((low - step / 2) / step) * step);
  return [Number(lo.toFixed(2)), step];
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Greedy label placement: right of the dot, then above or below it, then the
 * left side — the first spot that touches no placed label and no dot. Good
 * enough for the dozen candidates a step has; the hover title names every dot
 * whatever happens to its label.
 */
function placeLabels(
  dots: ReadonlyArray<{ id: string; cx: number; cy: number }>,
  plot: CostSuccessChart["plot"],
  gateY: number | null,
): Map<string, ScatterPoint["label"]> {
  const placed: Box[] = dots.map((d) => ({ x0: d.cx - 6, x1: d.cx + 6, y0: d.cy - 6, y1: d.cy + 6 }));
  if (gateY !== null) placed.push({ x0: 0, x1: WIDTH, y0: gateY - 2, y1: gateY + 2 });
  const out = new Map<string, ScatterPoint["label"]>();
  const shifts = [0, -1, 1, -2, 2, -3, 3, -4, 4].map((n) => n * LABEL_LINE);
  for (const d of [...dots].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    const w = d.id.length * CHAR_WIDTH;
    const options = (["start", "end"] as const).flatMap((anchor) =>
      shifts.map((dy) => {
        const x = anchor === "start" ? d.cx + LABEL_OFFSET : d.cx - LABEL_OFFSET;
        const y = d.cy + 4 + dy;
        const box = { x0: anchor === "start" ? x : x - w, x1: anchor === "start" ? x + w : x, y0: y - 10, y1: y + 2 };
        return { label: { x, y, anchor, leader: dy !== 0 }, box };
      }),
    );
    const inside = options.filter((o) => o.box.x0 >= 0 && o.box.x1 <= WIDTH && o.box.y0 >= 0 && o.box.y1 <= plot.bottom + 2);
    const pick = inside.find((o) => !placed.some((p) => overlaps(p, o.box))) ?? inside[0] ?? options[0];
    placed.push(pick.box);
    out.set(d.id, pick.label);
  }
  return out;
}

function titleOf(c: ScatterCandidate, gateNote: string | undefined): string {
  const cost =
    c.costPerSuccess !== null ? `${usdExact(c.costPerSuccess)} per success` : c.costObserved ? "no success to price" : "spend not reported";
  const role = [c.chosen ? "recommended" : null, c.isControl ? "control" : null, c.gated ? `gated out${gateNote ? `: ${gateNote}` : ""}` : null]
    .filter(Boolean)
    .join(" · ");
  return `${c.id} · required check ${c.checkPass}/${c.checkExecuted} · ${cost}${role ? ` · ${role}` : ""}`;
}

/**
 * Lay the chart out; null when there is nothing to compare (fewer than two
 * candidates with a check that ran).
 */
export function costSuccessChart(
  candidates: readonly ScatterCandidate[],
  minCheckPassRate: number | null,
  gateNotes: ReadonlyMap<string, string> = new Map(),
): CostSuccessChart | null {
  const plotted = candidates.filter((c) => c.checkExecuted > 0);
  if (plotted.length < 2) return null;

  const positive = plotted.map((c) => c.costPerSuccess).filter((v): v is number => v !== null && v > 0);
  const hasZero = plotted.some((c) => c.costPerSuccess === 0);
  const hasNone = plotted.some((c) => c.costPerSuccess === null);

  const left = MARGIN.left + (hasZero ? LANE_GAP : 0);
  const right = WIDTH - MARGIN.right - (hasNone ? LANE_GAP : 0);
  const plot = { left, right, top: MARGIN.top, bottom: HEIGHT - MARGIN.bottom };
  const [lo, hi] = positive.length > 0 ? logDomain(positive) : [-3, -2];
  const xOf = (v: number): number => left + ((Math.log10(v) - lo) / (hi - lo)) * (right - left);
  const rates = plotted.map((c) => c.checkPass / c.checkExecuted);
  const [yLo, yStep] = rateDomain([...rates, ...(minCheckPassRate === null ? [] : [minCheckPassRate])]);
  const yOf = (rate: number): number => plot.bottom - ((rate - yLo) / (1 - yLo)) * (plot.bottom - plot.top);
  const zeroX = MARGIN.left + LANE_GAP / 3;
  const noneX = WIDTH - MARGIN.right - LANE_GAP / 3;

  const dots = plotted.map((c) => ({
    c,
    id: c.id,
    cx: c.costPerSuccess === null ? noneX : c.costPerSuccess === 0 ? zeroX : xOf(c.costPerSuccess),
    cy: yOf(c.checkPass / c.checkExecuted),
  }));
  const labels = placeLabels(dots, plot, minCheckPassRate === null ? null : yOf(minCheckPassRate));

  const xTicks: Tick[] = positive.length > 0
    ? Array.from({ length: hi - lo + 1 }, (_, i) => 10 ** (lo + i)).map((v) => ({ at: xOf(v), label: usdTick(v) }))
    : [];

  return {
    width: WIDTH,
    height: HEIGHT,
    plot,
    frame: { left: MARGIN.left, right: WIDTH - MARGIN.right },
    xTicks,
    yTicks: Array.from({ length: Math.round((1 - yLo) / yStep) + 1 }, (_, i) => yLo + i * yStep).map((r) => ({ at: yOf(r), label: pctText(r) })),
    lanes: [
      ...(hasZero ? [{ x: zeroX, label: "$0" }] : []),
      ...(hasNone ? [{ x: noneX, label: "cost n/a" }] : []),
    ],
    gate: minCheckPassRate === null ? null : { y: yOf(minCheckPassRate), label: `required-check gate ≥ ${pctText(minCheckPassRate)}` },
    points: dots.map((d) => ({
      candidate: d.id,
      cx: d.cx,
      cy: d.cy,
      label: labels.get(d.id) as ScatterPoint["label"],
      gated: d.c.gated,
      chosen: d.c.chosen,
      isControl: d.c.isControl,
      title: titleOf(d.c, gateNotes.get(d.id)),
    })),
    unplotted: candidates.filter((c) => c.checkExecuted === 0).map((c) => c.id),
  };
}

/** Who each gate removed and on what number, by candidate: the first gate that did. */
export function gateNotesOf(gates: ReadonlyArray<{ removed: ReadonlyArray<{ candidate: string; detail: string }> }>): Map<string, string> {
  const notes = new Map<string, string>();
  for (const g of gates) for (const r of g.removed) if (!notes.has(r.candidate)) notes.set(r.candidate, r.detail);
  return notes;
}

/** The section's wording, shared by both renderers. */
export const COST_SUCCESS_TITLE = "Cost and success";
export const COST_SUCCESS_HINT = "one point per candidate · up passes the required check more often, left costs less per success";

export function costSuccessNote(chart: CostSuccessChart): string {
  const unplotted = chart.unplotted.length ? ` Not plotted, no check ran: ${chart.unplotted.join(", ")}.` : "";
  const na = chart.lanes.some((l) => l.label === "cost n/a")
    ? ` "cost n/a" is not the most expensive: nothing passed to price, or some calls reported no spend (often a timeout).`
    : "";
  return `The cost is the generation cost per success the operating mode ranks on: under "lowest cost" the recommendation is the leftmost filled point${chart.gate ? " above the gate" : ""}. A point can sit above the gate and still be hollow when another gate (reliability, pass^k) removed it; hover a point for its numbers and the gate that removed it.${na}${unplotted}`;
}

// ── report.html ──────────────────────────────────────────────────────────────

const f = (n: number): string => n.toFixed(1);

function markSvg(p: ScatterPoint): string {
  const cls = `cs-dot${p.gated ? " gated" : ""}${p.chosen ? " chosen" : ""}`;
  const ring = p.chosen ? `<circle class="cs-ring" cx="${f(p.cx)}" cy="${f(p.cy)}" r="9"/>` : "";
  const shape = p.isControl
    ? `<rect class="${cls}" x="${f(p.cx - 5)}" y="${f(p.cy - 5)}" width="10" height="10" rx="1.5"/>`
    : `<circle class="${cls}" cx="${f(p.cx)}" cy="${f(p.cy)}" r="5"/>`;
  const leader = p.label.leader
    ? `<line class="cs-leader" x1="${f(p.cx)}" y1="${f(p.cy)}" x2="${f(p.label.anchor === "start" ? p.label.x - 2 : p.label.x + 2)}" y2="${f(p.label.y - 4)}"/>`
    : "";
  const label = `<text class="cs-label${p.gated ? " gated" : ""}${p.chosen ? " chosen" : ""}" x="${f(p.label.x)}" y="${f(p.label.y)}" text-anchor="${p.label.anchor}">${escapeHtml(p.candidate)}</text>`;
  // A wide transparent hit target, so the title shows without aiming at a 10px dot.
  return `<g><title>${escapeHtml(p.title)}</title><circle class="cs-hit" cx="${f(p.cx)}" cy="${f(p.cy)}" r="12"/>${leader}${ring}${shape}${label}</g>`;
}

export function renderCostSuccess(chart: CostSuccessChart | null): string {
  if (chart === null) return "";
  const { plot, frame } = chart;
  const yAxis = chart.yTicks
    .map((t) => `<line class="cs-grid" x1="${frame.left}" x2="${frame.right}" y1="${f(t.at)}" y2="${f(t.at)}"/><text class="cs-tick" x="${frame.left - 8}" y="${f(t.at + 4)}" text-anchor="end">${t.label}</text>`)
    .join("");
  const xAxis = chart.xTicks
    .map((t) => `<text class="cs-tick" x="${f(t.at)}" y="${plot.bottom + 18}" text-anchor="middle">${t.label}</text>`)
    .join("");
  const lanes = chart.lanes
    .map((l) => `<line class="cs-lane" x1="${f(l.x)}" x2="${f(l.x)}" y1="${plot.top}" y2="${plot.bottom}"/><text class="cs-tick" x="${f(l.x)}" y="${plot.bottom + 18}" text-anchor="middle">${l.label}</text>`)
    .join("");
  const gate = chart.gate
    ? `<line class="cs-gate" x1="${frame.left}" x2="${frame.right}" y1="${f(chart.gate.y)}" y2="${f(chart.gate.y)}"/>`
    : "";
  const svg = `<svg class="cs" viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="Required-check pass rate against generation cost per success, one point per candidate">
    ${yAxis}${lanes}${xAxis}${gate}
    <text class="cs-axis" x="${f((plot.left + plot.right) / 2)}" y="${chart.height - 4}" text-anchor="middle">generation cost per success (log scale) — cheaper is left</text>
    ${chart.points.map(markSvg).join("")}
  </svg>`;
  return `<section class="card">
    <h2>${COST_SUCCESS_TITLE} <span class="hint">${COST_SUCCESS_HINT}</span></h2>
    <figure class="cs-fig">${svg}
      <figcaption class="cs-legend"><span><i class="k-dot"></i>passed every gate</span><span><i class="k-dot gated"></i>removed by a gate</span><span><i class="k-dot chosen"></i>recommended</span><span><i class="k-square"></i>control</span>${chart.gate ? `<span><i class="k-gate"></i>${escapeHtml(chart.gate.label)}</span>` : ""}</figcaption>
    </figure>
    <p class="note">${escapeHtml(costSuccessNote(chart))}</p>
  </section>`;
}

export const SCATTER_STYLES = `
.cs-fig{margin:0;display:grid;gap:8px}
svg.cs{width:100%;height:auto;max-width:760px;overflow:visible;font-family:inherit}
.cs-grid{stroke:var(--rule);stroke-width:1}.cs-lane{stroke:var(--rule);stroke-width:1;stroke-dasharray:2 3}
.cs-tick{font-size:11px;fill:var(--ink-3);font-family:var(--mono)}.cs-axis{font-size:11px;fill:var(--ink-2)}
.cs-gate{stroke:var(--bad-fg);stroke-width:1.5;stroke-dasharray:6 4}.cs-leader{stroke:var(--ink-3);stroke-width:.75}
.cs-hit{fill:transparent}
.cs-dot{fill:var(--accent-2);stroke:var(--surface);stroke-width:2}
.cs-dot.gated{fill:var(--surface);stroke:var(--ink-3);stroke-width:1.5}
.cs-dot.chosen{fill:var(--accent)}.cs-ring{fill:none;stroke:var(--accent);stroke-width:2}
.cs-label{font-size:11px;fill:var(--ink-2)}.cs-label.gated{fill:var(--ink-3)}.cs-label.chosen{fill:var(--ink);font-weight:700}
.cs-legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--ink-2)}
.cs-legend span{display:inline-flex;align-items:center;gap:6px}
.cs-legend i{display:inline-block;width:10px;height:10px}
.k-dot{border-radius:50%;background:var(--accent-2)}.k-dot.gated{background:var(--surface);box-shadow:inset 0 0 0 1.5px var(--ink-3)}
.k-dot.chosen{background:var(--accent);box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--accent)}
.k-square{border-radius:2px;background:var(--accent-2)}
.k-gate{width:18px!important;height:0!important;border-top:1.5px dashed var(--bad-fg)}
`;
