/**
 * The two-step run: read what a run would cost, then confirm those exact
 * numbers. `useRun` holds the state machine; the page owns it, because the
 * idle state is only a button in the page header and the panel below appears
 * once there is something to show — a plan to confirm, a run in progress, or
 * how the last one ended.
 */

import { cn } from "@/lib/utils";
import { SECTION_CARD, SECTION_TITLE } from "@/components/section-style";
import { Tag } from "@/components/tag";
import type { Run } from "./useRun";
import { eventLine } from "./log";
import { RunProgress } from "./RunProgress";
import { Button } from "@/components/ui/button";

/** The one control on an idle page: read what a run would cost. Hidden while a run is going. */
export function RunButton({ run }: { run: Run }) {
  if (run.phase === "running") return null;
  const label = run.phase === "planning" ? "Reading…" : run.phase === "ended" ? "Run again…" : "Run…";
  return (
    <Button size="sm" onClick={run.fetchPlan} disabled={run.phase === "planning"}>
      {label}
    </Button>
  );
}

/** Whether the panel has anything to say; when it does not, the page shows only the button. */
export function hasRunPanel(run: Run): boolean {
  return run.phase === "ready" || run.phase === "running" || run.phase === "ended" || run.error !== null;
}

export function RunPanel({ run }: { run: Run }) {
  const { phase, ack, handle, events, error, start, cancel, dismiss } = run;
  if (!hasRunPanel(run)) return null;

  return (
    <section aria-label="Run control" className={cn(SECTION_CARD, "border border-border bg-card p-4")}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={SECTION_TITLE}>{phase === "ready" ? "Ready to run" : "Run"}</h2>
        {phase === "running" && <Tag tone="brand">Running</Tag>}
        {phase === "ended" && handle && <Tag tone={handle.status === "done" ? "ok" : handle.status === "failed" ? "bad" : "warn"}>{handle.status}</Tag>}
        <div className="ml-auto flex gap-2">
          {phase === "ready" && ack && <Button size="sm" onClick={start}>Confirm these numbers and run</Button>}
          {phase === "running" && <Button size="sm" variant="outline" onClick={cancel}>Cancel</Button>}
          {phase !== "running" && <Button size="sm" variant="ghost" onClick={dismiss}>Close</Button>}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-bad">{error}</p>}

      {ack && phase === "ready" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {ack.generations} generation(s) · {ack.judgeCalls} judge call(s) · {ack.scoreCalls} score call(s) ·{" "}
          {ack.budgetUsd === null ? "no budget declared" : `budget cap $${ack.budgetUsd}`}
          <span className="block">
            These numbers are sent back with the request; the server recomputes them and refuses to start if they differ.
          </span>
        </p>
      )}

      <RunProgress events={events} startedAt={handle?.startedAt ?? null} isRunning={phase === "running"} />

      {events.length > 0 && (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground select-none">
            <span className="inline-block transition-transform group-open:rotate-90">›</span> Event log ({events.length})
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto border border-border bg-background p-3 text-[11px] leading-relaxed">
            {events.map(eventLine).join("\n")}
          </pre>
        </details>
      )}

      {phase === "ended" && handle?.error && (
        <p className="mt-2 text-xs text-bad">{handle.error}</p>
      )}
    </section>
  );
}
