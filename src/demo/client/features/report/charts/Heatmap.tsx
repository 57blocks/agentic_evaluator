/**
 * Precise per-dimension magnitude, values printed in every cell. A column
 * where every candidate got the same score is flagged: that is the scorer
 * failing to tell them apart, not the candidates being equal.
 */

import type { CandidateProfile } from "../../../../../report-charts.js";
import { SCORE_MAX, SCORE_MIN } from "../../../../../report-format.js";
import { Badge } from "@/components/ui/badge";
import { TICKS, tintStyle } from "./geometry";

interface Props {
  dims: string[];
  profiles: CandidateProfile[];
  saturated: string[];
}

export function Heatmap({ dims, profiles, saturated }: Props) {
  if (dims.length === 0 || profiles.length === 0) return null;
  const flat = new Set(saturated);

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm font-medium">
        Absolute score (1-5) <span className="text-xs font-normal text-muted-foreground">greener above 3, redder below 3</span>
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-sm">
          <thead>
            <tr>
              <th className="px-2 text-left text-xs font-medium text-muted-foreground">Candidate</th>
              {dims.map((d) => (
                <th key={d} className="px-2 text-right text-xs font-medium whitespace-nowrap text-muted-foreground" title={flat.has(d) ? "Every candidate scored the same" : undefined}>
                  {d} {flat.has(d) && <Badge variant="outline" className="ml-1 text-[10px]">No spread</Badge>}
                </th>
              ))}
              <th className="px-2 text-right text-xs font-medium text-muted-foreground">Total</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.candidate}>
                <th className="px-2 text-left font-mono text-xs font-normal whitespace-nowrap">{p.candidate}</th>
                {dims.map((d) => {
                  const v = p.scores[d];
                  if (v === null) {
                    return <td key={d} className="bg-muted px-2 py-2 text-center text-muted-foreground" title={`${d}: not scored`}>—</td>;
                  }
                  return (
                    <td key={d} className="px-2 py-2 text-center font-mono tabular-nums" style={tintStyle(v, SCORE_MIN, SCORE_MAX)} title={`${p.candidate} · ${d}: ${v.toFixed(1)}/5`}>
                      {v.toFixed(1)}
                    </td>
                  );
                })}
                <td className="px-2 text-right font-mono">{p.overall === null ? "—" : p.overall.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
        <span className="mr-1">1</span>
        {TICKS.map((v) => <span key={v} className="inline-block h-2 w-6" style={tintStyle(v, SCORE_MIN, SCORE_MAX)} />)}
        <span className="ml-1">5</span>
      </div>
      {flat.size > 0 && (
        <p className="text-xs text-muted-foreground">
          On dimensions marked "No spread", every candidate scored the same: the scorer did not tell them apart, which does not mean they are equally good.
        </p>
      )}
    </figure>
  );
}
