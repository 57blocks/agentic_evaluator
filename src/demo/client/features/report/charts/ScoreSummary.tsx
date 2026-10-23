/**
 * Every candidate's mean on every dimension in one table, tinted red below 3
 * and blue above, values always printed. Rows in the same order as the score
 * bars; the required check closes each row. Same data as the offline report's
 * `renderScoreSummary`.
 */

import type { CheckTally, ScoreBlock, SummaryRow } from "../../../../../report-charts.js";
import { SCORE_MAX, SCORE_MIN } from "../../../../../report-format.js";
import { Badge } from "@/components/ui/badge";
import { tintStyle } from "./geometry";

interface Props {
  blocks: ScoreBlock[];
  rows: SummaryRow[];
  checks: Map<string, CheckTally>;
}

const STEPS = [1, 2, 3, 4, 5] as const;
const fmt = (v: number | null): string => (v === null ? "—" : v.toFixed(1));

function CheckCell({ check }: { check: CheckTally | undefined }) {
  if (!check || check.executed === 0) return <>—</>;
  return (
    <>
      {check.pass} / {check.executed} <span className="text-muted-foreground">{Math.round((check.pass / check.executed) * 100)}%</span>
    </>
  );
}

export function ScoreSummary({ blocks, rows, checks }: Props) {
  if (blocks.length === 0 || rows.length === 0) return null;
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm font-medium">
        Mean score per dimension <span className="text-xs font-normal text-muted-foreground">above 3 leans blue, below 3 leans red, stronger the further away</span>
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-sm">
          <thead>
            <tr>
              <th className="px-2 text-left text-xs font-medium text-muted-foreground">Candidate</th>
              {blocks.map((b) => (
                <th key={b.dim} className="px-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground">
                  {b.dim} {b.saturated && <Badge variant="outline" className="ml-1 text-[10px]">No spread</Badge>}
                </th>
              ))}
              <th className="px-2 text-right text-xs font-medium text-muted-foreground">Overall</th>
              <th className="px-2 text-right text-xs font-medium text-muted-foreground">Required check ↓</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.candidate}>
                <th className="px-2 text-left font-mono text-xs font-normal whitespace-nowrap">{r.candidate}</th>
                {r.means.map((v, i) =>
                  v === null ? (
                    <td key={blocks[i].dim} className="bg-muted px-2 py-2 text-center text-muted-foreground" title={`${blocks[i].dim}: not scored`}>—</td>
                  ) : (
                    <td key={blocks[i].dim} className="px-2 py-2 text-center font-mono tabular-nums" style={tintStyle(v, SCORE_MIN, SCORE_MAX)} title={`${r.candidate} · ${blocks[i].dim}: ${v.toFixed(1)}/5`}>
                      {v.toFixed(1)}
                    </td>
                  ),
                )}
                <td className="px-2 py-2 text-center font-mono tabular-nums" style={tintStyle(r.overall, SCORE_MIN, SCORE_MAX)}>{fmt(r.overall)}</td>
                <td className="px-2 text-right font-mono tabular-nums whitespace-nowrap"><CheckCell check={checks.get(r.candidate)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
        <span className="mr-1">1</span>
        {STEPS.map((v) => <span key={v} className="inline-block h-2 w-6" style={tintStyle(v, SCORE_MIN, SCORE_MAX)} />)}
        <span className="ml-1">5</span>
      </div>
    </figure>
  );
}
