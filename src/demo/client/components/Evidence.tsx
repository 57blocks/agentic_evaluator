/** A run's evidence: the failure matrix first, then the rows behind it. */

import { useEffect, useMemo, useState } from "react";
import type { RunView } from "../../catalog.js";
import {
  type EvaluationRow, type TrialRow,
  EVALUATION_STATES, failureMatrix, isQuietFailure, readJsonl, readText,
} from "../evidence.js";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

const OUTCOME_TONE: Record<string, "ok" | "warn" | "bad"> = {
  success: "ok",
  undetermined: "warn",
  failure: "bad",
};

const EVAL_TONE: Record<string, "ok" | "warn" | "bad"> = {
  pass: "ok",
  fail: "bad",
  not_evaluated: "warn",
  evaluator_error: "warn",
};

function Matrix({ rows, onPick }: { rows: TrialRow[]; onPick: (r: TrialRow[]) => void }) {
  const m = useMemo(() => failureMatrix(rows), [rows]);
  if (m.total === 0) {
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
            <TableHead>完成状态 \ 任务结果</TableHead>
            {m.outcomes.map((o) => (
              <TableHead key={o} className="text-right">
                <Badge variant={OUTCOME_TONE[o] ?? "secondary"}>{o}</Badge>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {m.completions.map((c) => (
            <TableRow key={c}>
              <TableCell className="font-mono text-xs">{c}</TableCell>
              {m.outcomes.map((o) => {
                const cell = m.cell(c, o);
                return (
                  <TableCell key={o} className="text-right">
                    {cell.length === 0 ? (
                      <span className="text-muted-foreground">·</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPick(cell)}
                        className={cn(
                          "font-mono underline underline-offset-2",
                          c === "success" && o === "success"
                            ? "text-muted-foreground"
                            : "text-primary",
                        )}
                      >
                        {cell.length}
                      </button>
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        {m.total} 次试验。点数字看具体是哪几次。
        {rows.some(isQuietFailure) && (
          <>
            {" "}其中 <b>{rows.filter(isQuietFailure).length}</b> 次「跑完了但没做对」——
            候选答了，答案没站住，这类最容易被平均分盖掉。
          </>
        )}
      </p>
    </div>
  );
}

function TrialTable({ rows }: { rows: TrialRow[] }) {
  return (
    <ScrollArea className="max-h-[50vh] rounded-lg border border-border">
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
                <Badge variant={OUTCOME_TONE[r.task_outcome] ?? "secondary"}>
                  {r.task_outcome}
                </Badge>
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

function EvalTable({ rows }: { rows: EvaluationRow[] }) {
  const counts = EVALUATION_STATES.map((s) => [s, rows.filter((r) => r.state === s).length] as const);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {counts.map(([s, n]) => (
          <Badge key={s} variant={n === 0 ? "outline" : (EVAL_TONE[s] ?? "secondary")}>
            {s} {n}
          </Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <code className="font-mono">evaluator_error</code> 和{" "}
        <code className="font-mono">not_evaluated</code> 是评估器的状态，不是候选的失败——
        它们不计入候选得分，只让分母变小。
      </p>
      <ScrollArea className="max-h-[50vh] rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>步骤</TableHead>
              <TableHead>评估器</TableHead>
              <TableHead>候选</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>原因</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{r.step}</TableCell>
                <TableCell className="font-mono text-xs">{r.evaluator_id}</TableCell>
                <TableCell className="font-mono text-xs">{r.candidate}</TableCell>
                <TableCell>
                  <Badge variant={EVAL_TONE[r.state] ?? "secondary"}>{r.state}</Badge>
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

export function Evidence({ run }: { run: RunView }) {
  const [trials, setTrials] = useState<TrialRow[]>([]);
  const [evals, setEvals] = useState<EvaluationRow[]>([]);
  const [gaps, setGaps] = useState("");
  const [picked, setPicked] = useState<TrialRow[] | null>(null);

  useEffect(() => {
    let live = true;
    setPicked(null);
    void readJsonl<TrialRow>(run, "scores.jsonl").then((r) => live && setTrials(r));
    void readJsonl<EvaluationRow>(run, "evaluations.jsonl").then((r) => live && setEvals(r));
    void readText(run, "GAPS.md").then((t) => live && setGaps(t));
    return () => {
      live = false;
    };
  }, [run.id]);

  return (
    <Tabs defaultValue="matrix" className="w-full">
      <TabsList>
        <TabsTrigger value="matrix">失败分布</TabsTrigger>
        <TabsTrigger value="trials">试验 {trials.length}</TabsTrigger>
        <TabsTrigger value="evals">评估 {evals.length}</TabsTrigger>
        <TabsTrigger value="gaps">GAPS</TabsTrigger>
      </TabsList>

      <TabsContent value="matrix" className="flex flex-col gap-4 pt-3">
        <Matrix rows={trials} onPick={setPicked} />
        {picked && (
          <div className="flex flex-col gap-2">
            <h4 className="text-sm font-semibold">选中的 {picked.length} 次试验</h4>
            <TrialTable rows={picked} />
          </div>
        )}
      </TabsContent>

      <TabsContent value="trials" className="pt-3">
        <TrialTable rows={trials} />
      </TabsContent>

      <TabsContent value="evals" className="pt-3">
        <EvalTable rows={evals} />
      </TabsContent>

      <TabsContent value="gaps" className="pt-3">
        {gaps ? (
          <ScrollArea className="max-h-[50vh] rounded-lg border border-border bg-card">
            <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {gaps}
            </pre>
          </ScrollArea>
        ) : (
          <Empty>
            <EmptyHeader><EmptyTitle>这次运行没有 GAPS.md</EmptyTitle></EmptyHeader>
          </Empty>
        )}
      </TabsContent>
    </Tabs>
  );
}
