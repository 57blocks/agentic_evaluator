/**
 * Two runs compared: the dashboard face of `agenteval diff`. The server
 * computes the diff (/api/diff/<before>/<after>); an export carries the
 * pairs its run pages link to (client/lib/runs.ts `previousRun`).
 */

import { useEffect, useState } from "react";
import type { RunDirDiff } from "../../../../core/run-diff-pairs.js";
import type { RunView } from "../../../catalog.js";
import { navigate } from "@/app/routes";
import { diffUrl, getJsonResponse } from "@/lib/api";
import { runStamp } from "@/lib/format";
import { isSnapshot } from "@/lib/snapshot";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { StepDiff } from "./StepDiff";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; diff: RunDirDiff };

function useDiff(before: string, after: string): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    getJsonResponse<RunDirDiff>(diffUrl(before, after))
      .then((res) => {
        if (!live) return;
        if (res.ok) setState({ status: "ready", diff: res.body });
        else if (isSnapshot() && res.status === 404) setState({ status: "error", message: "This export carries each run compared with the one before it; this pair is not one of them." });
        else setState({ status: "error", message: res.body.error ?? `HTTP ${res.status}` });
      })
      .catch((e: unknown) => live && setState({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [before, after]);
  return state;
}

function RunLink({ run, label }: { run: RunView; label: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <button type="button" className="font-mono text-sm underline underline-offset-2" onClick={() => navigate({ view: "run", runId: run.id })}>
        {runStamp(run)}
      </button>
    </span>
  );
}

export function DiffPage({ before, after }: { before: RunView; after: RunView }) {
  const state = useDiff(before.id, after.id);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">Compare runs</h1>
          <div className="flex items-end gap-3">
            <RunLink run={before} label="Before" />
            <span className="pb-0.5 text-muted-foreground">→</span>
            <RunLink run={after} label="After" />
          </div>
        </div>
        {!isSnapshot() && (
          <Button variant="outline" size="sm" onClick={() => navigate({ view: "diff", before: after.id, after: before.id })}>
            Swap
          </Button>
        )}
      </header>
      <p className="text-xs text-muted-foreground">
        The same from the command line: <code className="font-mono">agenteval diff {before.id} {after.id}</code>
      </p>
      {state.status === "loading" && <p className="text-sm text-muted-foreground">Comparing…</p>}
      {state.status === "error" && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>These two runs cannot be compared</EmptyTitle>
            <EmptyDescription>{state.message}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {state.status === "ready" && (
        <>
          {state.diff.unmatched.map((u) => (
            <p key={u} className="text-xs text-muted-foreground">Not compared: {u}.</p>
          ))}
          {state.diff.diffs.map((d) => (
            <StepDiff key={`${d.a.step}-${d.b.step}`} d={d} />
          ))}
        </>
      )}
    </div>
  );
}
