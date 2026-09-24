/**
 * Two things every number above depends on: whether the evaluators actually
 * ran, and what the evaluation cost. An evaluator that errored shrinks the
 * denominator; it is never counted against a candidate.
 */

import type { StepReport } from "../../../../../report-model.js";
import { fmtUsd } from "../../../../../report-format.js";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Code, Note, Section } from "../Section";

function Evaluators({ coverage, evaluatorErrors }: Pick<StepReport, "coverage" | "evaluatorErrors">) {
  const problems = coverage.some((c) => c.not_evaluated + c.evaluator_error > 0);
  return (
    <Section title="评估器状态" hint="评估器自己有没有跑成功。出错的不算候选失败，只会让分母变小。">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>评估器</TableHead>
            <TableHead className="text-right">通过</TableHead>
            <TableHead className="text-right">未通过</TableHead>
            <TableHead className="text-right">未评估</TableHead>
            <TableHead className="text-right">出错</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {coverage.map((c) => (
            <TableRow key={c.evaluator}>
              <TableCell className="whitespace-normal">
                <span className="font-mono text-xs">{c.evaluator}</span>
                <span className="block font-mono text-[11px] break-all whitespace-normal text-muted-foreground">{c.version}</span>
              </TableCell>
              <TableCell className="text-right font-mono">{c.pass}</TableCell>
              <TableCell className="text-right font-mono">{c.fail}</TableCell>
              <TableCell className="text-right font-mono">{c.not_evaluated || "—"}</TableCell>
              <TableCell className={c.evaluator_error > 0 ? "text-right font-mono text-warn" : "text-right font-mono"}>
                {c.evaluator_error || "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {evaluatorErrors.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {evaluatorErrors.map((e, i) => (
            <li key={i}><Code>{e.evaluator}</Code> {e.subject}：{e.reason}</li>
          ))}
        </ul>
      )}
      {!problems && <Note>所有评估都正常执行了。</Note>}
    </Section>
  );
}

function Ledger({ ledger, ledgerNote, trialCount }: Pick<StepReport, "ledger" | "ledgerNote" | "trialCount">) {
  const rows: Array<[string, number]> = [
    [`候选生成（${trialCount} 次）`, ledger.generation],
    ["成对裁判", ledger.judging],
    ["绝对打分", ledger.scoring],
    ["确定性检查", ledger.checks],
    ["重试", ledger.retries],
  ];
  return (
    <Section title="花费" hint={`数据来源：${ledger.source}`}>
      <Table>
        <TableBody>
          {rows.map(([label, value]) => (
            <TableRow key={label}>
              <TableCell className="text-muted-foreground">{label}</TableCell>
              <TableCell className="text-right font-mono">{fmtUsd(value)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-semibold">
            <TableCell>合计</TableCell>
            <TableCell className="text-right font-mono">{fmtUsd(ledger.total)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="text-muted-foreground">每次成功（含评估）</TableCell>
            <TableCell className="text-right font-mono">{fmtUsd(ledger.cost_per_success)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      {ledgerNote && <Note>{ledgerNote}</Note>}
    </Section>
  );
}

export function CoverageAndLedger(props: Pick<StepReport, "coverage" | "evaluatorErrors" | "ledger" | "ledgerNote" | "trialCount">) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Ledger ledger={props.ledger} ledgerNote={props.ledgerNote} trialCount={props.trialCount} />
      <Evaluators coverage={props.coverage} evaluatorErrors={props.evaluatorErrors} />
    </div>
  );
}
