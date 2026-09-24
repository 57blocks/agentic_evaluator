/**
 * One step on the workflow page: every candidate's numbers in one table,
 * then the per-dimension scores with the dips called out. The step's full
 * report — gates, charts, every duel — is one click away.
 */

import { Tag } from "@/components/tag";
import type { CandidateMeta, WorkflowStep } from "../../../../../workflow-report-model.js";
import { fmtPct, fmtScore, fmtSec, fmtUsd } from "../../../../../report-format.js";
import { navigate } from "@/app/routes";
import { firmnessTone } from "@/lib/tone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { seriesColor } from "../tone";
import { Note, Section } from "../Section";
import { Swatch } from "./Overview";

/** A dimension score worth a second look. */
const DIP = 4.5;

function ScoreBar({ value, slot }: { value: number | null; slot: number }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const width = Math.max(0, Math.min(1, (value - 1) / 4)) * 100;
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 bg-muted sm:inline-block">
        <span className="block h-full" style={{ width: `${width}%`, background: seriesColor(slot) }} />
      </span>
      <span className="font-mono">{fmtScore(value)}</span>
    </span>
  );
}

function Rate({ ok, total }: { ok: number; total: number }) {
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  const all = ok === total;
  return <span className={cn("font-mono", !all && "font-semibold text-bad")}>{Math.round((ok / total) * 100)}%</span>;
}

function Dimensions({ step }: { step: WorkflowStep }) {
  const r = step.report!;
  if (r.dims.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium">
        维度细分 · 绝对分 1–5 <span className="font-normal text-muted-foreground">加粗 ↓ 表示低于 {DIP}</span>
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>候选</TableHead>
            {r.dims.map((d) => <TableHead key={d} className="text-right">{d}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.profiles.map((p) => (
            <TableRow key={p.candidate}>
              <TableCell className="font-mono">{p.candidate}</TableCell>
              {r.dims.map((d) => {
                const v = p.scores[d];
                const dip = v !== null && v < DIP;
                return (
                  <TableCell key={d} className={cn("text-right font-mono", dip && "font-semibold")}>
                    {v === null ? "—" : `${dip ? "↓ " : ""}${v.toFixed(1)}`}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

interface Props {
  step: WorkflowStep;
  index: number;
  runId: string;
  root: string;
  colorOf: Map<string, CandidateMeta>;
}

export function StepSection({ step, index, runId, root, colorOf }: Props) {
  const r = step.report;
  const title = `步骤 ${index + 1} · ${step.id}`;
  if (!r) {
    return (
      <Section title={title} hint="这一步的报告读不出来">
        <Note>{step.error}</Note>
      </Section>
    );
  }
  const fav = r.verdict.judge?.sole ? r.verdict.judge.candidate : null;
  return (
    <Section title={title} hint={`${r.plan.inputs} 个输入 × 每组 ${r.plan.trialsPer} 次 · 运行模式：${r.verdict.modeLabel}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={firmnessTone(r.verdict.firmness)}>{r.verdict.firmnessLabel}</Tag>
        <span className="text-xs">
          {r.verdict.chosen ? <>推荐 <b className="font-mono text-brand">{r.verdict.chosen}</b></> : "没有可推荐的候选"}
        </span>
        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          data-export-omit=""
          onClick={() => navigate({ view: "report", runId, dir: `${root}/${step.dir}` })}
        >
          这一步的完整报告
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{r.verdict.text}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>候选</TableHead>
            <TableHead className="text-right">绝对分 /5</TableHead>
            <TableHead className="text-right">战绩 胜–负–平</TableHead>
            <TableHead className="text-right">胜率</TableHead>
            <TableHead className="text-right">必过检查</TableHead>
            <TableHead className="text-right">正常完成</TableHead>
            <TableHead className="text-right">每次成功成本</TableHead>
            <TableHead className="text-right">中位耗时</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {r.candidates.map((c) => {
            const slot = colorOf.get(c.id)?.colorIndex ?? 99;
            return (
              <TableRow key={c.id} className={cn(c.chosen && "bg-muted/60", c.gated && "text-muted-foreground")}>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Swatch slot={slot} />
                    <span className="font-mono font-medium">{c.id}</span>
                    {c.chosen && <Badge>推荐</Badge>}
                    {fav === c.id && <Badge variant="secondary">裁判最偏好</Badge>}
                    {c.gated && <Badge variant="outline">未通过门槛</Badge>}
                  </span>
                </TableCell>
                <TableCell className="text-right"><ScoreBar value={c.absolute} slot={slot} /></TableCell>
                <TableCell className="text-right font-mono">{c.record.wins}–{c.record.losses}–{c.record.ties}</TableCell>
                <TableCell className="text-right font-mono">{fmtPct(c.winRate)}</TableCell>
                <TableCell className="text-right"><Rate ok={c.checkPass} total={c.checkExecuted} /></TableCell>
                <TableCell className="text-right"><Rate ok={c.completed.ok} total={c.completed.total} /></TableCell>
                <TableCell className="text-right font-mono">{fmtUsd(c.costPerSuccess)}</TableCell>
                <TableCell className="text-right font-mono">{fmtSec(c.p50)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Dimensions step={step} />
    </Section>
  );
}
