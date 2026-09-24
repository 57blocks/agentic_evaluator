/**
 * Candidates × steps. Each cell is that candidate's pairwise win rate on that
 * step (tinted: stronger green above 50, red below) with its mean absolute
 * score underneath. ⬢ marks the judge's favourite on the step; "Recommended" marks the
 * selector's choice — the two are not the same thing and the grid shows both.
 */

import type { CandidateMeta, WorkflowStep } from "../../../../../workflow-report-model.js";
import { fmtPct, fmtScore } from "../../../../../report-format.js";
import { Badge } from "@/components/ui/badge";
import { seriesColor } from "../tone";
import { tintStyle } from "../charts/geometry";
import { Note, Section } from "../Section";

export function Swatch({ slot }: { slot: number }) {
  return <span aria-hidden className="inline-block size-2.5 shrink-0" style={{ background: seriesColor(slot) }} />;
}

function Cell({ step, candidate }: { step: WorkflowStep; candidate: string }) {
  const r = step.report;
  const row = r?.candidates.find((c) => c.id === candidate);
  if (!r || !row) return <td className="border border-border px-3 py-2 text-center text-muted-foreground">—</td>;
  const fav = r.verdict.judge?.sole === true && r.verdict.judge.candidate === candidate;
  return (
    <td className="border border-border px-3 py-2 text-center" style={tintStyle(row.winRate, 0, 100)}>
      <div className="flex items-center justify-center gap-1 font-mono text-sm font-semibold">
        {fmtPct(row.winRate)}
        {fav && <span title="The judge's favourite on this step">⬢</span>}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">{fmtScore(row.absolute)}</div>
      {row.chosen && <Badge className="mt-1">Recommended</Badge>}
    </td>
  );
}

export function Overview({ steps, candidates }: { steps: WorkflowStep[]; candidates: CandidateMeta[] }) {
  return (
    <Section title="Overview" hint={`${candidates.length} candidates × ${steps.length} steps`}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Candidate</th>
              {steps.map((s, i) => (
                <th key={s.id} className="px-3 py-2 text-center font-medium text-muted-foreground">
                  {i + 1} · {s.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <tr key={c.id}>
                <th className="border-y border-border px-3 py-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <Swatch slot={c.colorIndex} />
                    <span className="font-mono font-medium">{c.id}</span>
                  </span>
                </th>
                {steps.map((s) => <Cell key={s.id} step={s} candidate={c.id} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>
        The large number is the pairwise win rate (a tie counts as half); the small one is the absolute score out of 5. Win rate only shows who the judge prefers and swings widely on small samples;
         the absolute score shows how far apart the quality is. ⬢ is the judge's favourite on the step; "Recommended" is what the selector chose by eligibility gates and operating mode.
      </Note>
    </Section>
  );
}
