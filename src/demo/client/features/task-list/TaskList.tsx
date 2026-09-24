/**
 * Every task in the workspace, one row each.
 *
 * A task that was never run keeps its row and says so, rather than being
 * left out for having nothing to show — the list is what the workspace
 * defined, not what it happens to have measured.
 *
 * Smoke tasks are folded away behind a summary. Their candidates are local
 * scripts, so their results prove the pipeline works and nothing about a
 * model; mixed into the same table a reader would count them as evidence.
 */

import { SECTION_CARD, SECTION_TITLE } from "@/components/section-style";
import { Tag } from "@/components/tag";
import type { TaskView } from "../../../catalog.js";
import { navigate } from "@/app/routes";
import { NEEDS_REVIEW, NEVER_RAN, SELF_CHECK } from "@/lib/copy";
import { isSmokeTask, latestVerdict, runDate, spendLabel } from "@/lib/format";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function TaskRow({ task }: { task: TaskView }) {
  const open = () => navigate({ view: "task", specPath: task.specPath });
  const spend = spendLabel(task);
  const chosen = latestVerdict(task);
  const latest = task.runs[0];

  return (
    <TableRow onClick={open} className="cursor-pointer">
      <TableCell>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          className="font-mono underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {task.name}
        </button>
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {task.steps.length}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {task.runs.length}
      </TableCell>
      <TableCell className="w-full">
        {chosen === null ? (
          <span className="text-muted-foreground">{NEVER_RAN}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {chosen.map((c, i) => (
              <span key={`${c}-${i}`} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground">/</span>}
                {c === NEEDS_REVIEW ? (
                  <Tag tone="bad">{c}</Tag>
                ) : (
                  <span className="font-mono text-[13px]">{c}</span>
                )}
              </span>
            ))}
          </span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {spend ? (
          <span className={cn(spend.over && "font-semibold text-bad")}>{spend.text}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {latest ? runDate(latest.startedAt) : "—"}
      </TableCell>
    </TableRow>
  );
}

function Rows({ tasks }: { tasks: TaskView[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="whitespace-nowrap">名称</TableHead>
          <TableHead className="text-right">步骤</TableHead>
          <TableHead className="text-right">运行</TableHead>
          <TableHead className="w-full">最新结论</TableHead>
          <TableHead className="text-right">花费</TableHead>
          <TableHead>最近</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((t) => (
          <TaskRow key={t.specPath} task={t} />
        ))}
      </TableBody>
    </Table>
  );
}

export function TaskList({ tasks }: { tasks: TaskView[] }) {
  const smoke = tasks.filter(isSmokeTask);
  const real = tasks.filter((t) => !isSmokeTask(t));

  return (
    <section aria-label="任务" className={cn(SECTION_CARD, "flex flex-col gap-3 border border-border bg-card p-4")}>
      <h2 className={SECTION_TITLE}>任务（{real.length}）</h2>
      {real.length === 0 ? (
        <p className="text-xs text-muted-foreground">这个工作区还没有任务。</p>
      ) : (
        <Rows tasks={real} />
      )}

      {smoke.length > 0 && (
        <details className="border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
            {SELF_CHECK} {smoke.length} 个 —— 候选是本地脚本，只验证评测流程能跑通，不说明模型好坏
          </summary>
          <div className="px-3 pb-3">
            <Rows tasks={smoke} />
          </div>
        </details>
      )}
    </section>
  );
}
