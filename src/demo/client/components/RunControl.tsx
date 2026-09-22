/**
 * Start a run, and watch it.
 *
 * The button is deliberately two steps from a click. The page fetches the
 * plan, shows the counts, and sends them back with the request; the server
 * refuses anything that does not match what it would compute right now. So a
 * page left open while somebody edited the spec cannot start the old plan —
 * it gets the new numbers and a human reads them again.
 *
 * Nothing here decides anything about the run. It shows what `plan()` said,
 * and renders the events the run emits, which are the same events the CLI
 * prints and the same ones `--json` writes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunEvent } from "../../../core/events.js";
import type { PlanAck, RunHandle } from "../../../server/runs.js";
import type { WorkflowPlan } from "../../../core/plan.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  task: string;
  /** Called when a run finishes, so the catalog can pick up the new directory. */
  onFinished: () => void;
}

interface PlanResponse {
  plan: WorkflowPlan;
  ack: PlanAck;
}

type Phase = "idle" | "planning" | "ready" | "running" | "ended";

/** One line per event, the same shape the terminal prints. */
function line(event: RunEvent): string {
  switch (event.type) {
    case "step.planned":
      return `▶ ${event.plan.step} — ${event.plan.generations} 次生成`;
    case "phase":
      return `▶ ${event.phase}${event.declared ? "" : " — 规格里没声明，不跑"}`;
    case "trial":
      return event.reusedFrom
        ? `  复用 ${event.candidate} · ${event.input} · t${event.trial}`
        : event.state === "skipped"
          ? `  跳过 ${event.candidate} · ${event.input} · t${event.trial} — 预算到顶`
          : `  ${event.state} ${event.candidate} · ${event.input} · t${event.trial}${event.check ? ` · 检查 ${event.check}` : ""}${event.error ? `: ${event.error}` : ""}`;
    case "judge":
      return `  裁判 ${event.a} vs ${event.b} · ${event.input}${event.ok ? "" : ` — 失败: ${event.error ?? ""}`}`;
    case "score":
      return `  打分 ${event.candidate} · ${event.input} · t${event.trial}${event.ok ? "" : ` — 失败: ${event.error ?? ""}`}`;
    case "budget.stopped":
      return `⚠ 预算到顶，已花 $${event.spentUsd.toFixed(4)}，本次运行不完整`;
    case "run.cancelled":
      return `⚠ 已取消：${event.step} 已派出 ${event.dispatched} 次，${event.skipped} 次没轮到`;
    case "integrity.gaps":
      return `⚠ trace 里有 ${event.gaps} 段长空档，本次耗时不可信`;
    case "step.done":
      return `✔ ${event.step} — ${event.trials} 次试验，账本 $${event.ledgerTotal.toFixed(4)}，推荐 ${event.chosen ?? "无"}（${event.firmness}）`;
    case "e2e.arm.start":
      return `▶ ${event.armId}`;
    case "e2e.arm.done":
      return `✔ ${event.armId}: ${event.success} 成功 / ${event.failure} 失败 / ${event.undetermined} 未判定`;
    case "e2e.validated":
      return `✔ 端到端验证：${event.verdict}（${event.firmness}）— ${event.reason}`;
    case "run.done":
      return `✔ 完成 — 合计 $${event.totalUsd.toFixed(4)}`;
    case "preview.only":
      return "仅预览。";
    case "workflow.planned":
      return `▶ 端到端：${event.e2e.chain.join(" → ")}，每臂 ${event.e2e.perArm} 次生成`;
  }
}

export function RunControl({ task, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [planned, setPlanned] = useState<PlanResponse | null>(null);
  const [handle, setHandle] = useState<RunHandle | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);

  // A different task means a different plan; never carry one over.
  useEffect(() => {
    setPhase("idle");
    setPlanned(null);
    setHandle(null);
    setEvents([]);
    setError(null);
  }, [task]);

  useEffect(() => () => source.current?.close(), []);

  const fetchPlan = useCallback(async () => {
    setPhase("planning");
    setError(null);
    try {
      const res = await fetch(`/api/plan/${encodeURIComponent(task)}`);
      const body = (await res.json()) as PlanResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setPlanned(body);
      setPhase("ready");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }, [task]);

  const start = useCallback(async () => {
    if (!planned) return;
    setError(null);
    setEvents([]);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, ack: planned.ack, html: true }),
      });
      const body = (await res.json()) as RunHandle & { error?: string; ack?: PlanAck };
      if (res.status === 409 && body.ack) {
        // The plan moved under us. Show the new numbers; do not start.
        setPlanned({ plan: planned.plan, ack: body.ack });
        throw new Error(`${body.error} — 数字已更新，请再看一遍`);
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);

      setHandle(body);
      setPhase("running");
      const es = new EventSource(`/api/runs/${body.id}/events`);
      source.current = es;
      es.onmessage = (m) => setEvents((prev) => [...prev, JSON.parse(m.data as string) as RunEvent]);
      es.addEventListener("end", (m) => {
        setHandle(JSON.parse((m as MessageEvent).data as string) as RunHandle);
        setPhase("ended");
        es.close();
        onFinished();
      });
      es.onerror = () => {
        es.close();
        setPhase("ended");
      };
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("ready");
    }
  }, [planned, task, onFinished]);

  const cancel = useCallback(async () => {
    if (!handle) return;
    await fetch(`/api/runs/${handle.id}`, { method: "DELETE" });
  }, [handle]);

  const ack = planned?.ack;

  return (
    <section aria-label="运行控制" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">跑一次</h2>
        {phase === "running" && <Badge variant="outline">进行中</Badge>}
        {phase === "ended" && handle && <Badge variant="outline">{handle.status}</Badge>}
        <div className="ml-auto flex gap-2">
          {phase !== "running" && (
            <Button size="sm" variant="outline" onClick={fetchPlan} disabled={phase === "planning"}>
              {phase === "planning" ? "读取中…" : "看看要花多少"}
            </Button>
          )}
          {phase === "ready" && ack && (
            <Button size="sm" onClick={start}>
              确认这些数字，开跑
            </Button>
          )}
          {phase === "running" && (
            <Button size="sm" variant="outline" onClick={cancel}>
              取消
            </Button>
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
        <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-border bg-background p-3 text-[11px] leading-relaxed">
          {events.map(line).join("\n")}
        </pre>
      )}

      {phase === "ended" && handle?.error && <p className="mt-2 text-xs text-bad">{handle.error}</p>}
    </section>
  );
}
