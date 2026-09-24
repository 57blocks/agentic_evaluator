/**
 * The landing page: how much this workspace has measured, the tasks to open,
 * and each step's latest conclusion.
 */

import { cn } from "@/lib/utils";
import { ACCENT_CARD, ACCENT_TITLE } from "@/components/accent";
import { Tag } from "@/components/tag";
import type { Overview, StepStanding } from "../../../server/overview.js";
import type { Catalog } from "@/app/useWorkspace";
import { TaskList } from "@/features/task-list/TaskList";
import { navigate } from "@/app/routes";
import { NEEDS_REVIEW, SELF_CHECK } from "@/lib/copy";
import { FIRMNESS_LABEL } from "../../../report-copy.js";
import { runDate, runMoney } from "@/lib/format";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border bg-card p-3">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <b className="block text-lg tabular-nums">{value}</b>
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function StepRow({ standing }: { standing: StepStanding }) {
  const gate =
    standing.eligible.length > 0 || standing.gated.length > 0
      ? `${standing.eligible.length} 合格 / ${standing.gated.length} 被门槛挡下`
      : "—";
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{standing.step}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{standing.task ?? "—"}</TableCell>
      <TableCell>
        {standing.chosen ? (
          <span className="font-mono text-xs font-semibold text-brand">{standing.chosen}</span>
        ) : (
          <Tag tone="bad">{NEEDS_REVIEW}</Tag>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{FIRMNESS_LABEL[standing.firmness as keyof typeof FIRMNESS_LABEL] ?? standing.firmness}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{gate}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        {runMoney(standing.ledgerTotal) || "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{runDate(standing.startedAt)}</TableCell>
      <TableCell>
        <button
          type="button"
          onClick={() => navigate({ view: "run", runId: standing.runId })}
          className="text-xs underline underline-offset-2"
        >
          打开
        </button>
        {standing.synthetic && (
          <Tag tone="neutral" className="ml-2 text-[10px]">{SELF_CHECK}</Tag>
        )}
      </TableCell>
    </TableRow>
  );
}

function Standings({ steps }: { steps: StepStanding[] }) {
  return (
    <section aria-label="每一步的最新结论" className={cn(ACCENT_CARD, "border border-border bg-card p-4")}>
      <h2 className={cn(ACCENT_TITLE, "mb-1")}>每一步的最新结论</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        同名步骤只留最新的一次，不论它来自哪个任务。
      </p>
      {steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">还没有任何运行。</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>步骤</TableHead>
                <TableHead>任务</TableHead>
                <TableHead>选中</TableHead>
                <TableHead>确信度</TableHead>
                <TableHead>资格门</TableHead>
                <TableHead className="text-right">花费</TableHead>
                <TableHead>日期</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {steps.map((s) => (
                <StepRow key={`${s.runId}:${s.step}`} standing={s} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

export function HomePage({ data, catalog }: { data: Overview; catalog: Catalog }) {
  const { tasksNeverRun, stepsWithNoChoice } = data.unobserved;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-base font-semibold">工作区</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{data.workspace}</p>
      </header>

      <section aria-label="总览" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="任务" value={`${data.tasks.run} / ${data.tasks.total}`} hint="跑过 / 已定义" />
        <Stat label="运行" value={String(data.spend.runs)} hint="工作区内全部" />
        <Stat
          label="累计花费"
          value={runMoney(data.spend.totalUsd) || "—"}
          hint="报告了账本的运行之和"
        />
        <Stat
          label="没有结论"
          value={String(tasksNeverRun.length + stepsWithNoChoice.length)}
          hint="从没跑过的任务 + 选不出人的步骤"
        />
      </section>

      <TaskList tasks={catalog.tasks} />
      <Standings steps={data.steps} />
    </div>
  );
}
