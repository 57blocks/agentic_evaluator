/**
 * The shell: one column, one view at a time.
 *
 * All it does is resolve the hash against the catalog and hand the answer to
 * a page. Nothing here fetches evidence, formats a number, or knows what a
 * recommendation is — a view that needs those asks for them itself, which is
 * what keeps this file from growing a little of every page.
 */

import { AppFooter } from "./AppFooter";
import type { RunView, TaskView } from "../../catalog.js";
import { allRuns, useWorkspace, type Catalog } from "./useWorkspace";
import { useRoute, type Route } from "./routes";
import { runStamp } from "@/lib/format";
import { AppHeader, Crumbs, type Crumb } from "./AppHeader";
import { HomePage } from "@/pages/HomePage";
import { TaskPage } from "@/pages/TaskPage";
import { RunPage } from "@/pages/RunPage";
import { ReportPage } from "@/pages/ReportPage";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

function Notice({ title, detail }: { title: string; detail?: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {detail && <EmptyDescription>{detail}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

function Shell({ crumbs, children }: { crumbs: Crumb[]; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-8">
        <Crumbs crumbs={crumbs} />
        <main className="min-w-0">{children}</main>
      </div>
      <AppFooter />
    </div>
  );
}

/** What the last crumb of a report page says: which step, or the workflow above them. */
function reportLabel(run: RunView, dir: string): string {
  if (dir === run.dir && run.kind === "workflow") return "Workflow report";
  const step = run.steps.find((s) => s.dir === dir);
  return `${step?.id ?? "Step"} report`;
}

/** The trail back, built from whatever the route resolved to. */
function crumbsFor(route: Route, task: TaskView | undefined, run: RunView | undefined, catalog: Catalog): Crumb[] {
  if (route.view === "task") return [{ label: task?.name ?? route.specPath }];
  if (route.view !== "run" && route.view !== "report") return [];
  if (!run) return [{ label: route.runId }];
  const owner = run.task ? catalog.tasks.find((t) => t.name === run.task) : undefined;
  const trail: Crumb[] = owner
    ? [{ label: owner.name, route: { view: "task", specPath: owner.specPath } }]
    : [];
  const stamp: Crumb = { label: runStamp(run), route: { view: "run", runId: run.id } };
  return route.view === "report"
    ? [...trail, stamp, { label: reportLabel(run, route.dir) }]
    : [...trail, stamp];
}

export function App() {
  const route = useRoute();
  const { catalog, overview, error, reload } = useWorkspace();

  if (error) return <Shell crumbs={[]}><Notice title="Cannot read this workspace" detail={error} /></Shell>;
  if (!catalog) return <Shell crumbs={[]}><Notice title="Loading…" /></Shell>;

  const task =
    route.view === "task" ? catalog.tasks.find((t) => t.specPath === route.specPath) : undefined;
  const run =
    route.view === "run" || route.view === "report"
      ? allRuns(catalog).find((r) => r.id === route.runId)
      : undefined;

  return (
    <Shell crumbs={crumbsFor(route, task, run, catalog)}>
      {route.view === "home" ? (
        overview ? (
          <HomePage data={overview} catalog={catalog} />
        ) : (
          <Notice title="Loading…" />
        )
      ) : task ? (
        <TaskPage task={task} onRunFinished={reload} />
      ) : run && route.view === "report" ? (
        <ReportPage run={run} dir={route.dir} />
      ) : run ? (
        <RunPage run={run} />
      ) : (
        <Notice
          title="Nothing is at this address any more"
          detail="The task or run may have been deleted. Go back to the overview and pick another."
        />
      )}
    </Shell>
  );
}
