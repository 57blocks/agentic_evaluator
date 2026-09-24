/**
 * The two-step button: read what a run would cost, then confirm those exact
 * numbers. `useRun` holds the state machine; this file is what it looks like.
 */

import { cn } from "@/lib/utils";
import { ACCENT_CARD, ACCENT_TITLE } from "@/components/accent";
import { Tag } from "@/components/tag";
import { useRun } from "./useRun";
import { eventLine } from "./log";
import { Button } from "@/components/ui/button";

interface Props {
  task: string;
  /** Called when a run finishes, so the catalog can pick up the new directory. */
  onFinished: () => void;
}

export function RunControl({ task, onFinished }: Props) {
  const { phase, ack, handle, events, error, fetchPlan, start, cancel } = useRun(task, onFinished);

  return (
    <section aria-label="运行控制" className={cn(ACCENT_CARD, "border border-border bg-card p-4")}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={ACCENT_TITLE}>跑一次</h2>
        {phase === "running" && <Tag tone="brand">进行中</Tag>}
        {phase === "ended" && handle && <Tag tone={handle.status === "done" ? "ok" : handle.status === "failed" ? "bad" : "warn"}>{handle.status}</Tag>}
        <div className="ml-auto flex gap-2">
          {phase !== "running" && (
            <Button size="sm" variant="outline" onClick={fetchPlan} disabled={phase === "planning"}>
              {phase === "planning" ? "读取中…" : "看看要花多少"}
            </Button>
          )}
          {phase === "ready" && ack && (
            <Button size="sm" onClick={start}>确认这些数字，开跑</Button>
          )}
          {phase === "running" && (
            <Button size="sm" variant="outline" onClick={cancel}>取消</Button>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-bad">{error}</p>}

      {ack && phase !== "running" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {ack.generations} 次生成 · {ack.judgeCalls} 次裁判 · {ack.scoreCalls} 次打分 ·{" "}
          {ack.budgetUsd === null ? "未声明预算" : `预算上限 $${ack.budgetUsd}`}
          <span className="block">
            这几个数字会随请求一起发回去；服务端当场重算，对不上就不开跑。
          </span>
        </p>
      )}

      {events.length > 0 && (
        <pre className="mt-3 max-h-80 overflow-auto border border-border bg-background p-3 text-[11px] leading-relaxed">
          {events.map(eventLine).join("\n")}
        </pre>
      )}

      {phase === "ended" && handle?.error && (
        <p className="mt-2 text-xs text-bad">{handle.error}</p>
      )}
    </section>
  );
}
