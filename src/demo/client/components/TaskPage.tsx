/** Task detail: what the task asks, how it is judged, and every run it produced. */

import { useEffect, useState } from "react";
import type { RunView, TaskView } from "../../catalog.js";
import { NEEDS_REVIEW, defaultFile, spendLabel } from "../render.js";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function useFile(taskName: string, rel: string | undefined) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!rel) return;
    let live = true;
    setText("载入中…");
    const path = rel.split("/").map(encodeURIComponent).join("/");
    fetch(`/artifact/task/${encodeURIComponent(taskName)}/${path}`)
      .then((r) => (r.ok ? r.text() : `读不到（${r.status}）`))
      .then((t) => live && setText(t))
      .catch((e: unknown) => live && setText(`读不到：${e instanceof Error ? e.message : String(e)}`));
    return () => {
      live = false;
    };
  }, [taskName, rel]);
  return text;
}

export function TaskPage({ task, onSelectRun }: {
  task: TaskView;
  onSelectRun: (run: RunView) => void;
}) {
  const [file, setFile] = useState<string | undefined>(() => defaultFile(task.files));
  useEffect(() => setFile(defaultFile(task.files)), [task.specPath, task.files]);
  const body = useFile(task.name, file);

  const chain = task.steps.filter((s) => s.inputFrom);
  const handoff = chain.length
    ? `独立评测无交接；e2e 对照沿 ${task.steps.map((s) => s.id).join(" → ")}`
    : `${task.steps.length} 个独立步骤（无交接）`;
  const spend = spendLabel(task);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{task.name}</h2>
        <p className="text-[13px] text-muted-foreground">
          {task.specPath}
          {spend && (
            <>
              {" · 已花 "}
              <span className={cn(spend.over && "font-semibold text-bad")}>{spend.text}</span>
            </>
          )}
          {` · ${handoff}`}
        </p>
        <p className="text-xs text-muted-foreground">
          命令行里同样一件事：<code className="font-mono">agenteval plan {task.name}</code> 只报价，
          <code className="font-mono">agenteval run {task.name} --yes</code> 才真跑。
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {task.steps.map((step) => (
          <Card key={step.id}>
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between gap-2">
                <span>{step.id}</span>
                <span className="font-mono text-[11px] font-normal text-muted-foreground">
                  {step.producer}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="text-[13px] text-muted-foreground">
                {step.operatingMode || "无运行模式"} · 检查{" "}
                {step.requiredChecks.length ? step.requiredChecks.join(", ") : "无"}
                {step.inputFrom && ` · 交接自 ${step.inputFrom}`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {step.candidates.map((c) => (
                  <Badge key={c} variant="secondary" className="font-mono">{c}</Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                输入 {step.inputs.join("、")} · 裁判标准 {step.rubricFile}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">定义（{task.files.length} 个文件）</h3>
        <div className="grid gap-3 md:grid-cols-[minmax(180px,240px)_1fr]">
          <ScrollArea className="max-h-[60vh] rounded-lg border border-border">
            <ul className="flex flex-col gap-0.5 p-1">
              {task.files.map((f) => (
                <li key={f}>
                  <button
                    type="button"
                    onClick={() => setFile(f)}
                    aria-current={f === file ? "true" : undefined}
                    className={cn(
                      "w-full rounded-md border border-transparent px-2 py-1.5 text-left font-mono text-xs",
                      "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                      "aria-[current]:border-border aria-[current]:bg-accent",
                    )}
                  >
                    {f}
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
          <ScrollArea className="max-h-[60vh] rounded-lg border border-border bg-card">
            <pre className="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
              {body}
            </pre>
          </ScrollArea>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">运行（{task.runs.length} 次）</h3>
        {task.runs.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>这个任务还没跑过</EmptyTitle>
              <EmptyDescription>
                定义已经就位，跑一次才会有证据。
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>运行</TableHead>
                <TableHead>成本</TableHead>
                <TableHead>各步推荐</TableHead>
                <TableHead>类型</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {task.runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-mono whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSelectRun(run)}
                      className="text-primary underline underline-offset-2"
                    >
                      {(run.startedAt ?? run.id).slice(0, 16).replace("T", " ")}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono whitespace-nowrap">
                    {run.totalUsd == null ? "—" : `$${run.totalUsd.toFixed(4)}`}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      {run.steps.map((s, i) => (
                        <span key={s.id + i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted-foreground">/</span>}
                          {s.chosen ? (
                            <span className="font-mono text-[13px]">{s.chosen}</span>
                          ) : (
                            <Badge variant="warn">{NEEDS_REVIEW}</Badge>
                          )}
                        </span>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {run.kind === "workflow" ? "多步骤" : "单步骤"}
                    {run.synthetic && " · 脚本"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
