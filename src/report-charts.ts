/**
 * Charts for the canonical run report.
 *
 * Every chart reads the canonical trial rows — the same file the tables and the
 * recommendation read — so a picture can never disagree with the numbers beside
 * it. Pure string rendering, inline SVG, no runtime dependency.
 *
 * Palette: validated categorical slots 1–3 (blue / orange / aqua) and the blue
 * sequential ramp, both checked with the dataviz validator in light and dark.
 * Aqua sits below 3:1 on the light surface, so identity is never colour-alone:
 * the radar direct-labels every vertex and the heatmap prints its values.
 */

import { judgeDiscrimination } from "./canon/discrimination.js";
import type { TrialRow } from "./canon/rows.js";
import { escapeHtml } from "./html.js";

/** All-pairs forms (radar) cap at three series; past that the shape is noise. */
const RADAR_MAX_SERIES = 3;
const SCORE_MIN = 1;
const SCORE_MAX = 5;

/** Sequential blue ramp, 100 → 700, light means "near zero". */
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#1c5cab", "#104281"];

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

/** Score 1–5 → ramp step. Below 1 or missing is not a colour, it is an absence. */
export function rampStep(score: number | null): string | null {
  if (score === null) return null;
  const clamped = Math.max(SCORE_MIN, Math.min(SCORE_MAX, score));
  const idx = Math.round(((clamped - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * (RAMP.length - 1));
  return RAMP[idx];
}

function swatch(index: number): string {
  return `<span class="viz-sw viz-s${index}"></span>`;
}

/**
 * Dimension profile. A radar answers "what shape is this candidate" — which
 * dimension it wins on relative to its own other dimensions — at a glance.
 * The heatmap below it carries the precise values.
 */
export function renderRadar(trials: readonly TrialRow[]): string {
  const dims = dimensionKeys(trials);
  const all = profiles(trials);
  const drawable = all.filter((p) => dims.every((d) => p.scores[d] !== null));
  if (dims.length < 3 || drawable.length === 0) return "";

  // Every dimension saturated: the outlines are one shape on top of another.
  // Drawing it invites reading a profile out of a grader that never varied.
  const spread = judgeDiscrimination(trials);
  if (dims.every((d) => spread.saturated.includes(d))) {
    return `<figure class="viz viz-void">
    <figcaption>维度轮廓 <span class="hint">未绘制</span></figcaption>
    <p class="viz-note">每个维度上所有候选得分相同，轮廓会完全重合。绝对打分在这次运行里没有区分度，不画图形以免被读成"势均力敌"。见下方矩阵与 GAPS.md。</p>
  </figure>`;
  }
  const series = drawable.slice(0, RADAR_MAX_SERIES);
  const dropped = drawable.length - series.length;

  const W = 560;
  const H = 400;
  const cx = W / 2;
  const cy = 196;
  const R = 128;
  const N = dims.length;
  const ang = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  const rad = (v: number): number =>
    ((Math.max(SCORE_MIN, Math.min(SCORE_MAX, v)) - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * R;
  const x = (i: number, r: number): string => (cx + r * Math.cos(ang(i))).toFixed(1);
  const y = (i: number, r: number): string => (cy + r * Math.sin(ang(i))).toFixed(1);

  let grid = "";
  for (let v = 2; v <= SCORE_MAX; v++) {
    grid += `<polygon class="viz-grid" points="${dims.map((_, i) => `${x(i, rad(v))},${y(i, rad(v))}`).join(" ")}"/>`;
    grid += `<text class="viz-tick" x="${(cx + 4).toFixed(1)}" y="${(cy - rad(v) + 3).toFixed(1)}">${v}</text>`;
  }

  let axes = "";
  dims.forEach((dim, i) => {
    axes += `<line class="viz-grid" x1="${cx}" y1="${cy}" x2="${x(i, R)}" y2="${y(i, R)}"/>`;
    const c = Math.cos(ang(i));
    const anchor = c > 0.3 ? "start" : c < -0.3 ? "end" : "middle";
    axes += `<text class="viz-axis" x="${x(i, R + 22)}" y="${(Number(y(i, R + 22)) + 4).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(dim)}</text>`;
  });

  let marks = "";
  series.forEach((p, si) => {
    const pts = dims.map((d, i) => `${x(i, rad(p.scores[d] as number))},${y(i, rad(p.scores[d] as number))}`).join(" ");
    marks += `<polygon class="viz-poly viz-f${si}" points="${pts}"/>`;
    dims.forEach((d, i) => {
      const v = p.scores[d] as number;
      marks += `<circle class="viz-dot viz-c${si}" cx="${x(i, rad(v))}" cy="${y(i, rad(v))}" r="4.5"><title>${escapeHtml(p.candidate)} · ${escapeHtml(d)}: ${v.toFixed(1)}/5</title></circle>`;
    });
  });

  const legend = series
    .map((p, si) => `<span class="viz-lg">${swatch(si)}${escapeHtml(p.candidate)} · ${p.overall === null ? "—" : p.overall.toFixed(1)}/5</span>`)
    .join("");
  const note = dropped > 0 ? `<p class="viz-note">另有 ${dropped} 个候选未画：一次最多三条轮廓，更多会读不出形状，精确值见下方矩阵。</p>` : "";

  return `<figure class="viz">
    <figcaption>维度轮廓 <span class="hint">绝对分均值，中心 1 分、外圈 5 分</span></figcaption>
    <div class="viz-legend">${legend}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="各候选的维度得分轮廓">
      ${grid}${axes}${marks}
    </svg>${note}
  </figure>`;
}

/** Precise per-dimension magnitude: one hue, light → dark, values printed. */
export function renderHeatmap(trials: readonly TrialRow[]): string {
  const dims = dimensionKeys(trials);
  const rows = profiles(trials);
  if (dims.length === 0 || rows.length === 0) return "";

  const spread = judgeDiscrimination(trials);
  const flat = new Set(spread.saturated);
  const head = dims
    .map((d) =>
      flat.has(d)
        ? `<th class="num viz-flat" title="所有候选同分，无区分度">${escapeHtml(d)} <span class="viz-flag">无区分</span></th>`
        : `<th class="num">${escapeHtml(d)}</th>`,
    )
    .join("");
  const body = rows
    .map((p) => {
      const cells = dims
        .map((d) => {
          const v = p.scores[d];
          const fill = rampStep(v);
          if (v === null || fill === null) {
            return `<td class="viz-cell viz-none" title="${escapeHtml(d)}：未打分">—</td>`;
          }
          const dark = v >= 3.5;
          return `<td class="viz-cell${dark ? " viz-on-dark" : ""}" style="background:${fill}" title="${escapeHtml(p.candidate)} · ${escapeHtml(d)}: ${v.toFixed(1)}/5">${v.toFixed(1)}</td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(p.candidate)}</th>${cells}<td class="num">${p.overall === null ? "—" : p.overall.toFixed(1)}</td></tr>`;
    })
    .join("");

  const scale = RAMP.map((c) => `<span class="viz-step" style="background:${c}"></span>`).join("");

  return `<figure class="viz">
    <figcaption>维度得分矩阵 <span class="hint">1–5 绝对分，颜色深浅即分数高低</span></figcaption>
    <div class="table-wrap"><table class="viz-heat"><thead><tr><th>候选</th>${head}<th class="num">总分</th></tr></thead><tbody>${body}</tbody></table></div>
    <div class="viz-scale"><span>1</span>${scale}<span>5</span></div>
    ${
      flat.size > 0
        ? `<p class="viz-note">标注「无区分」的维度上，每个候选拿到的分完全一样——那是打分器没有分辨出差异，不是候选真的相当。这些列不参与推荐。</p>`
        : ""
    }
  </figure>`;
}

/**
 * One mark per trial, not an average. With two or three repeats an average
 * hides the thing that matters most — whether the candidate is consistent —
 * and a mean over a timeout is a lie.
 */
export function renderTrialStrip(trials: readonly TrialRow[]): string {
  if (trials.length === 0) return "";
  const order = [...new Set(trials.map((t) => t.candidate))];
  const W = 560;
  const rowH = 38;
  const left = 132;
  const plot = W - left - 28;
  const pos = (score: number): number =>
    left + ((Math.max(SCORE_MIN, Math.min(SCORE_MAX, score)) - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * plot;

  const ticks = [1, 2, 3, 4, 5]
    .map(
      (v) =>
        `<line class="viz-grid" x1="${pos(v)}" y1="18" x2="${pos(v)}" y2="${order.length * rowH + 16}"/>` +
        `<text class="viz-tick" x="${pos(v)}" y="12" text-anchor="middle">${v}</text>`,
    )
    .join("");

  const rows = order
    .map((candidate, ri) => {
      const own = trials.filter((t) => t.candidate === candidate);
      const cy = 30 + ri * rowH;
      const label = `<text class="viz-axis" x="${left - 10}" y="${cy + 4}" text-anchor="end">${escapeHtml(candidate)}</text>`;
      // Two trials that scored the same would sit on top of each other; nudge
      // them apart so the eye counts the right number of runs.
      const seen = new Map<number, number>();
      const marks = own
        .map((t) => {
          const score = t.judge?.absolute_overall;
          const state = `${escapeHtml(t.completion_state)}${t.truncated ? " · 截断" : ""}`;
          if (typeof score !== "number") {
            return `<text class="viz-miss" x="${left + 6}" y="${cy + 4}">${state}（未打分）</text>`;
          }
          const stack = seen.get(score) ?? 0;
          seen.set(score, stack + 1);
          const dy = stack === 0 ? 0 : stack % 2 === 1 ? 7 : -7;
          const bad = t.completion_state !== "success" || t.truncated;
          return `<circle class="viz-dot viz-c${ri % RADAR_MAX_SERIES}${bad ? " viz-bad" : ""}" cx="${pos(score)}" cy="${cy + dy}" r="6"><title>${escapeHtml(candidate)} · t${t.trial} · ${state} · ${score}/5</title></circle>`;
        })
        .join("");
      return label + marks;
    })
    .join("");

  return `<figure class="viz">
    <figcaption>每次试验的总分 <span class="hint">一次试验一个点，不取平均；空心点是未正常完成的试验</span></figcaption>
    <svg viewBox="0 0 ${W} ${order.length * rowH + 28}" width="100%" role="img" aria-label="每个候选每次试验的绝对总分">
      ${ticks}${rows}
    </svg>
  </figure>`;
}

export const CHART_STYLES = `
.viz-flat{color:var(--warn-fg)}
.viz-flag{font-size:10px;font-weight:600;background:var(--warn-bg);color:var(--warn-fg);padding:0 5px;border-radius:3px;white-space:nowrap}
.viz-void .viz-note{margin-top:8px}
.viz{margin:14px 0 0;padding:0}
.viz-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:18px;align-items:start}
.viz figcaption{font-size:13px;font-weight:600;margin-bottom:8px;display:flex;gap:8px;align-items:baseline}
.viz-legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:4px;font-size:12px;color:var(--ink-2)}
.viz-lg{display:inline-flex;gap:6px;align-items:center}
.viz-sw{width:10px;height:10px;border-radius:2px;display:inline-block}
.viz-s0,.viz-c0{--viz:#2a78d6}.viz-s1,.viz-c1{--viz:#eb6834}.viz-s2,.viz-c2{--viz:#1baf7a}
.viz-sw{background:var(--viz)}
.viz-grid{fill:none;stroke:var(--rule);stroke-width:1}
.viz-axis{font-size:11px;fill:var(--ink-2)}
.viz-tick{font-size:10px;fill:var(--ink-3)}
.viz-poly{fill:var(--viz);fill-opacity:.1;stroke:var(--viz);stroke-width:2}
.viz-f0{--viz:#2a78d6}.viz-f1{--viz:#eb6834}.viz-f2{--viz:#1baf7a}
.viz-dot{fill:var(--viz);stroke:var(--surface);stroke-width:2}
.viz-bad{fill:var(--surface);stroke:var(--viz);stroke-width:2;stroke-dasharray:3 2}
.viz-miss{font-size:11px;fill:var(--ink-3)}
.viz-note{font-size:12px;color:var(--ink-3);margin:6px 0 0}
table.viz-heat{width:100%;border-collapse:separate;border-spacing:2px}
table.viz-heat th{font-size:12px;font-weight:500;color:var(--ink-2);text-align:left;white-space:nowrap}
td.viz-cell{text-align:center;border-radius:4px;padding:8px 6px;font-variant-numeric:tabular-nums;color:#0d366b}
td.viz-on-dark{color:#fff}
td.viz-none{background:var(--surface-2);color:var(--ink-3)}
.viz-scale{display:flex;gap:2px;align-items:center;margin-top:8px;font-size:11px;color:var(--ink-3)}
.viz-step{width:26px;height:8px;border-radius:2px;display:inline-block}
@media(prefers-color-scheme:dark){
  .viz-s0,.viz-c0,.viz-f0{--viz:#3987e5}.viz-s1,.viz-c1,.viz-f1{--viz:#d95926}.viz-s2,.viz-c2,.viz-f2{--viz:#199e70}
}
`;
