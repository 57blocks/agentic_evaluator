/**
 * The cross-run view: one row per step, from whichever run produced it last.
 *
 * It opens with what has *not* been measured, because that is the number this
 * whole project exists to keep visible. A task defined and never run, and a
 * step whose latest run could not choose anybody, both look like empty space
 * in a ranking table — and empty space reads as "fine".
 */

import type { Overview as OverviewData, StepStanding } from "../../../server/overview.js";
import { NEEDS_REVIEW, runDate, runMoney } from "../render.js";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  data: OverviewData;
  onSelectRun: (runId: string) => void;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <b className="block text-lg tabular-nums">{value}</b>
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function StepRow({ standing, onSelectRun }: { standing: StepStanding; onSelectRun: (id: string) => void }) {
  const decided = standing.chosen !== null;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-3 font-mono text-xs">{standing.step}</td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{standing.task ?? "—"}</td>
      <td className="py-2 pr-3">
        {decided ? (
          <span className="font-mono text-xs">{standing.chosen}</span>
        ) : (
          <span className="text-xs text-bad">{NEEDS_REVIEW}</span>
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{standing.firmness}</td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">
        {standing.eligible.length > 0 || standing.gated.length > 0
          ? `${standing.eligible.length} 合格 / ${standing.gated.length} 被门槛挡下`
          : "—"}
      </td>
      <td className="py-2 pr-3 text-right text-xs tabular-nums">{runMoney(standing.ledgerTotal) || "—"}</td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{runDate(standing.startedAt)}</td>
      <td className="py-2">
        <button
          type="button"
          onClick={() => onSelectRun(standing.runId)}
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          打开
        </button>
        {standing.synthetic && (
          <Badge variant="outline" className="ml-2 text-[10px]">
            冒烟
          </Badge>
        )}
      </td>
    </tr>
  );
}

export function Overview({ data, onSelectRun }: Props) {
  const { tasksNeverRun, stepsWithNoChoice } = data.unobserved;
  const nothingObserved = tasksNeverRun.length + stepsWithNoChoice.length;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-base font-semibold">这个工作区测出了什么</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{data.workspace}</p>
      </header>

      <section aria-label="总览" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="任务"
          value={`${data.tasks.run} / ${data.tasks.total}`}
          hint="跑过 / 已定义"
        />
        <Stat label="运行" value={String(data.spend.runs)} hint="工作区内全部" />
        <Stat label="累计花费" value={runMoney(data.spend.totalUsd) || "—"} hint="报告了账本的运行之和" />
        <Stat
          label="没有结论"
          value={String(nothingObserved)}
          hint="从没跑过的任务 + 选不出人的步骤"
        />
      </section>

      {nothingObserved > 0 && (
        <section
          aria-label="没有被观察到的部分"
          className={cn("rounded-xl border border-bad/40 bg-card p-4")}
        >
          <h2 className="text-sm font-semibold">没有被观察到的部分</h2>
          <p className="mb-3 mt-1 text-xs text-muted-foreground">
            这一段先于排名出现，是因为它在任何排行榜里都长得像空白，而空白会被读成「没问题」。
          </p>
          {tasksNeverRun.length > 0 && (
            <p className="text-xs">
              <b>定义了但从没跑过：</b>{" "}
              <span className="font-mono text-muted-foreground">{tasksNeverRun.join("、")}</span>
            </p>
          )}
          {stepsWithNoChoice.length > 0 && (
            <p className="mt-1 text-xs">
              <b>跑了但选不出人：</b>{" "}
              <span className="font-mono text-muted-foreground">
                {stepsWithNoChoice.map((s) => `${s.task ?? "—"}/${s.step}`).join("、")}
              </span>
            </p>
          )}
        </section>
      )}

      <section aria-label="每一步的最新结论" className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">每一步的最新结论</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          同名步骤只留最新的一次，不论它来自哪个任务。
        </p>
        {data.steps.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有任何运行。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">步骤</th>
                  <th className="py-1.5 pr-3 font-medium">任务</th>
                  <th className="py-1.5 pr-3 font-medium">选中</th>
                  <th className="py-1.5 pr-3 font-medium">确信度</th>
                  <th className="py-1.5 pr-3 font-medium">资格门</th>
                  <th className="py-1.5 pr-3 text-right font-medium">花费</th>
                  <th className="py-1.5 pr-3 font-medium">日期</th>
                  <th className="py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.steps.map((s) => (
                  <StepRow key={`${s.runId}:${s.step}`} standing={s} onSelectRun={onSelectRun} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
