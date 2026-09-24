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
    <Section title="Evaluator status" hint="Whether the evaluators themselves ran. An evaluator error is not a candidate failure; it only shrinks the denominator.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Evaluator</TableHead>
            <TableHead className="text-right">Pass</TableHead>
            <TableHead className="text-right">Fail</TableHead>
            <TableHead className="text-right">Not evaluated</TableHead>
            <TableHead className="text-right">Error</TableHead>
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
            <li key={i}><Code>{e.evaluator}</Code> {e.subject}: {e.reason}</li>
          ))}
        </ul>
      )}
      {!problems && <Note>Every evaluation ran normally.</Note>}
    </Section>
  );
}

function Ledger({ ledger, ledgerNote, trialCount }: Pick<StepReport, "ledger" | "ledgerNote" | "trialCount">) {
  const rows: Array<[string, number]> = [
    [`Candidate generation (${trialCount} trials)`, ledger.generation],
    ["Pairwise judging", ledger.judging],
    ["Absolute scoring", ledger.scoring],
    ["Deterministic checks", ledger.checks],
    ["Retries", ledger.retries],
  ];
  return (
    <Section title="Spend" hint={`Source: ${ledger.source}`}>
      <Table>
        <TableBody>
          {rows.map(([label, value]) => (
            <TableRow key={label}>
              <TableCell className="text-muted-foreground">{label}</TableCell>
              <TableCell className="text-right font-mono">{fmtUsd(value)}</TableCell>
            </TableRow>
          ))}
          <TableRow className="font-semibold">
            <TableCell>Total</TableCell>
            <TableCell className="text-right font-mono">{fmtUsd(ledger.total)}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="text-muted-foreground">Per success (incl. evaluation)</TableCell>
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
