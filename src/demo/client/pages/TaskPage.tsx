/**
 * A task: what it asks, how it is judged, and every run it produced.
 *
 * The run control sits here rather than in the shell because starting a run
 * is a thing you do *to a task* — there is no such button on a run or on the
 * overview, and a page that showed one would have to invent which task it
 * meant.
 */

import { Tag } from "@/components/tag";
import type { RunView, TaskView } from "../../catalog.js";
import { navigate } from "@/app/routes";
import { NEEDS_REVIEW } from "@/lib/copy";
import { primaryReportDir, runStamp, spendLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FileBrowser } from "@/features/task-files/FileBrowser";
import { RunControl } from "@/features/run-control/RunControl";
import { TestPlan } from "@/features/test-plan/TestPlan";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/** Whether the steps hand their output to each other, said in words. */
function handoffLabel(task: TaskView): string {
  const chained = task.steps.some((s) => s.inputFrom);
  return chained
    ? `独立评测无交接；e2e 对照沿 ${task.steps.map((s) => s.id).join(" → ")}`
    : `${task.steps.length} 个独立步骤（无交接）`;
}

function RunsTable({ runs }: { runs: RunView[] }) {
  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>这个任务还没跑过</EmptyTitle>
          <EmptyDescription>定义已经就位，跑一次才会有证据。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>运行</TableHead>
          <TableHead>成本</TableHead>
          <TableHead>各步推荐</TableHead>
          <TableHead>类型</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="font-mono whitespace-nowrap">
              <button
                type="button"
                onClick={() => navigate({ view: "run", runId: run.id })}
                className="underline underline-offset-2"
              >
                {runStamp(run)}
              </button>
            </TableCell>
            <TableCell className="font-mono whitespace-nowrap">
              {run.totalUsd == null ? "—" : `$${run.totalUsd.toFixed(4)}`}
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-1">
                {run.steps.map((s, i) => (
                  <span key={`${s.id}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground">/</span>}
                    {s.chosen ? (
                      <span className="font-mono text-[13px]">{s.chosen}</span>
                    ) : (
                      <Tag tone="bad">{NEEDS_REVIEW}</Tag>
                    )}
                  </span>
                ))}
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {run.kind === "workflow" ? "多步骤" : "单步骤"}
              {run.synthetic && " · 脚本"}
            </TableCell>
            <TableCell className="text-right">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate({ view: "report", runId: run.id, dir: primaryReportDir(run) })}
              >
                报告
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TaskPage({ task, onRunFinished }: { task: TaskView; onRunFinished: () => void }) {
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
              <span className={cn(spend.over && "font-semibold text-bad")}>
                {spend.text}
              </span>
            </>
          )}
          {` · ${handoffLabel(task)}`}
        </p>
        <p className="text-xs text-muted-foreground">
          命令行里同样一件事：<code className="font-mono">agenteval plan {task.name}</code> 只报价，
          <code className="font-mono">agenteval run {task.name} --yes</code> 才真跑。
        </p>
      </header>

      <RunControl task={task.name} onFinished={onRunFinished} />

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">运行（{task.runs.length} 次）</h3>
        <RunsTable runs={task.runs} />
      </section>

      <section aria-label="测试方案" className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">测试方案</h3>
        <TestPlan plan={task.plan} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">定义文件（{task.files.length} 个）</h3>
        <p className="text-xs text-muted-foreground">上面的测试方案就是从这些文件读出来的，spec.yaml 是唯一的来源。</p>
        <FileBrowser task={task.name} files={task.files} />
      </section>

    </div>
  );
}
