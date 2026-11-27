/**
 * The check's headline numbers and parts as pictures — the same geometry
 * report.html draws (report-headline-charts.ts), from the same model.
 *
 * Interval chart: a panel per headline on its own axis, a row per candidate:
 * a dot at the value, a line over its 95% interval. Part strip: a row per
 * candidate, a cell per part, tinted by how often it passed, the count in
 * the cell. Candidates are named on their rows, so colour is never alone.
 */

import { headlineScale, type HeadlineEntry, type HeadlineValue } from "../../../../../canon/headline.js";
import type { PartBoard, PartRow } from "../../../../../canon/parts.js";

const SERIES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];
const TINT_MAX_PCT = 85;
const LIGHT_TEXT_FROM = 0.5;

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const num = (v: number): string => v.toFixed(2);
const at = (v: number, max: number): number => Math.min(1, Math.max(0, max === 0 ? 0 : v / max)) * 100;

const valueText = (v: HeadlineValue): string => (v.kind === "share" ? `${v.numerator}/${v.denominator} · ${pct(v.value)}` : num(v.value));

function hoverText(candidate: string, v: HeadlineValue): string {
  const fmt = v.kind === "share" ? pct : num;
  const ci = v.low === null || v.high === null ? "" : `, 95% ${fmt(v.low)}–${fmt(v.high)}`;
  return `${candidate}: ${valueText(v)}${ci}, n ${v.inputs}`;
}

const ROW = "grid h-6 grid-cols-[8.5em_1fr_8em] items-center gap-2.5 text-xs";

function Panel({ entry, candidates }: { entry: HeadlineEntry; candidates: string[] }) {
  const scale = headlineScale(entry);
  const grid = scale.ticks.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-border" style={{ left: `${at(t, scale.max)}%` }} />);
  return (
    <div>
      <h4 className="mb-1.5 text-[12.5px] font-semibold">{entry.decl.label}</h4>
      {candidates.map((c, i) => {
        const v = entry.all[c];
        const color = SERIES[i % SERIES.length];
        return (
          <div key={c} className={ROW} title={v ? hoverText(c, v) : undefined}>
            <span className="truncate font-mono text-muted-foreground">{c}</span>
            <span className="relative h-6">
              {grid}
              {v && v.low !== null && v.high !== null && (
                <span className="absolute top-[11px] h-0.5 rounded-sm" style={{ left: `${at(v.low, scale.max)}%`, width: `${at(v.high, scale.max) - at(v.low, scale.max)}%`, background: color }} />
              )}
              {v && <span className="absolute top-1.5 -ml-1.5 size-3 rounded-full ring-2 ring-card" style={{ left: `${at(v.value, scale.max)}%`, background: color }} />}
            </span>
            <span className="whitespace-nowrap font-mono tabular-nums">{v ? valueText(v) : "—"}</span>
          </div>
        );
      })}
      <div className={`${ROW} h-4`}>
        <span />
        <span className="relative h-4">
          {scale.ticks.map((t) => (
            <span key={t} className="absolute top-0.5 -translate-x-1/2 text-[10.5px] tabular-nums text-muted-foreground" style={{ left: `${at(t, scale.max)}%` }}>{scale.format(t)}</span>
          ))}
        </span>
        <span />
      </div>
    </div>
  );
}

export function IntervalChart({ headline, candidates }: { headline: HeadlineEntry[]; candidates: string[] }) {
  if (headline.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(420px,1fr))] gap-x-11 gap-y-4">
      {headline.map((h) => <Panel key={h.decl.label} entry={h} candidates={candidates} />)}
    </div>
  );
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

const CELL = "grid h-6 w-[26px] flex-none place-items-center rounded font-mono text-[11px] tabular-nums";

function Cell({ candidate, row }: { candidate: string; row: PartRow }) {
  const c = row.cells[candidate] ?? { pass: 0, graded: 0 };
  const what = `${candidate} · ${row.input} ${row.label ?? row.id}`;
  if (c.graded === 0) return <span className={`${CELL} text-muted-foreground`} title={`${what}: not graded`}>—</span>;
  const title = `${what}: ${c.pass}/${c.graded}`;
  if (c.pass === 0) return <span className={`${CELL} bg-muted/40 text-muted-foreground ring-1 ring-inset ring-border`} title={title}>0</span>;
  const rate = c.pass / c.graded;
  return (
    <span className={`${CELL} ${rate >= LIGHT_TEXT_FROM ? "text-white" : ""}`} style={{ background: `color-mix(in srgb, var(--viz-1) ${Math.round(rate * TINT_MAX_PCT)}%, var(--card))` }} title={title}>
      {c.pass}
    </span>
  );
}

export function PartStrip({ parts, candidates }: { parts: PartBoard; candidates: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-3 overflow-x-auto">
      {blocks(parts).map((b) => (
        <div key={b.title ?? "all"}>
          {b.title && <div className="mb-1 ml-[7.5em] text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{b.title} <span className="font-normal">{b.rows.length}</span></div>}
          <div className="mb-0.5 flex items-center gap-0.5">
            <span className="w-[7.5em] flex-none" />
            {b.rows.map((r) => (
              <span key={`${r.input}-${r.id}`} className="h-[52px] w-[26px] flex-none rotate-180 overflow-hidden whitespace-nowrap font-mono text-[10px] leading-[26px] text-muted-foreground [writing-mode:vertical-rl]" title={`${r.input} ${r.label ?? r.id}`}>{r.input}</span>
            ))}
          </div>
          {candidates.map((c) => (
            <div key={c} className="mb-0.5 flex items-center gap-0.5">
              <span className="w-[7.5em] flex-none truncate font-mono text-xs text-muted-foreground">{c}</span>
              {b.rows.map((r) => <Cell key={`${r.input}-${r.id}`} candidate={c} row={r} />)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
