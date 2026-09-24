/**
 * The rows the averages are made of, the outputs the judge read, and what
 * this run could not observe. Shown in full; the page keeps them folded.
 */

import type { StepReport } from "../../../../../report-model.js";
import type { TrialRow } from "../../../../../canon/rows.js";
import { completionLabel, outcomeLabel } from "../../../../../report-copy.js";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { tagTone } from "../tone";
import { Tag, WithCode } from "../Section";

/** The required check's verdict for one trial, with what it found — "10 passed", "signals.ts not found". */
function CheckCell({ t }: { t: TrialRow }) {
  const results = Object.values(t.checks ?? {});
  if (results.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {results.map((c, i) => (
        <span key={i} className="flex min-w-0 flex-col gap-0.5">
          <Tag tone={tagTone(c.state)} className="w-fit">{c.state}</Tag>
          {c.evidence && <span className="text-[11px] break-words text-muted-foreground">{c.evidence}</span>}
        </span>
      ))}
    </div>
  );
}

function scoreDims(trials: readonly TrialRow[]): string[] {
  return [...new Set(trials.flatMap((t) => Object.keys(t.judge?.absolute_dimensions ?? {})))];
}

export function Trials({ trials }: { trials: TrialRow[] }) {
  const dims = scoreDims(trials);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>候选</TableHead>
          <TableHead>输入</TableHead>
          <TableHead className="text-right">第几次</TableHead>
          <TableHead>结果</TableHead>
          <TableHead>必过检查</TableHead>
          <TableHead className="text-right">总分</TableHead>
          {dims.map((d) => <TableHead key={d} className="text-right">{d}</TableHead>)}
          <TableHead className="text-right">输出 token</TableHead>
          <TableHead className="text-right">成本</TableHead>
          <TableHead className="text-right">耗时</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trials.map((t) => (
          <TableRow key={`${t.candidate}-${t.input}-${t.trial}`}>
            <TableCell className="font-mono text-xs">{t.candidate}</TableCell>
            <TableCell className="font-mono text-xs">{t.input}</TableCell>
            <TableCell className="text-right font-mono">{t.trial + 1}</TableCell>
            <TableCell className="text-xs whitespace-nowrap">
              <Tag tone={tagTone(t.task_outcome)}>{outcomeLabel(t.task_outcome)}</Tag>
              {t.completion_state !== "success" && (
                <span className="ml-1.5 text-bad">{completionLabel(t.completion_state)}</span>
              )}
              {t.truncated && <span className="ml-1.5 text-muted-foreground" title="finish_reason=length">被截断</span>}
            </TableCell>
            <TableCell className="max-w-64 align-top text-xs"><CheckCell t={t} /></TableCell>
            <TableCell className="text-right font-mono">{t.judge?.absolute_overall ?? "—"}</TableCell>
            {dims.map((d) => (
              <TableCell key={d} className="text-right font-mono">{t.judge?.absolute_dimensions?.[d] ?? "—"}</TableCell>
            ))}
            <TableCell className="text-right font-mono">{t.tokens?.completion ?? "—"}</TableCell>
            <TableCell className="text-right font-mono">${(t.cost?.generation ?? 0).toFixed(4)}</TableCell>
            <TableCell className="text-right font-mono">
              {t.ms === null || t.ms === undefined ? "—" : `${Math.round(t.ms / 1000)} s`}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function Outputs({ outputs }: Pick<StepReport, "outputs">) {
  return (
    <div className="flex flex-col divide-y divide-border">
      {outputs.map((o) => {
        const title = `${o.candidate} · ${o.input} · 第 ${o.trial + 1} 次`;
        return (
          <details key={title} className="py-2 text-sm">
            <summary className={cn("cursor-pointer font-mono text-xs", o.text === null && "text-muted-foreground")}>
              {title}
              <span className="ml-2 font-sans text-muted-foreground">
                {o.text === null ? "没有保存原始输出" : `${o.totalChars.toLocaleString()} 字符`}
              </span>
            </summary>
            {o.text !== null && (
              <>
                {o.totalChars > o.text.length && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    只显示前 {o.text.length.toLocaleString()} 字符，完整内容在运行目录的 raw/ 里。
                  </p>
                )}
                <pre className="mt-2 max-h-[460px] overflow-auto bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-words">
                  {o.text}
                </pre>
              </>
            )}
          </details>
        );
      })}
    </div>
  );
}

export function Gaps({ gaps }: Pick<StepReport, "gaps">) {
  if (gaps.length === 0) return <p className="text-sm text-muted-foreground">GAPS.md 为空或不存在。</p>;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
      {gaps.map((g, i) =>
        g.kind === "heading" ? (
          <li key={i} className="-ml-5 mt-2 list-none font-medium text-foreground">{g.text}</li>
        ) : (
          <li key={i}><WithCode text={g.text} /></li>
        ),
      )}
    </ul>
  );
}

export function RawRecords({ sampleTrial, manifest }: Pick<StepReport, "sampleTrial" | "manifest">) {
  return (
    <div className="flex flex-col gap-2">
      {[
        ["scores.jsonl 的第一行", sampleTrial],
        ["manifest.json", manifest],
      ].map(([label, body]) => (
        <details key={label} className="text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground">{label}</summary>
          <pre className="mt-2 max-h-[420px] overflow-auto bg-muted p-3 font-mono text-xs">{body}</pre>
        </details>
      ))}
    </div>
  );
}
