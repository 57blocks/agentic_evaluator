/**
 * A run in progress, as bars rather than a scrolling log: every planned step
 * (and end-to-end arm) with generations, judging and scoring against their
 * planned totals, failures in red, and the step being worked on marked.
 *
 * The state is the same fold the terminal's live view uses
 * (`src/cli/progress.ts`) over the same event stream, so the two cannot count
 * a run differently.
 */

import { useEffect, useMemo, useState } from "react";
import type { RunEvent } from "../../../../core/events.js";
import { countsFor, initialProgress, reduceProgress, type Progress, type Tally } from "../../../../cli/progress.js";
import { cn } from "@/lib/utils";

const TICK_MS = 1000;

/** Planned steps first, in order, then any e2e arms as they start. */
function rowKeys(p: Progress): string[] {
  const planned = Object.keys(p.plans);
  const arms = Object.keys(p.counts).filter((k) => !planned.includes(k));
  return [...planned, ...arms];
}

function useElapsed(startedAt: string | null, isRunning: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [isRunning]);
  if (!startedAt) return "";
  const secs = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function Bar({ label, tally, isCurrent }: { label: string; tally: Tally; isCurrent: boolean }) {
  // An end-to-end arm only generates: no plan, nothing done, nothing to draw.
  if (tally.total === null && tally.done === 0 && tally.failed === 0) return <span aria-hidden />;
  if (tally.total === 0) {
    return <span className="text-xs text-muted-foreground">{label} off</span>;
  }
  const pct = tally.total ? Math.min(100, (tally.done / tally.total) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={cn(isCurrent ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</span>
        <span className="font-mono tabular-nums">
          {tally.total === null ? tally.done : `${tally.done}/${tally.total}`}
          {tally.failed > 0 && <span className="text-bad"> · {tally.failed} failed</span>}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", tally.failed > 0 ? "bg-warn" : "bg-brand")}
          style={{ width: `${tally.total === null ? 0 : pct}%` }}
        />
      </div>
    </div>
  );
}

interface Props {
  events: readonly RunEvent[];
  startedAt: string | null;
  isRunning: boolean;
}

export function RunProgress({ events, startedAt, isRunning }: Props) {
  const p = useMemo(() => events.reduce(reduceProgress, initialProgress()), [events]);
  const elapsed = useElapsed(startedAt, isRunning);
  const keys = rowKeys(p);
  if (keys.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {isRunning && p.active ? <>Working on <b className="font-mono text-foreground">{p.active}</b> · {p.phase ?? "generating"}</> : isRunning ? "Starting…" : "Finished"}
        {elapsed && <> · {elapsed}</>}
        {" "}· generation spend <span className="font-mono">${p.spentUsd.toFixed(4)}</span>
      </p>
      <ul className="flex flex-col gap-2">
        {keys.map((key) => {
          const c = countsFor(p, key);
          const isActive = isRunning && key === p.active;
          const phase = isActive ? (p.phase ?? "generating") : null;
          return (
            <li
              key={key}
              className={cn(
                "grid gap-3 border border-border px-3 py-2.5 sm:grid-cols-[10rem_1fr_1fr_1fr] sm:items-center",
                isActive && "border-brand/50 bg-brand-soft",
              )}
            >
              <span className="flex items-center gap-2 font-mono text-xs font-semibold">
                {isActive && <span aria-hidden className="size-2 animate-pulse rounded-full bg-brand" />}
                {key}
              </span>
              <Bar label="generations" tally={c.generations} isCurrent={phase === "generating"} />
              <Bar label="judging" tally={c.judging} isCurrent={phase === "judging"} />
              <Bar label="scoring" tally={c.scoring} isCurrent={phase === "scoring"} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
