/**
 * completion_state × task_outcome.
 *
 * The cell that matters is "completed, but did not succeed" — the candidate
 * answered and the answer did not hold up. An average score hides exactly
 * that cell, which is why this grid is the first thing on the evidence tab.
 */

import { Tag } from "@/components/tag";
import { useMemo } from "react";
import { failureMatrix, isQuietFailure, type TrialRow } from "./model";
import { outcomeTone } from "@/lib/tone";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface Props {
  rows: TrialRow[];
  onPick: (rows: TrialRow[]) => void;
}

export function FailureMatrix({ rows, onPick }: Props) {
  const matrix = useMemo(() => failureMatrix(rows), [rows]);
  const quiet = rows.filter(isQuietFailure).length;

  if (matrix.total === 0) {
    return (
      <Empty>
        <EmptyHeader><EmptyTitle>这次运行没有 scores.jsonl</EmptyTitle></EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            {/* The label column takes the slack so the outcome columns stay
                narrow and side by side, which is how the grid is read. */}
            <TableHead className="w-full">完成状态 \ 任务结果</TableHead>
            {matrix.outcomes.map((o) => (
              <TableHead key={o} className="px-4 text-center whitespace-nowrap">
                <Tag tone={outcomeTone(o)}>{o}</Tag>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {matrix.completions.map((c) => (
            <TableRow key={c}>
              <TableCell className="w-full font-mono text-xs">{c}</TableCell>
              {matrix.outcomes.map((o) => {
                const cell = matrix.cell(c, o);
                if (cell.length === 0) {
                  return (
                    <TableCell key={o} className="px-4 text-center text-muted-foreground">·</TableCell>
                  );
                }
                return (
                  <TableCell key={o} className="px-4 text-center">
                    <button
                      type="button"
                      onClick={() => onPick(cell)}
                      className={cn(
                        "font-mono underline underline-offset-2",
                        c === "success" && o === "success" && "text-muted-foreground",
                      )}
                    >
                      {cell.length}
                    </button>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        {matrix.total} 次试验。点数字看具体是哪几次。
        {quiet > 0 && (
          <>
            {" "}其中 <b>{quiet}</b> 次「跑完了但没做对」——
            候选答了，答案没站住，这类最容易被平均分盖掉。
          </>
        )}
      </p>
    </div>
  );
}
