/**
 * What each command candidate's trace showed it doing: turns, tool calls,
 * the tools it reached for, how its runs ended. Evidence beside the numbers
 * above; nothing here enters the selection.
 */

import type { StepReport } from "../../../../../report-model.js";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Note, Section } from "../Section";

type Props = Pick<StepReport, "agentActivity">;

const fmtN = (v: number | null): string => (v === null ? "—" : String(v));

export function AgentActivity({ agentActivity: rows }: Props) {
  if (rows.length === 0) return null;
  return (
    <Section title="Agent activity" hint="From the trace each command left (cli.trace). Medians over traced trials; — where the format records nothing.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead className="text-right">Turns p50</TableHead>
            <TableHead className="text-right">Tool calls p50</TableHead>
            <TableHead>Most-called tools</TableHead>
            <TableHead className="text-right">Retries</TableHead>
            <TableHead className="text-right">Denials</TableHead>
            <TableHead>Ended</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-normal">
                <span className="font-mono text-xs">{r.id}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {r.traced} of {r.trials} trial(s) traced{r.unreadable > 0 ? ` · ${r.unreadable} unreadable` : ""}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono">{fmtN(r.turnsP50)}</TableCell>
              <TableCell className="text-right font-mono">{fmtN(r.toolCallsP50)}</TableCell>
              <TableCell className="whitespace-normal">
                {r.topTools.length === 0 ? "—" : r.topTools.map(([name, n], i) => (
                  <span key={name}>{i > 0 ? ", " : ""}<span className="font-mono text-xs">{name}</span> ×{n}</span>
                ))}
              </TableCell>
              <TableCell className="text-right font-mono">{fmtN(r.retries)}</TableCell>
              <TableCell className="text-right font-mono">{fmtN(r.denials)}</TableCell>
              <TableCell className="whitespace-normal">{r.ended.map(([e, n]) => `${n} ${e}`).join(", ")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Note>Counts per trial are in <span className="font-mono">agent</span> on each row of scores.jsonl; the turn list is in traces/.</Note>
    </Section>
  );
}
