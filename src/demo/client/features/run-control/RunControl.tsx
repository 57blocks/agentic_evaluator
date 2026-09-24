/**
 * The two-step button: read what a run would cost, then confirm those exact
 * numbers. `useRun` holds the state machine; this file is what it looks like.
 */

import { cn } from "@/lib/utils";
import { SECTION_CARD, SECTION_TITLE } from "@/components/section-style";
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
    <section aria-label="Run control" className={cn(SECTION_CARD, "border border-border bg-card p-4")}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={SECTION_TITLE}>Run it</h2>
        {phase === "running" && <Tag tone="brand">Running</Tag>}
        {phase === "ended" && handle && <Tag tone={handle.status === "done" ? "ok" : handle.status === "failed" ? "bad" : "warn"}>{handle.status}</Tag>}
        <div className="ml-auto flex gap-2">
          {phase !== "running" && (
            <Button size="sm" variant="outline" onClick={fetchPlan} disabled={phase === "planning"}>
              {phase === "planning" ? "Reading…" : "See what it would cost"}
            </Button>
          )}
          {phase === "ready" && ack && (
            <Button size="sm" onClick={start}>Confirm these numbers and run</Button>
          )}
          {phase === "running" && (
            <Button size="sm" variant="outline" onClick={cancel}>Cancel</Button>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-bad">{error}</p>}

      {ack && phase !== "running" && (
        <p className="mt-2 text-xs text-muted-foreground">
          {ack.generations} generation(s) · {ack.judgeCalls} judge call(s) · {ack.scoreCalls} score call(s) ·{" "}
          {ack.budgetUsd === null ? "no budget declared" : `budget cap $${ack.budgetUsd}`}
          <span className="block">
            These numbers are sent back with the request; the server recomputes them and refuses to start if they differ.
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
