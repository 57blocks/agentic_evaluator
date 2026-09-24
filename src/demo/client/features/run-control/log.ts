/**
 * One line per run event — the same wording the terminal prints.
 *
 * The dashboard and the CLI read the same event stream, so they say the same
 * things about it. A skipped trial, a budget stop and a cancelled run each
 * get their own sentence rather than a generic "failed", because the run is
 * incomplete for a different reason in each case.
 */

import type { RunEvent } from "../../../../core/events.js";

export function eventLine(event: RunEvent): string {
  switch (event.type) {
    case "step.planned":
      return `▶ ${event.plan.step} — ${event.plan.generations} 次生成`;
    case "phase":
      return `▶ ${event.phase}${event.declared ? "" : " — 规格里没声明，不跑"}`;
    case "trial":
      return trialLine(event);
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

function trialLine(event: Extract<RunEvent, { type: "trial" }>): string {
  const who = `${event.candidate} · ${event.input} · t${event.trial}`;
  if (event.reusedFrom) return `  复用 ${who}`;
  if (event.state === "skipped") return `  跳过 ${who} — 预算到顶`;
  const check = event.check ? ` · 检查 ${event.check}` : "";
  const error = event.error ? `: ${event.error}` : "";
  return `  ${event.state} ${who}${check}${error}`;
}
