/**
 * The judge's 1–5 scores as a distribution: one bar per candidate, the share
 * of its trials at each score, red (1) to blue (5), with the mean and the
 * required check on the same row. Same data and palette as the offline
 * report's `renderScoreDistribution`.
 */

import type { CheckTally, ScoreBlock, ScoreRow } from "../../../../../report-charts.js";
import { Badge } from "@/components/ui/badge";

/** Validated in light and dark against the page surfaces (see report-charts.ts). */
const STEP_CLASS = [
  "bg-[#c93a39] text-white dark:bg-[#f29a97] dark:text-[#1F2329]",
  "bg-[#f0a3a0] text-[#2B3038] dark:bg-[#a13b39] dark:text-white",
  "bg-[#e2e1dd] text-[#2B3038] dark:bg-[#93938d] dark:text-[#1F2329]",
  "bg-[#8dbbf1] text-[#2B3038] dark:bg-[#3470c4] dark:text-white",
  "bg-[#1c5cab] text-white dark:bg-[#a8cdf5] dark:text-[#1F2329]",
] as const;
const UNSCORED_CLASS = "bg-[repeating-linear-gradient(45deg,var(--card),var(--card)_3px,var(--border)_3px,var(--border)_5px)] text-muted-foreground";
const LABEL_MIN_SHARE = 0.12;
const GRID = "grid grid-cols-[minmax(90px,160px)_1fr_44px_96px] items-center gap-2.5";

interface Props {
  blocks: ScoreBlock[];
  checks: Map<string, CheckTally>;
}

const pct = (part: number, whole: number): string => `${Math.round((part / whole) * 100)}%`;

function Segment({ className, count, n, title }: { className: string; count: number; n: number; title: string }) {
  if (count === 0) return null;
  const share = count / n;
  return (
    <span
      className={`min-w-0.5 basis-0 overflow-hidden text-center text-[10px] leading-5 whitespace-nowrap first:rounded-l last:rounded-r ${className}`}
      style={{ flexGrow: share }}
      title={title}
    >
      {share >= LABEL_MIN_SHARE ? pct(count, n) : ""}
    </span>
  );
}

function Row({ dim, row, check }: { dim: string; row: ScoreRow; check: CheckTally | undefined }) {
  return (
    <div className={`${GRID} text-xs`}>
      <span className="truncate font-mono text-[11px]">{row.candidate}</span>
      <span className="flex h-5 min-w-0 gap-0.5">
        {row.counts.map((count, i) => (
          <Segment key={i} className={STEP_CLASS[i]} count={count} n={row.n} title={`${row.candidate} · ${dim} = ${i + 1}: ${count} of ${row.n} trials (${pct(count, row.n)})`} />
        ))}
        <Segment className={UNSCORED_CLASS} count={row.unscored} n={row.n} title={`${row.candidate} · not scored: ${row.unscored} of ${row.n} trials (${pct(row.unscored, row.n)})`} />
      </span>
      <span className="text-right font-mono tabular-nums">{row.mean === null ? "—" : row.mean.toFixed(1)}</span>
      <span className="text-right font-mono tabular-nums">
        {check && check.executed > 0 ? (
          <>
            {check.pass} / {check.executed} <span className="text-muted-foreground">{pct(check.pass, check.executed)}</span>
          </>
        ) : (
          "—"
        )}
      </span>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3.5 text-xs text-muted-foreground">
      {STEP_CLASS.map((cls, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className={`inline-block size-3 rounded-sm ${cls}`} />
          {i + 1}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className={`inline-block size-3 rounded-sm border border-muted-foreground ${UNSCORED_CLASS}`} />
        not scored
      </span>
    </div>
  );
}

function CountsTable({ blocks }: { blocks: ScoreBlock[] }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Exact counts</summary>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="px-2 text-left font-medium">Candidate</th>
              <th className="px-2 text-left font-medium">Dimension</th>
              {[1, 2, 3, 4, 5].map((s) => <th key={s} className="px-2 text-right font-medium">{s}</th>)}
              <th className="px-2 text-right font-medium">Not scored</th>
              <th className="px-2 text-right font-medium">Mean</th>
            </tr>
          </thead>
          <tbody>
            {blocks.flatMap((b) =>
              b.rows.map((r) => (
                <tr key={`${b.dim}-${r.candidate}`}>
                  <td className="px-2 font-mono">{r.candidate}</td>
                  <td className="px-2">{b.dim}</td>
                  {r.counts.map((c, i) => <td key={i} className="px-2 text-right tabular-nums">{c}</td>)}
                  <td className="px-2 text-right tabular-nums">{r.unscored}</td>
                  <td className="px-2 text-right tabular-nums">{r.mean === null ? "—" : r.mean.toFixed(2)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function Distribution({ blocks, checks }: Props) {
  if (blocks.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Legend />
      {blocks.map((b) => (
        <figure key={b.dim} className="flex min-w-0 flex-col gap-1">
          <figcaption className="mb-1 flex flex-wrap items-baseline gap-2 text-sm font-medium">
            {b.dim}
            <span className="text-xs font-normal text-muted-foreground">share of each candidate's trials at each score</span>
            {b.saturated && <Badge variant="outline" className="text-[10px]">No spread</Badge>}
          </figcaption>
          <div className={`${GRID} text-[11px] text-muted-foreground`}>
            <span />
            <span>1 (red) → 5 (blue)</span>
            <span className="text-right">mean</span>
            <span className="text-right">required check ↓</span>
          </div>
          {b.rows.map((r) => <Row key={r.candidate} dim={b.dim} row={r} check={checks.get(r.candidate)} />)}
          {b.saturated && (
            <p className="text-xs text-muted-foreground">Every candidate got the same scores here: the judge did not tell them apart, which is not the same as them being equal.</p>
          )}
        </figure>
      ))}
      <CountsTable blocks={blocks} />
    </div>
  );
}
