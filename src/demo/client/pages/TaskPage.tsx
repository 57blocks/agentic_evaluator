/**
 * A task: what it asks, how it is judged, and every run it produced.
 *
 * The run control sits here rather than in the shell because starting a run
 * is a thing you do *to a task* — there is no such button on a run or on the
 * overview, and a page that showed one would have to invent which task it
 * meant.
 */

import { Tag } from "@/components/tag";
import type { RunView, TaskView } from "../../catalog.js";
import { navigate } from "@/app/routes";
import { NEEDS_REVIEW } from "@/lib/copy";
import { primaryReportDir, runStamp, spendLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { FileBrowser } from "@/features/task-files/FileBrowser";
import { RunControl } from "@/features/run-control/RunControl";
import { TestPlan } from "@/features/test-plan/TestPlan";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { SECTION_CARD, SECTION_TITLE } from "@/components/section-style";

/** Whether the steps hand their output to each other, said in words. */
function handoffLabel(task: TaskView): string {
  const chained = task.steps.some((s) => s.inputFrom);
  return chained
    ? `Evaluated independently, no handoff; e2e control along ${task.steps.map((s) => s.id).join(" → ")}`
    : `${task.steps.length} independent step(s) (no handoff)`;
}

function RunsTable({ runs }: { runs: RunView[] }) {
  if (runs.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>This task has never run</EmptyTitle>
          <EmptyDescription>The definition is in place; run it once to get evidence.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Cost</TableHead>
          <TableHead>Recommended per step</TableHead>
          <TableHead>Type</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="font-mono whitespace-nowrap">
              <button
                type="button"
                onClick={() => navigate({ view: "run", runId: run.id })}
                className="underline underline-offset-2"
              >
                {runStamp(run)}
              </button>
            </TableCell>
            <TableCell className="font-mono whitespace-nowrap">
              {run.totalUsd == null ? "—" : `$${run.totalUsd.toFixed(4)}`}
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-1.5">
                {run.steps.map((s, i) => (
                  <span key={`${s.id}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-muted-foreground">/</span>}
                    {s.chosen ? (
                      <span className="font-mono text-[13px]">{s.chosen}</span>
                    ) : (
                      <Tag tone="bad">{NEEDS_REVIEW}</Tag>
                    )}
                  </span>
                ))}
              </span>
            </TableCell>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {run.kind === "workflow" ? "Multi-step" : "Single step"}
              {run.synthetic && " · script"}
            </TableCell>
            <TableCell className="text-right">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate({ view: "report", runId: run.id, dir: primaryReportDir(run) })}
              >
                Report
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TaskPage({ task, onRunFinished }: { task: TaskView; onRunFinished: () => void }) {
  const spend = spendLabel(task);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold tracking-tight">{task.name}</h1>
        <p className="text-[13px] text-muted-foreground">
          {task.specPath}
          {spend && (
            <>
              {" · spent "}
              <span className={cn(spend.over && "font-semibold text-bad")}>
                {spend.text}
              </span>
            </>
          )}
          {` · ${handoffLabel(task)}`}
        </p>
        <p className="text-xs text-muted-foreground">
          The same from the command line: <code className="font-mono">agenteval plan {task.name}</code> only quotes the cost;{" "}
          <code className="font-mono">agenteval run {task.name} --yes</code> actually runs it.
        </p>
      </header>

      <RunControl task={task.name} onFinished={onRunFinished} />

      <section aria-label="Runs" className={cn(SECTION_CARD, "flex flex-col gap-3 border border-border bg-card p-4")}>
        <h2 className={SECTION_TITLE}>Runs ({task.runs.length})</h2>
        <div className="overflow-x-auto">
          <RunsTable runs={task.runs} />
        </div>
      </section>

      <section aria-label="Test plan" className="flex flex-col gap-3">
        <h2 className={SECTION_TITLE}>Test plan</h2>
        <TestPlan plan={task.plan} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION_TITLE}>Definition files ({task.files.length})</h2>
        <p className="text-xs text-muted-foreground">The test plan above is read from these files; spec.yaml is the single source of truth.</p>
        <FileBrowser task={task.name} files={task.files} definition={task.definition} />
      </section>

    </div>
  );
}
