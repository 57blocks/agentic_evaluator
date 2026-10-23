/**
 * Candidates × steps. Every cell says how often the candidate succeeded on the
 * step and what a success cost. On a step a judge compared, the pairwise win
 * rate leads (tinted: blue above 50, red below); on a step with no judge, the
 * success rate does — a dash there would hide that the step was decided on
 * its checks. ⬢ marks the judge's favourite; "Recommended" the selector's
 * choice — not the same thing, and the grid shows both.
 */

import type { CandidateMeta, WorkflowStep } from "../../../../../workflow-report-model.js";
import { fmtPct, fmtUsd } from "../../../../../report-format.js";
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
  const judged = r.candidates.some((c) => c.winRate !== null);
  const fav = r.verdict.judge?.sole === true && r.verdict.judge.candidate === candidate;
  const tries = row.outcomes.success + row.outcomes.failure + row.outcomes.undetermined;
  const successPct = tries > 0 ? (row.outcomes.success / tries) * 100 : null;
  const success = `${row.outcomes.success}/${tries}`;
  const cost = row.costPerSuccess != null ? `${fmtUsd(row.costPerSuccess).replace(/(\.\d\d)\d+$/, "$1")}/success` : row.costObserved ? "no success" : "cost unobserved";
  return (
    <td className="border border-border px-3 py-2 text-center" style={tintStyle(judged ? row.winRate : successPct, 0, 100)}>
      <div className="flex items-center justify-center gap-1 font-mono text-sm font-semibold">
        {judged ? fmtPct(row.winRate) : success}
        {fav && <span title="The judge's favourite on this step">⬢</span>}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">
        {judged ? `${success} passed · ${cost}` : cost}
      </div>
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
        On a step a judge compared, the large number is the pairwise win rate (a tie counts as half), which only shows who the judge prefers and swings widely on small samples;
        on a step with no judge, it is the success count. Underneath: successes and the generation cost per success. ⬢ is the judge's favourite on the step; "Recommended"
        is what the selector chose by eligibility gates and operating mode, the judge breaking a tie on assurance.
      </Note>
    </Section>
  );
}
