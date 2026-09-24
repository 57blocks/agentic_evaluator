/** One row per trial: who ran, on what, and how it came out. */

import { Tag } from "@/components/tag";
import type { TrialRow } from "./model";
import { outcomeTone } from "@/lib/tone";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export function TrialTable({ rows }: { rows: TrialRow[] }) {
  return (
    <ScrollArea className="max-h-[50vh] border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>步骤</TableHead>
            <TableHead>候选</TableHead>
            <TableHead>输入</TableHead>
            <TableHead>完成</TableHead>
            <TableHead>结果</TableHead>
            <TableHead>说明</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={`${r.step}-${r.candidate}-${r.input}-${r.trial}-${i}`}>
              <TableCell className="font-mono text-xs">{r.step}</TableCell>
              <TableCell className="font-mono text-xs">{r.candidate}</TableCell>
              <TableCell className="font-mono text-xs">{r.input}</TableCell>
              <TableCell className="font-mono text-xs">{r.completion_state}</TableCell>
              <TableCell>
                <Tag tone={outcomeTone(r.task_outcome)}>{r.task_outcome}</Tag>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {(r.outcome_reasons ?? []).join("；")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
