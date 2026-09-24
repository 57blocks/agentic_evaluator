/**
 * A run's report, rendered in the dashboard from the same model report.html
 * is written from, with a button that saves what is on screen as one HTML file.
 */

import { useEffect, useRef, useState } from "react";
import type { ReportModel } from "../../../report-model.js";
import type { RunView } from "../../catalog.js";
import { getJson, reportUrl } from "@/lib/api";
import { StepReport } from "@/features/report/StepReport";
import { WorkflowReport } from "@/features/report/WorkflowReport";
import { downloadHtml, exportName, standaloneHtml } from "@/features/report/export";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; model: ReportModel };

function useReport(dir: string): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    getJson<ReportModel>(reportUrl(dir))
      .then((model) => live && setState({ status: "ready", model }))
      .catch((e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [dir]);
  return state;
}

function titleOf(model: ReportModel): string {
  return model.kind === "workflow"
    ? `${model.record.run_name} 工作流报告`
    : `${model.runName} · ${model.stepId} 运行报告`;
}

function fileOf(model: ReportModel): string {
  return model.kind === "workflow"
    ? exportName([model.record.run_id, "workflow"])
    : exportName([model.dirName, model.stepId]);
}

/** Where report.html sits for this directory, when the run wrote one. */
function offlineHref(run: RunView, dir: string): string | null {
  if (dir === run.dir && run.kind === "workflow") return `/artifact/${dir}/report.html`;
  return run.steps.find((s) => s.dir === dir)?.reportHref ?? null;
}

export function ReportPage({ run, dir }: { run: RunView; dir: string }) {
  const state = useReport(dir);
  const body = useRef<HTMLDivElement>(null);

  if (state.status === "loading") {
    return <Empty><EmptyHeader><EmptyTitle>载入报告…</EmptyTitle></EmptyHeader></Empty>;
  }
  if (state.status === "error") {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>这份报告生成不出来</EmptyTitle>
          <EmptyDescription>{state.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const { model } = state;
  const offline = offlineHref(run, dir);
  const exportIt = () => {
    if (body.current) downloadHtml(standaloneHtml(body.current, titleOf(model)), fileOf(model));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {offline && (
          <Button
            variant="ghost"
            size="sm"
            render={<a href={offline} target="_blank" rel="noopener noreferrer" />}
          >
            原始 report.html
          </Button>
        )}
        <Button size="sm" onClick={exportIt}>导出 HTML</Button>
      </div>
      <div ref={body}>
        {model.kind === "workflow" ? (
          <WorkflowReport report={model} runId={run.id} dir={dir} />
        ) : (
          <StepReport report={model} />
        )}
      </div>
    </div>
  );
}
