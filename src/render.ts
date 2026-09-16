/**
 * Shared HTML rendering primitives for `report.ts` (single suite) and
 * `dashboard.ts` (combined cross-step). Both render the SAME per-step card so
 * the two views stay identical; this module is the single source of that card,
 * its formatting helpers, and the shared stylesheet.
 *
 * Constraints (inherited by every consumer): plain string building, ZERO
 * external deps, inline CSS, light/dark auto via prefers-color-scheme, wide
 * tables inside an `overflow-x:auto` container, and every dynamic value escaped.
 */

import type { Report, RunRecord, Scorecard, Judgement, Winner } from "./types.js";
import type { AiSummary } from "./summarize.js";
import {
  type Lang,
  absScoreSuffix,
  caveatHtml,
  champWinLine,
  dimLabel,
  duelSuffix,
  reasonsSummary,
  t,
} from "./i18n.js";

// Re-exported so existing consumers keep importing bilingual helpers from here.
export { type Lang, dimLabel, caveatHtml, CAVEAT_MD } from "./i18n.js";

/** records.json shape — a RunRecord with the raw output text stripped. */
export type RunRecordLite = Omit<RunRecord, "text">;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── formatting helpers ──────────────────────────────────────────────────────

export function fmtWinRate(s: Scorecard): string {
  return s.winRate === null ? "—" : `${s.winRate.toFixed(0)}`;
}

/**
 * A candidate's discrete pairwise record on one axis — integer wins / losses /
 * ties (ties are their own bucket, NOT split into halves). `comparisons` is the
 * sum. This is the honest, un-discretised truth behind the 0–100 win rate: with
 * only a handful of duels per model, the percentage lands on a few coarse values
 * and reads like a grade, whereas "2–1–1 over 4" makes the sample size obvious.
 */
export interface PairRecord {
  wins: number;
  losses: number;
  ties: number;
  comparisons: number;
}

/** Tally wins/losses/ties for `candidate` on the axis read by `pick`. Mirrors
 *  run.ts `winRateFor`'s counting, but keeps the raw record instead of a %. */
export function recordFor(
  candidate: string,
  judgements: Judgement[],
  pick: (jm: Judgement) => Winner | undefined,
): PairRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const jm of judgements) {
    const resolved = pick(jm);
    if (resolved === undefined) continue;
    const isA = jm.a === candidate;
    const isB = jm.b === candidate;
    if (!isA && !isB) continue;
    if (resolved === "tie") ties++;
    else if ((resolved === "a" && isA) || (resolved === "b" && isB)) wins++;
    else losses++;
  }
  return { wins, losses, ties, comparisons: wins + losses + ties };
}

/** "2–1–1" (W–L–T), or "—" when the candidate had no duels on this axis. */
export function fmtRecord(rec: PairRecord): string {
  if (rec.comparisons === 0) return "—";
  return `${rec.wins}–${rec.losses}–${rec.ties}`;
}

/** Overall-axis record for one candidate (convenience for the ranking table). */
export function overallRecord(report: Report, candidate: string): PairRecord {
  return recordFor(candidate, report.judgements, (jm) => jm.overall.resolved);
}

/** Objective pass rate as a percentage string, or "—" when not measured. */
export function fmtPassRate(s: Scorecard): string {
  return s.objectivePassRate == null
    ? "—"
    : `${(s.objectivePassRate * 100).toFixed(0)}%`;
}

/** Absolute overall score (1–5) as a string, or "—" when not measured. */
export function fmtScore(v: number | null | undefined): string {
  return typeof v === "number" ? v.toFixed(1) : "—";
}

/** True when at least one candidate in this report carries an absolute score. */
export function hasAbsolute(report: Report): boolean {
  return report.scorecards.some((s) => s.absoluteScore != null);
}

/** Stable colour slot ("s0".."s3") for a candidate, by suite order — matches
 *  the chart series colours so a model keeps ONE identity colour everywhere. */
export function candidateColorClass(report: Report, candidate: string): string {
  const i = report.candidates.indexOf(candidate);
  return `s${i < 0 ? 0 : Math.min(3, i)}`;
}

/** Objective pass rate as a coloured state pill (green=all pass, amber=partial,
 *  grey=none), or a muted dash when not measured. */
export function passRatePill(s: Scorecard): string {
  if (s.objectivePassRate == null) return '<span class="sub">—</span>';
  const p = s.objectivePassRate;
  const cls = p >= 0.999 ? "good" : p > 0 ? "warn" : "muted";
  return `<span class="pill ${cls}">${(p * 100).toFixed(0)}%</span>`;
}

/** AI verdict banner — the model-written verdict (empty string when absent). */
export function renderAiVerdict(summary: AiSummary, lang: Lang): string {
  if (!summary.verdict) return "";
  return `<div class="verdict">
    <p class="vlabel">${t(lang, "aiVerdictLabel")}</p>
    <p class="vbig">${escapeHtml(summary.verdict)}</p>
  </div>`;
}

/** AI-generated recommendation table (scenario → pick → reason). */
export function renderAiRecommendations(summary: AiSummary, lang: Lang): string {
  if (summary.recommendations.length === 0) return "";
  const rows = summary.recommendations
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.scenario)}</td><td class="pick">${escapeHtml(r.pick)}</td><td>${escapeHtml(r.reason)}</td></tr>`,
    )
    .join("\n");
  return `<section class="card">
    <h3>${t(lang, "aiRecoHead")} <span class="sub">${t(lang, "aiGenerated")}</span></h3>
    <div class="scroll"><table class="rec-table">
      <thead><tr><th>${t(lang, "scenario")}</th><th>${t(lang, "pick")}</th><th>${t(lang, "reason")}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </section>`;
}

/** True when at least one candidate in this report has an objective score. */
export function hasObjective(report: Report): boolean {
  return report.scorecards.some((s) => s.objectivePassRate != null);
}

/** Objective-score column label, by step. codegen → tsc, taskbreakdown → coverage. */
export function objectiveLabel(step: string, lang: Lang): string {
  if (step === "codegen") return t(lang, "objTsc");
  if (step === "taskbreakdown") return t(lang, "objCoverage");
  return t(lang, "objGeneric");
}

/** Rank: highest overall win rate first; nulls (no output) sink to the bottom. */
export function ranked(scorecards: Scorecard[]): Scorecard[] {
  return [...scorecards].sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1));
}

/** Champion = highest overall win rate, or null when nothing ranked. */
export function champion(report: Report): Scorecard | null {
  return ranked(report.scorecards)[0] ?? null;
}

/**
 * Ordered dimension keys for the report — the union of keys seen across all
 * scorecards' `dimensionWinRates`, in first-seen order. Empty when no suite
 * dimensions were scored (→ the matrix is omitted).
 */
export function dimensionKeys(report: Report): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const s of report.scorecards) {
    const map = s.dimensionWinRates ?? {};
    for (const key of Object.keys(map)) {
      if (!set.has(key)) {
        set.add(key);
        seen.push(key);
      }
    }
  }
  return seen;
}

/** One candidate's win rate on a dimension, robust to older/absent maps. */
function dimRate(s: Scorecard, dim: string): number | null {
  const map = s.dimensionWinRates ?? {};
  const v = map[dim];
  return typeof v === "number" ? v : null;
}

/** The model name a resolved verdict points at (or "tie"). */
function winnerName(j: Judgement, w: Winner, lang: Lang): string {
  if (w === "a") return j.a;
  if (w === "b") return j.b;
  return t(lang, "tie");
}

/**
 * Heat background for a dimension cell: 50 = neutral, above → green, below →
 * red, alpha scaling with distance from 50. Uses an rgba OVERLAY (not a solid
 * fill) so it reads correctly over both the light and dark cell backgrounds.
 */
function heatStyle(rate: number | null): string {
  if (rate === null) return "";
  const dist = Math.min(1, Math.abs(rate - 50) / 50);
  const alpha = (0.1 + dist * 0.3).toFixed(3);
  const rgb = rate >= 50 ? "34,197,94" : "239,68,68";
  return `background:rgba(${rgb},${alpha})`;
}

/** One candidate's absolute score on a dimension, robust to older/absent maps. */
function dimScoreOf(s: Scorecard, dim: string): number | null {
  const map = s.dimensionScores ?? {};
  const v = map[dim];
  return typeof v === "number" ? v : null;
}

/** A one-line rationale for the champion: its overall-win reason, else a note. */
function championReason(report: Report, champ: Scorecard, lang: Lang): string {
  for (const j of report.judgements) {
    if (j.a === champ.candidate && j.overall.resolved === "a" && j.overall.reason) {
      return j.overall.reason;
    }
    if (j.b === champ.candidate && j.overall.resolved === "b" && j.overall.reason) {
      return j.overall.reason;
    }
  }
  return t(lang, "championReasonFallback");
}

// ── card sections ───────────────────────────────────────────────────────────

/** Step title + 🏆 champion + a one-liner. */
function renderChampionHeader(report: Report, lang: Lang): string {
  const title = escapeHtml(report.step.toUpperCase());
  const champ = champion(report);
  if (!champ || champ.winRate === null) {
    return `<div class="card-head"><h2>${title}</h2>
    <p class="champ-line">${t(lang, "noRankedOutput")}</p></div>`;
  }
  const rec = overallRecord(report, champ.candidate);
  const recLine =
    rec.comparisons > 0
      ? champWinLine(lang, rec.comparisons, rec.wins, fmtRecord(rec))
      : t(lang, "noDuels");
  const scoreLine =
    champ.absoluteScore != null
      ? absScoreSuffix(lang, fmtScore(champ.absoluteScore))
      : "";
  return `<div class="card-head">
    <h2>${title}</h2>
    <p class="champ-line"><span class="trophy">🏆</span> <b>${escapeHtml(champ.candidate)}</b> · ${recLine}${scoreLine}</p>
    <p class="champ-reason">${escapeHtml(championReason(report, champ, lang))}</p>
  </div>`;
}

/** Overall ranking: rank | model | win | [objective] | cost | latency | OK%. */
function renderRankingTable(report: Report, lang: Lang): string {
  const showObj = hasObjective(report);
  const showScore = hasAbsolute(report);
  const bars = ranked(report.scorecards);
  const maxRate = Math.max(1, ...bars.map((s) => s.winRate ?? 0));
  const rows = bars
    .map((s, i) => {
      const rate = s.winRate ?? 0;
      const pct = ((rate / maxRate) * 100).toFixed(0);
      const rec = overallRecord(report, s.candidate);
      const cc = candidateColorClass(report, s.candidate);
      // Primary label is the honest record; the bar (scaled by win rate) stays
      // only as a relative visual, and the win % rides along muted.
      const label = fmtRecord(rec);
      const duels =
        rec.comparisons > 0 ? duelSuffix(lang, rec.comparisons, rate.toFixed(0)) : "";
      // Absolute score as an identity-coloured mini bar — magnitude at a glance.
      const sv = s.absoluteScore;
      const scoreCell = showScore
        ? `\n        <td><span class="mscore"><span class="mtrack"><span class="mfill ${cc}" style="width:${sv != null ? ((sv / 5) * 100).toFixed(0) : "0"}%"></span></span><b>${fmtScore(sv)}</b></span></td>`
        : "";
      const objCell = showObj ? `\n        <td>${passRatePill(s)}</td>` : "";
      const champClass = i === 0 && s.winRate !== null ? ' class="champ"' : "";
      return `<tr${champClass}>
        <td>${i + 1}</td>
        <td><span class="model"><span class="sw ${cc}"></span><span class="m">${escapeHtml(s.candidate)}</span></span></td>
        <td><div class="bar"><span style="width:${pct}%"></span></div><b>${label}</b>${duels}</td>${scoreCell}${objCell}
        <td>$${s.avgCostUsd.toFixed(4)}</td>
        <td>${(s.avgMs / 1000).toFixed(1)}s</td>
        <td>${(s.okRate * 100).toFixed(0)}%</td>
      </tr>`;
    })
    .join("\n");
  const scoreHead = showScore ? `<th>${t(lang, "absScore")} <span class="sub">1–5</span></th>` : "";
  const objHead = showObj ? `<th>${escapeHtml(objectiveLabel(report.step, lang))}</th>` : "";
  return `<h3>${t(lang, "overallRanking")}</h3>
  <div class="scroll"><table>
    <thead><tr><th>#</th><th>${t(lang, "model")}</th><th>${t(lang, "record")} <span class="sub">${t(lang, "wlt")}</span></th>${scoreHead}${objHead}<th>${t(lang, "avgCost")}</th><th>${t(lang, "avgLatency")}</th><th>${t(lang, "okRate")}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/** Dimension score matrix: rows = candidates, cols = dimensions, heat-coded. */
function renderDimensionMatrix(report: Report, lang: Lang): string {
  const dims = dimensionKeys(report);
  if (dims.length === 0) return "";
  const head = dims.map((d) => `<th>${escapeHtml(dimLabel(d, lang))}</th>`).join("");
  const rows = ranked(report.scorecards)
    .map((s) => {
      const cells = dims
        .map((d) => {
          const rate = dimRate(s, d);
          const style = heatStyle(rate);
          const label = rate === null ? "—" : rate.toFixed(0);
          const attr = style ? ` style="${style}"` : "";
          return `<td class="heat"${attr}>${label}</td>`;
        })
        .join("");
      return `<tr><td class="m">${escapeHtml(s.candidate)}</td>${cells}</tr>`;
    })
    .join("\n");
  return `<h3>${t(lang, "dimPref")} <span class="sub">${t(lang, "dimPrefSub")}</span></h3>
  <div class="scroll"><table class="matrix">
    <thead><tr><th>${t(lang, "model")}</th>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/**
 * Grouped bar chart (inline SVG) of per-dimension absolute scores (0–5 scale).
 * The intuitive companion to the relative win-rate heat matrix: one bar per
 * candidate within each dimension group, colours fixed PER CANDIDATE (by suite
 * order, never by rank) so a model keeps its colour across every card + legend.
 * Self-contained SVG — theme-aware via the --s1..--s4, --border and --muted
 * tokens, bar-top value labels for precision, native <title> tooltips (no JS).
 */
function renderScoreBars(report: Report, lang: Lang): string {
  if (!hasAbsolute(report)) return "";
  const dims = dimensionKeys(report);
  if (dims.length === 0) return "";
  const cands = report.candidates;

  // viewBox units; the SVG scales to the card width via width:100%.
  const W = 720;
  const H = 250;
  const PL = 30;
  const PR = 14;
  const PT = 14;
  const PB = 44;
  const plotH = H - PT - PB;
  const y0 = PT + plotH; // value-0 baseline (bars anchor here — never truncated)
  const yOf = (v: number): number => y0 - (v / 5) * plotH;
  const band = (W - PL - PR) / dims.length;
  const innerPad = band * 0.16;
  const GAP = 2; // surface gap between adjacent bars
  const barW = Math.max(4, (band - innerPad * 2 - (cands.length - 1) * GAP) / cands.length);

  let grid = "";
  for (let v = 0; v <= 5; v++) {
    const y = yOf(v);
    grid += `<line class="grid" x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="axlbl" x="${PL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v}</text>`;
  }

  let bars = "";
  let xlabels = "";
  dims.forEach((dim, g) => {
    const gx = PL + g * band + innerPad;
    cands.forEach((cand, ci) => {
      const sc = report.scorecards.find((s) => s.candidate === cand);
      const v = sc ? dimScoreOf(sc, dim) : null;
      if (v === null) return;
      const x = gx + ci * (barW + GAP);
      const y = yOf(v);
      const short = cand.split("/").pop() ?? cand;
      bars +=
        `<rect class="s${ci}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${(y0 - y).toFixed(1)}" rx="2">` +
        `<title>${escapeHtml(short)} · ${escapeHtml(dimLabel(dim, lang))}: ${v.toFixed(1)}/5</title></rect>` +
        `<text class="val" x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle">${v.toFixed(1)}</text>`;
    });
    const cx = PL + g * band + band / 2;
    xlabels += `<text class="axlbl" x="${cx.toFixed(1)}" y="${H - PB + 16}" text-anchor="middle">${escapeHtml(dimLabel(dim, lang))}</text>`;
  });

  const legend = cands
    .map(
      (c, i) =>
        `<span class="lg"><span class="sw s${i}"></span>${escapeHtml(c.split("/").pop() ?? c)}</span>`,
    )
    .join("");

  return `<h3>${t(lang, "dimScoreBars")} <span class="sub">${t(lang, "dimScoreBarsSub")}</span></h3>
  <div class="legend">${legend}</div>
  <div class="scroll"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t(lang, "barsAria")}">
    ${grid}${bars}${xlabels}
  </svg></div>`;
}

/**
 * Radar (spider) chart of each candidate's per-dimension absolute profile. Best
 * for reading a model's SHAPE — strengths and, more usefully here, the notches
 * where it dips. Radar distorts area / exact magnitude, so it's mitigated by:
 * the rating's real [1,5] domain (centre = 1, rim = 5) for visible spread,
 * ring labels, native <title> tooltips, and the precise win-rate matrix below.
 * Falls back to the grouped-bar chart when there are fewer than 3 axes.
 * Colours are fixed per candidate (suite order) — same mapping as everywhere.
 */
function renderScoreRadar(report: Report, lang: Lang): string {
  if (!hasAbsolute(report)) return "";
  const dims = dimensionKeys(report);
  if (dims.length < 3) return renderScoreBars(report, lang);
  const cands = report.candidates;

  const W = 520;
  const H = 400;
  const cx = 260;
  const cy = 198;
  const R = 130;
  const labelR = R + 20;
  const N = dims.length;
  const ang = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / N;
  // Rating domain [1,5] → radius [0,R]: score 1 at centre, 5 at the rim.
  const rad = (v: number): number => ((Math.max(1, Math.min(5, v)) - 1) / 4) * R;
  const px = (i: number, r: number): string => (cx + r * Math.cos(ang(i))).toFixed(1);
  const py = (i: number, r: number): string => (cy + r * Math.sin(ang(i))).toFixed(1);

  let grid = "";
  for (let v = 2; v <= 5; v++) {
    const pts = dims.map((_, i) => `${px(i, rad(v))},${py(i, rad(v))}`).join(" ");
    grid += `<polygon class="radgrid" points="${pts}"/>`;
  }

  let spokes = "";
  dims.forEach((dim, i) => {
    spokes += `<line class="radspoke" x1="${cx}" y1="${cy}" x2="${px(i, R)}" y2="${py(i, R)}"/>`;
    const lx = cx + labelR * Math.cos(ang(i));
    const ly = cy + labelR * Math.sin(ang(i));
    const c = Math.cos(ang(i));
    const anchor = c > 0.3 ? "start" : c < -0.3 ? "end" : "middle";
    spokes += `<text class="axlbl" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(dimLabel(dim, lang))}</text>`;
  });

  // Ring scale labels (2..5) along the top spoke.
  let ringlabels = "";
  for (let v = 2; v <= 5; v++) {
    ringlabels += `<text class="axlbl" x="${(cx + 3).toFixed(1)}" y="${(cy - rad(v) + 3).toFixed(1)}" opacity="0.7">${v}</text>`;
  }

  let polys = "";
  let dots = "";
  const drawn: number[] = [];
  cands.forEach((cand, ci) => {
    const sc = report.scorecards.find((s) => s.candidate === cand);
    const vals = dims.map((d) => (sc ? dimScoreOf(sc, d) : null));
    if (vals.some((v) => v === null)) return; // need a complete profile to plot
    drawn.push(ci);
    const pts = vals.map((v, i) => `${px(i, rad(v as number))},${py(i, rad(v as number))}`).join(" ");
    polys += `<polygon class="rc${ci} radpoly" points="${pts}"/>`;
    const short = cand.split("/").pop() ?? cand;
    vals.forEach((v, i) => {
      dots += `<circle class="rc${ci}" cx="${px(i, rad(v as number))}" cy="${py(i, rad(v as number))}" r="3"><title>${escapeHtml(short)} · ${escapeHtml(dimLabel(dims[i], lang))}: ${(v as number).toFixed(1)}/5</title></circle>`;
    });
  });

  const legend = drawn
    .map(
      (ci) =>
        `<span class="lg"><span class="sw s${ci}"></span>${escapeHtml(cands[ci].split("/").pop() ?? cands[ci])}</span>`,
    )
    .join("");

  return `<h3>${t(lang, "dimProfile")} <span class="sub">${t(lang, "dimProfileSub")}</span></h3>
  <div class="legend">${legend}</div>
  <div class="scroll"><svg class="chart radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t(lang, "radarAria")}">
    ${grid}${spokes}${ringlabels}${polys}${dots}
  </svg></div>`;
}

function reasonRow(
  j: Judgement,
  dimensionLabel: string,
  resolved: Winner,
  reason: string | undefined,
  lang: Lang,
): string {
  return `<tr>
    <td>${escapeHtml(j.inputSlug)}</td>
    <td class="m">${escapeHtml(j.a)}</td>
    <td class="m">${escapeHtml(j.b)}</td>
    <td>${escapeHtml(dimensionLabel)}</td>
    <td>${escapeHtml(winnerName(j, resolved, lang))}</td>
    <td class="reason">${escapeHtml(reason ?? "")}</td>
  </tr>`;
}

/**
 * Collapsed <details>: the overall verdict per duel, plus ONLY the dimensions
 * whose resolved winner DIVERGES from the overall winner.
 *
 * Why filter: the judge writes a one-sentence reason for every dimension in a
 * single pass, and in practice it paraphrases the same overall justification
 * across all of them — so showing every dimension row makes a single relative
 * A/B verdict look like an independent per-capability analysis it is not. The
 * only genuinely informative dimension reasons are the ones where that
 * dimension disagrees with the overall call (a real trade-off, e.g. B wins
 * overall yet loses on "no-hallucination"). Agreeing dimensions are dropped.
 */
function renderReasons(report: Report, lang: Lang): string {
  if (report.judgements.length === 0) return "";
  const rows: string[] = [];
  let divergences = 0;
  for (const j of report.judgements) {
    rows.push(reasonRow(j, t(lang, "overallRow"), j.overall.resolved, j.overall.reason, lang));
    for (const [dim, v] of Object.entries(j.dimensions)) {
      if (v.resolved === j.overall.resolved) continue; // agrees with overall → not informative
      rows.push(reasonRow(j, `${dimLabel(dim, lang)} ⚠`, v.resolved, v.reason, lang));
      divergences++;
    }
  }
  const n = report.judgements.length;
  return `<details>
    <summary>${reasonsSummary(lang, divergences, n)}</summary>
    <p class="rz-note">${t(lang, "reasonsDisclaimer")}</p>
    <div class="scroll"><table>
      <thead><tr><th>${t(lang, "input")}</th><th>A</th><th>B</th><th>${t(lang, "dimension")}</th><th>${t(lang, "winner")}</th><th>${t(lang, "reason")}</th></tr></thead>
      <tbody>${rows.join("\n")}</tbody>
    </table></div>
  </details>`;
}

/**
 * Objective detail block for steps that carry per-run check output (codegen →
 * tsc output; taskbreakdown → coverage summary). One row per (candidate, input)
 * using the first OK run that recorded a checkOutput. Empty when no such
 * records are supplied (e.g. the single-suite HTML report passes none).
 */
function renderObjectiveDetail(
  report: Report,
  records: RunRecordLite[] | undefined,
  lang: Lang,
): string {
  if (!records || records.length === 0) return "";
  const rows: string[] = [];
  for (const candidate of report.candidates) {
    for (const inputSlug of report.inputs) {
      const hit = records.find(
        (r) =>
          r.candidate === candidate &&
          r.inputSlug === inputSlug &&
          r.status === "ok" &&
          r.checkOutput != null,
      );
      if (!hit || hit.checkOutput == null) continue;
      const mark =
        hit.checkPassed === undefined
          ? ""
          : hit.checkPassed
            ? '<span class="check-pass">✓</span>'
            : '<span class="check-fail">✗</span>';
      rows.push(`<tr>
        <td class="m">${escapeHtml(candidate)}</td>
        <td>${escapeHtml(inputSlug)}</td>
        <td>${mark}</td>
        <td class="reason">${escapeHtml(hit.checkOutput)}</td>
      </tr>`);
    }
  }
  if (rows.length === 0) return "";
  return `<details>
    <summary>${t(lang, "objDetail")} — ${escapeHtml(objectiveLabel(report.step, lang))}</summary>
    <div class="scroll"><table>
      <thead><tr><th>${t(lang, "model")}</th><th>${t(lang, "input")}</th><th>${t(lang, "check")}</th><th>${t(lang, "result")}</th></tr></thead>
      <tbody>${rows.join("\n")}</tbody>
    </table></div>
  </details>`;
}

/**
 * One self-contained step card: champion header, overall ranking, dimension
 * matrix, collapsible per-dimension reasoning, and (when records are supplied)
 * an objective-detail block. Pure — same inputs always yield the same HTML.
 */
export function renderStepCard(
  report: Report,
  lang: Lang,
  records?: RunRecordLite[],
): string {
  return `<section class="card">
    ${renderChampionHeader(report, lang)}
    ${renderRankingTable(report, lang)}
    ${renderScoreRadar(report, lang)}
    ${renderDimensionMatrix(report, lang)}
    ${renderReasons(report, lang)}
    ${renderObjectiveDetail(report, records, lang)}
  </section>`;
}

/**
 * Shared stylesheet — inline, theme-aware, wide tables scroll inside `.scroll`.
 * Built on semantic CSS custom properties: the dark theme only re-defines the
 * tokens, so every rule adapts automatically. Class names are unchanged from the
 * plain version — this is a pure visual refresh.
 */
export const SHARED_STYLE = `<style>
  :root{
    --grad1:#eef1f6;--grad2:#f7f8fb;
    --surface:#ffffff;--surface-2:#f6f7fa;
    --text:#0f172a;--muted:#667085;--border:#e6e8ec;
    --accent:#4f46e5;--accent-2:#7c73f0;--accent-soft:rgba(79,70,229,.08);
    --champ:#eef2ff;--pass:#16a34a;--fail:#dc2626;--warn:#b45309;
    --note-bg:#fff8ef;--note-bd:#fcd9a8;--note-edge:#f59e0b;--note-tx:#7c4a12;--note-code:rgba(120,70,10,.1);
    --shadow:0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.06);
    --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;
  }
  *{box-sizing:border-box}
  body{font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    max-width:1080px;margin:0 auto;padding:48px 24px 80px;color:var(--text);
    background:linear-gradient(180deg,var(--grad1),var(--grad2) 340px) no-repeat,var(--grad2);
    -webkit-font-smoothing:antialiased;min-height:100vh}
  h1{font-size:30px;font-weight:800;letter-spacing:-.022em;margin:0 0 6px;text-wrap:balance}
  .eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:700;margin:0 0 8px}
  .lede{color:var(--muted);font-size:14px;margin:2px 0 0;max-width:66ch;line-height:1.6}
  .meta{color:var(--muted);font-size:13px;margin:14px 0 8px}
  .verdict{margin:22px 0 6px;background:var(--surface);border:1px solid var(--border);
    border-left:4px solid var(--accent);border-radius:14px;padding:16px 20px;box-shadow:var(--shadow)}
  .verdict .vlabel{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:0 0 7px}
  .verdict .vbig{font-size:16px;font-weight:700;margin:0;line-height:1.5}
  .verdict .vsub{margin:7px 0 0;color:var(--muted);font-size:13px}
  .verdict .vbig b,.verdict .vsub b{color:var(--accent)}
  .scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:10px}
  table{border-collapse:collapse;width:100%;margin:10px 0 2px;font-size:13px}
  th,td{text-align:left;padding:9px 13px;border-bottom:1px solid var(--border);white-space:nowrap;vertical-align:top}
  thead th{position:sticky;top:0;background:var(--surface-2);font-size:10.5px;text-transform:uppercase;
    color:var(--muted);letter-spacing:.06em;font-weight:600}
  tbody tr{transition:background .12s ease}
  tbody tr:hover{background:var(--accent-soft)}
  td.m{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
  td.reason{white-space:normal;min-width:240px;max-width:520px;color:var(--muted)}
  .card{position:relative;overflow:hidden;border:1px solid var(--border);border-radius:16px;
    padding:20px 24px 22px;margin:22px 0;background:var(--surface);box-shadow:var(--shadow)}
  .card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;
    background:linear-gradient(90deg,var(--accent),var(--accent-2))}
  .card-head{margin:4px 0 6px}
  .card-head h2{font-size:15px;margin:0 0 8px;font-weight:700;text-transform:uppercase;
    letter-spacing:.05em;color:var(--accent);border:0;padding:0}
  h2{font-size:18px;font-weight:700;letter-spacing:-.01em;margin:26px 0 4px}
  .champ-line{margin:0;font-size:15px;font-weight:600}
  .champ-line b{font-weight:700}
  .champ-reason{margin:4px 0 0;color:var(--muted);font-size:13px;line-height:1.5}
  .trophy{font-size:16px;margin-right:2px}
  h3{font-size:10.5px;text-transform:uppercase;color:var(--muted);letter-spacing:.06em;
    font-weight:600;margin:22px 0 2px;padding-top:14px;border-top:1px solid var(--border)}
  .card h3:first-of-type{border-top:0;padding-top:4px}
  .bar{display:inline-block;width:120px;height:9px;background:var(--surface-2);border-radius:99px;
    vertical-align:middle;margin-right:9px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--border)}
  .bar span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--accent-2))}
  b{font-variant-numeric:tabular-nums}
  tr.champ,tr.champ:hover{background:var(--champ);box-shadow:inset 3px 0 0 var(--accent)}
  table.matrix td.heat{text-align:center;font-variant-numeric:tabular-nums;font-weight:600}
  .check-pass{color:var(--pass);font-weight:700}
  .check-fail{color:var(--fail);font-weight:700}
  details{margin:14px 0 2px}
  summary{cursor:pointer;color:var(--accent);font-size:12.5px;font-weight:600;display:inline-block;
    padding:5px 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);
    user-select:none;transition:background .12s}
  summary:hover{background:var(--accent-soft)}
  details[open] summary{margin-bottom:8px}
  .rz-note{margin:2px 0 10px;font-size:12px;line-height:1.6;color:var(--muted);
    background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:9px 12px}
  .rz-note b{color:var(--text)}
  .total{margin-top:34px;font-size:13px;font-weight:600;color:var(--muted);display:inline-block;
    padding:8px 14px;border:1px solid var(--border);border-radius:99px;background:var(--surface)}
  .sub{color:var(--muted);font-size:11px;font-weight:400}
  .note{background:var(--note-bg);border:1px solid var(--note-bd);border-left:3px solid var(--note-edge);
    border-radius:10px;padding:12px 16px;margin:18px 0;font-size:13px;color:var(--note-tx);line-height:1.6}
  .note b{color:inherit}
  .note code{background:var(--note-code);padding:1px 5px;border-radius:4px;font-size:12px;font-family:ui-monospace,monospace}
  .legend{display:flex;flex-wrap:wrap;gap:16px;margin:6px 0 2px;font-size:12px;color:var(--muted)}
  .legend .lg{display:inline-flex;align-items:center;gap:6px}
  .sw{width:11px;height:11px;border-radius:3px;display:inline-block}
  .chart{width:100%;height:auto;display:block;margin:4px 0 2px}
  .chart .grid{stroke:var(--border);stroke-width:1}
  .chart .axlbl{fill:var(--muted);font-size:10px}
  .chart .val{fill:var(--text);font-size:9px;font-weight:600}
  .chart rect{transition:opacity .12s}
  .chart rect:hover{opacity:.82}
  .s0{fill:var(--s1);background:var(--s1)}
  .s1{fill:var(--s2);background:var(--s2)}
  .s2{fill:var(--s3);background:var(--s3)}
  .s3{fill:var(--s4);background:var(--s4)}
  .radar{max-width:560px;margin:4px auto 2px}
  .radgrid,.radspoke{fill:none;stroke:var(--border);stroke-width:1}
  .radpoly{fill-opacity:.14;stroke-width:2;stroke-linejoin:round}
  .rc0{fill:var(--s1);stroke:var(--s1)}
  .rc1{fill:var(--s2);stroke:var(--s2)}
  .rc2{fill:var(--s3);stroke:var(--s3)}
  .rc3{fill:var(--s4);stroke:var(--s4)}
  .model{display:inline-flex;align-items:center;gap:8px}
  .mscore{display:inline-flex;align-items:center;gap:9px;justify-content:flex-end}
  .mtrack{width:66px;height:7px;border-radius:99px;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--border);overflow:hidden;flex:0 0 auto}
  .mfill{height:100%;display:block;border-radius:99px}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-weight:700;font-size:12px}
  .pill.good{background:rgba(22,163,74,.14);color:var(--pass)}
  .pill.warn{background:rgba(180,83,9,.16);color:var(--warn)}
  .pill.muted{background:var(--surface-2);color:var(--muted)}
  .rec-table th,.rec-table td{white-space:normal;text-align:left;vertical-align:top}
  .rec-table td.pick{color:var(--accent);font-weight:700;white-space:nowrap}
  .langbtn{position:fixed;top:16px;right:16px;z-index:10;cursor:pointer;
    font:600 12.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    padding:8px 14px;border:1px solid var(--border);border-radius:999px;
    background:var(--surface);color:var(--accent);box-shadow:var(--shadow);
    -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
  .langbtn:hover{background:var(--accent-soft)}
  .doc[hidden]{display:none}
  @media(prefers-color-scheme:dark){
    :root{
      --grad1:#0d1219;--grad2:#0a0d13;
      --surface:#141922;--surface-2:#1a212c;
      --text:#e7eaef;--muted:#93a0b4;--border:#262e3b;
      --accent:#818cf8;--accent-2:#a78bfa;--accent-soft:rgba(129,140,248,.12);
      --champ:#1a2340;--pass:#4ade80;--fail:#f87171;--warn:#fbbf24;
      --note-bg:#241a0e;--note-bd:#4a3618;--note-edge:#d97706;--note-tx:#fcd9a8;--note-code:rgba(255,255,255,.08);
      --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
      --s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;
    }
  }
</style>`;
