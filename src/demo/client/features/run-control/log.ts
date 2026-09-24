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
      return `▶ ${event.plan.step} — ${event.plan.generations} generation(s)`;
    case "phase":
      return `▶ ${event.phase}${event.declared ? "" : " — not declared in the spec, skipped"}`;
    case "trial":
      return trialLine(event);
    case "judge":
      return `  judge ${event.a} vs ${event.b} · ${event.input}${event.ok ? "" : ` — failed: ${event.error ?? ""}`}`;
    case "score":
      return `  score ${event.candidate} · ${event.input} · t${event.trial}${event.ok ? "" : ` — failed: ${event.error ?? ""}`}`;
    case "budget.stopped":
      return `⚠ Budget reached at $${event.spentUsd.toFixed(4)}; this run is incomplete`;
    case "run.cancelled":
      return `⚠ Cancelled: ${event.step} dispatched ${event.dispatched}, ${event.skipped} never started`;
    case "integrity.gaps":
      return `⚠ The trace has ${event.gaps} long gap(s); this run's durations are unreliable`;
    case "step.done":
      return `✔ ${event.step} — ${event.trials} trial(s), ledger $${event.ledgerTotal.toFixed(4)}, recommended ${event.chosen ?? "none"} (${event.firmness})`;
    case "e2e.arm.start":
      return `▶ ${event.armId}`;
    case "e2e.arm.done":
      return `✔ ${event.armId}: ${event.success} success / ${event.failure} failure / ${event.undetermined} undetermined`;
    case "e2e.validated":
      return `✔ End-to-end validation: ${event.verdict} (${event.firmness}) — ${event.reason}`;
    case "run.done":
      return `✔ Done — total $${event.totalUsd.toFixed(4)}`;
    case "preview.only":
      return "Preview only.";
    case "workflow.planned":
      return `▶ End to end: ${event.e2e.chain.join(" → ")}, ${event.e2e.perArm} generation(s) per arm`;
  }
}

function trialLine(event: Extract<RunEvent, { type: "trial" }>): string {
  const who = `${event.candidate} · ${event.input} · t${event.trial}`;
  if (event.reusedFrom) return `  reused ${who}`;
  if (event.state === "skipped") return `  skipped ${who} — budget reached`;
  const check = event.check ? ` · check ${event.check}` : "";
  const error = event.error ? `: ${event.error}` : "";
  return `  ${event.state} ${who}${check}${error}`;
}
