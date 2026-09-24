/**
 * What happened to the evaluator, kept apart from what happened to the
 * candidate. `evaluator_error` and `not_evaluated` shrink the denominator;
 * they are never counted against anybody's score.
 */

import { Tag } from "@/components/tag";
import { EVALUATION_STATES, type EvaluationRow } from "./model";
import { evaluationTone } from "@/lib/tone";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export function EvaluationTable({ rows }: { rows: EvaluationRow[] }) {
  const counts = EVALUATION_STATES.map((s) => [s, rows.filter((r) => r.state === s).length] as const);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {counts.map(([state, n]) => (
          <Tag key={state} tone={n === 0 ? "neutral" : evaluationTone(state)}>
            {state} {n}
          </Tag>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <code className="font-mono">evaluator_error</code> and{" "}
        <code className="font-mono">not_evaluated</code> are evaluator states, not candidate failures -
         they do not count against a candidate, they only shrink the denominator.
      </p>
      <ScrollArea className="max-h-[50vh]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Step</TableHead>
              <TableHead>Evaluator</TableHead>
              <TableHead>Candidate</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{r.step}</TableCell>
                <TableCell className="font-mono text-xs">{r.evaluator_id}</TableCell>
                <TableCell className="font-mono text-xs">{r.candidate}</TableCell>
                <TableCell>
                  <Tag tone={evaluationTone(r.state)}>{r.state}</Tag>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
