/**
 * A task plan (`{ domains: [{ tasks: [...] }] }`, agb's .ab/tasks.json shape)
 * shown as a plan, not as JSON: what a reviewer compares is how the work was
 * cut — domains, tasks, what depends on what — and the raw file buries that
 * under preamble like `assumptions`. Everything renders as text.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { line, stats, type PlanTask, type TaskPlan } from "./taskPlan";

function TaskRow({ task }: { task: PlanTask }) {
  const [open, setOpen] = useState(false);
  const deps = task.dependsOn ?? [];
  return (
    <li className="border-t first:border-t-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-muted/50">
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.id ?? "—"}</span>
        {task.role && <span className="shrink-0 rounded bg-muted px-1 text-[10px] uppercase text-muted-foreground">{task.role}</span>}
        <span className="min-w-0 flex-1 text-sm">{task.title ?? "(untitled)"}</span>
        <span className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          {deps.length > 0 && <span title={`depends on ${deps.join(", ")}`}>← {deps.join(", ")} · </span>}
          {task.files?.length ?? 0} files{task.estLines !== undefined ? ` · ~${task.estLines} lines` : ""}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 bg-muted/30 px-3 py-2 text-xs">
          {task.description && <p className="whitespace-pre-wrap">{task.description}</p>}
          {(task.acceptanceCriteria?.length ?? 0) > 0 && (
            <div>
              <div className="font-semibold">Acceptance ({task.acceptanceCriteria!.length})</div>
              <ul className="ml-4 list-disc">{task.acceptanceCriteria!.map((a, i) => <li key={i}>{line(a)}</li>)}</ul>
            </div>
          )}
          {(task.files?.length ?? 0) > 0 && (
            <div>
              <div className="font-semibold">Files ({task.files!.length})</div>
              <ul className="ml-4 list-disc font-mono">{task.files!.map((f, i) => <li key={i}>{line(f)}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function TaskPlanView({ plan }: { plan: TaskPlan }) {
  const s = stats(plan);
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span><b>{plan.domains.length}</b> domains</span>
        <span><b>{s.tasks}</b> tasks</span>
        {s.lines > 0 && <span>~<b>{s.lines}</b> lines</span>}
        <span><b>{s.crossDomain}</b> cross-domain deps</span>
      </div>
      {(plan.assumptions?.length ?? 0) > 0 && (
        <details className="rounded border px-2 py-1 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Assumptions ({plan.assumptions!.length})</summary>
          <ul className="ml-4 mt-1 list-disc">{plan.assumptions!.map((a, i) => <li key={i} className="whitespace-pre-wrap">{line(a)}</li>)}</ul>
        </details>
      )}
      {plan.domains.map((d, i) => (
        <section key={d.id ?? i} className="rounded border">
          <header className="flex flex-wrap items-baseline justify-between gap-2 bg-muted/40 px-2 py-1">
            <span className="text-sm font-semibold">
              {d.name ?? d.id}
              {d.name && d.id && d.name !== d.id && <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{d.id}</span>}
            </span>
            <span className={cn("text-xs text-muted-foreground")}>
              {d.tasks.length} tasks{(d.dependsOn?.length ?? 0) > 0 ? ` · after ${d.dependsOn!.join(", ")}` : ""}
            </span>
          </header>
          <ul>{d.tasks.map((t, j) => <TaskRow key={t.id ?? j} task={t} />)}</ul>
        </section>
      ))}
    </div>
  );
}
