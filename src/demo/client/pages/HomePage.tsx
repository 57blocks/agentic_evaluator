/**
 * The landing page: how much this workspace has measured, the tasks to open,
 * and each step's latest conclusion.
 */

import { cn } from "@/lib/utils";
import { SECTION_CARD, SECTION_TITLE } from "@/components/section-style";
import { Tag } from "@/components/tag";
import type { Overview, StepStanding } from "../../../server/overview.js";
import type { Catalog } from "@/app/useWorkspace";
import { TaskList } from "@/features/task-list/TaskList";
import { BrokenSpecs } from "@/features/task-list/BrokenSpecs";
import { navigate } from "@/app/routes";
import { NEEDS_REVIEW, SELF_CHECK } from "@/lib/copy";
import { FIRMNESS_LABEL } from "../../../report-copy.js";
import { runDate, runMoney } from "@/lib/format";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={cn(SECTION_CARD, "border border-border bg-card px-4 py-3.5")}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <b className="mt-1 block text-2xl font-bold tracking-tight tabular-nums">{value}</b>
      {hint && <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function StepRow({ standing }: { standing: StepStanding }) {
  const gate =
    standing.eligible.length > 0 || standing.gated.length > 0
      ? `${standing.eligible.length} eligible / ${standing.gated.length} gated out`
      : "—";
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{standing.step}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{standing.task ?? "—"}</TableCell>
      <TableCell>
        {standing.chosen ? (
          <span className="font-mono text-xs font-semibold text-brand">{standing.chosen}</span>
        ) : (
          <Tag tone="bad">{NEEDS_REVIEW}</Tag>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{FIRMNESS_LABEL[standing.firmness as keyof typeof FIRMNESS_LABEL] ?? standing.firmness}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{gate}</TableCell>
      <TableCell className="text-right text-xs tabular-nums">
        {runMoney(standing.ledgerTotal) || "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{runDate(standing.startedAt)}</TableCell>
      <TableCell>
        <button
          type="button"
          onClick={() => navigate({ view: "run", runId: standing.runId })}
          className="text-xs underline underline-offset-2"
        >
          Open
        </button>
        {standing.synthetic && (
          <Tag tone="neutral" className="ml-2 text-[10px]">{SELF_CHECK}</Tag>
        )}
      </TableCell>
    </TableRow>
  );
}

function Standings({ steps }: { steps: StepStanding[] }) {
  return (
    <section aria-label="Latest verdict per step" className={cn(SECTION_CARD, "border border-border bg-card p-4")}>
      <h2 className={cn(SECTION_TITLE, "mb-1")}>Latest verdict per step</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Only the latest run of each step name is kept, whichever task it came from.
      </p>
      {steps.length === 0 ? (
        <p className="text-xs text-muted-foreground">No runs yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Step</TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Chosen</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Eligibility gates</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead>Date</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {steps.map((s) => (
                <StepRow key={`${s.runId}:${s.step}`} standing={s} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

export function HomePage({ data, catalog }: { data: Overview; catalog: Catalog }) {
  const { tasksNeverRun, stepsWithNoChoice } = data.unobserved;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Workspace</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{data.workspace}</p>
      </header>

      <section aria-label="Overview" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Tasks" value={`${data.tasks.run} / ${data.tasks.total}`} hint="run / defined" />
        <Stat label="Runs" value={String(data.spend.runs)} hint="all in this workspace" />
        <Stat
          label="Total spend"
          value={runMoney(data.spend.totalUsd) || "—"}
          hint="sum over runs that reported a ledger"
        />
        <Stat
          label="No verdict"
          value={String(tasksNeverRun.length + stepsWithNoChoice.length)}
          hint="tasks never run + steps with no recommendation"
        />
      </section>

      <BrokenSpecs broken={catalog.broken ?? []} />
      <TaskList tasks={catalog.tasks} />
      <Standings steps={data.steps} />
    </div>
  );
}
