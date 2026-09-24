/**
 * Every candidate on the same inputs, side by side. Candidates that failed a
 * gate stay in the table, dimmed and marked, rather than dropped — a
 * recommendation only means something against the field it was chosen from.
 */

import type { CandidateRow, StepReport } from "../../../../../report-model.js";
import { fmtPct, fmtScore, fmtSec, fmtUsd } from "../../../../../report-format.js";
import { completionLabel } from "../../../../../report-copy.js";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { seriesColor } from "../tone";
import { Note, Section, Tag } from "../Section";

function Name({ c }: { c: CandidateRow }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span aria-hidden className="inline-block size-2.5" style={{ background: seriesColor(c.colorIndex) }} />
        <span className="font-mono font-medium">{c.id}</span>
        {c.chosen && <Tag tone="brand">推荐</Tag>}
        {c.gated && <Tag tone="bad">未通过门槛</Tag>}
        {c.isControl && <Tag tone="neutral">对照</Tag>}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{c.model} · {c.deployment}</span>
    </div>
  );
}

/** Success out of attempts, with anything abnormal said in words underneath. */
function Success({ c }: { c: CandidateRow }) {
  const tried = c.outcomes.success + c.outcomes.failure + c.outcomes.undetermined;
  const abnormal = c.states.filter(([state]) => state !== "success");
  const allSucceeded = tried > 0 && c.outcomes.success === tried;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("font-mono font-semibold", allSucceeded ? "text-ok" : c.outcomes.success === 0 ? "text-bad" : "text-warn")}>
        {c.outcomes.success} / {tried}
      </span>
      {c.outcomes.undetermined > 0 && (
        <span className="text-[11px] text-warn">{c.outcomes.undetermined} 次未判定</span>
      )}
      {abnormal.map(([state, n]) => (
        <span key={state} className="text-[11px] text-bad">{n} 次{completionLabel(state)}</span>
      ))}
    </div>
  );
}

function Checks({ c }: { c: CandidateRow }) {
  if (c.checkExecuted === 0) return <span className="text-muted-foreground">—</span>;
  const all = c.checkPass === c.checkExecuted;
  return <Tag tone={all ? "ok" : "bad"} className="font-mono">{c.checkPass} / {c.checkExecuted}</Tag>;
}

function WinRate({ c }: { c: CandidateRow }) {
  if (c.winRate === null) return <span className="text-muted-foreground">—</span>;
  const width = Math.max(0, Math.min(100, c.winRate));
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:inline-block">
        <span className="block h-full rounded-full bg-brand-2" style={{ width: `${width.toFixed(0)}%` }} />
      </span>
      <span className="font-mono">{fmtPct(c.winRate)}</span>
    </div>
  );
}

export function Candidates({ candidates, control }: Pick<StepReport, "candidates" | "control">) {
  return (
    <Section title="候选对比" hint="同一组输入上的结果。未通过门槛的候选保留在表里，方便对照。">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>候选</TableHead>
            <TableHead>任务成功</TableHead>
            <TableHead className="text-right">必过检查</TableHead>
            <TableHead className="text-right">裁判胜率</TableHead>
            <TableHead className="text-right">绝对分</TableHead>
            <TableHead className="text-right">每次成功成本</TableHead>
            <TableHead className="text-right">中位耗时</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => (
            <TableRow
              key={c.id}
              className={cn(c.chosen && "bg-champ shadow-[inset_3px_0_0_var(--brand)] hover:bg-champ", c.gated && "text-muted-foreground")}
            >
              <TableCell className="align-top"><Name c={c} /></TableCell>
              <TableCell className="align-top"><Success c={c} /></TableCell>
              <TableCell className="text-right align-top"><Checks c={c} /></TableCell>
              <TableCell className="text-right align-top"><WinRate c={c} /></TableCell>
              <TableCell className="text-right align-top font-mono">{fmtScore(c.absolute)}</TableCell>
              <TableCell className="text-right align-top font-mono">{fmtUsd(c.costPerSuccess)}</TableCell>
              <TableCell className="text-right align-top font-mono">{fmtSec(c.p50)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Note>
        必过检查按实际执行次数计。裁判胜率来自成对比较，平局算半场，只作参考，不参与推荐。
        绝对分是裁判给每份输出单独打的 1–5 分。每次成功成本只算生成，不含裁判费用。
        {control && ` 对照候选是 ${control}。`}
      </Note>
    </Section>
  );
}
