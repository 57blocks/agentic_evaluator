/**
 * Candidates × steps. Each cell is that candidate's pairwise win rate on that
 * step (tinted: stronger green above 50, red below) with its mean absolute
 * score underneath. ⬢ marks the judge's favourite on the step; 推荐 marks the
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
        {fav && <span title="该步裁判最偏好">⬢</span>}
      </div>
      <div className="font-mono text-[11px] text-muted-foreground">{fmtScore(row.absolute)}</div>
      {row.chosen && <Badge className="mt-1">推荐</Badge>}
    </td>
  );
}

export function Overview({ steps, candidates }: { steps: WorkflowStep[]; candidates: CandidateMeta[] }) {
  return (
    <Section title="全局总览" hint={`${candidates.length} 个候选 × ${steps.length} 个步骤`}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">候选</th>
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
        大字是成对胜率（平局算半场），小字是绝对分 /5。胜率只说明谁更受裁判偏好，样本少时波动大；
        绝对分才看质量差多少。⬢ 是该步裁判最偏好的候选，「推荐」是选择器按门槛和运行模式选出的。
      </Note>
    </Section>
  );
}
