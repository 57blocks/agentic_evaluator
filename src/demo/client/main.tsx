/**
 * Dashboard client. Fetches the catalog and the cross-run overview, then
 * renders whatever the hash selects. Typed against the view models the server
 * actually sends, so a shape change there fails the build rather than
 * rendering "undefined".
 *
 * The overview is the landing page, not a task: the first question is what
 * this workspace has and has not measured, and only then which run to open.
 */

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RunView, TaskView } from "../catalog.js";
import type { Overview as OverviewData } from "../../server/overview.js";
import { Sidebar } from "./components/Sidebar";
import { TaskPage } from "./components/TaskPage";
import { RunPage } from "./components/RunPage";
import { Overview } from "./components/Overview";
import { RunControl } from "./components/RunControl";
import { PROTOCOL_QUESTIONS } from "./render.js";
import "./styles.css";

interface Catalog {
  tasks: TaskView[];
  unfiled: RunView[];
}

/** The hash is the address bar: reloads and back both land where you were. */
function useHash(): string {
  const [hash, setHash] = useState(() => location.hash.replace(/^#/, ""));
  useEffect(() => {
    const on = () => setHash(location.hash.replace(/^#/, ""));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const hash = useHash();

  // `reloads` re-reads after a run finishes, so a run started here shows up
  // in the listing without a manual refresh.
  useEffect(() => {
    Promise.all([
      fetch("/api/catalog").then((r) => r.json() as Promise<Catalog>),
      fetch("/api/overview").then((r) => r.json() as Promise<OverviewData>),
    ])
      .then(([c, o]) => {
        setCatalog(c);
        setOverview(o);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [reloads]);

  if (error) return <p className="p-6 text-muted-foreground">加载失败：{error}</p>;
  if (!catalog) return <p className="p-6 text-muted-foreground">载入中…</p>;

  const params = new URLSearchParams(hash);
  const specPath = params.get("spec");
  const runId = params.get("run");
  const home = !specPath && !runId;
  const allRuns = [...catalog.tasks.flatMap((t) => t.runs), ...catalog.unfiled];

  const task = catalog.tasks.find((t) => t.specPath === specPath);
  const run = allRuns.find((r) => r.id === runId);
  const selectTask = (t: TaskView) => { location.hash = `spec=${encodeURIComponent(t.specPath)}`; };
  const selectRun = (r: RunView) => { location.hash = `run=${encodeURIComponent(r.id)}`; };


  return (
    <div className="grid min-h-screen grid-cols-[minmax(240px,300px)_1fr]">
      <Sidebar
        tasks={catalog.tasks}
        unfiled={catalog.unfiled}
        selected={specPath ?? runId}
        onSelectTask={selectTask}
        onSelectRun={selectRun}
        onSelectHome={() => { location.hash = ""; }}
        home={home}
      />
      <main className="flex flex-col gap-4 overflow-x-hidden p-6">
        {home && overview ? (
          <Overview data={overview} onSelectRun={(id) => { location.hash = `run=${encodeURIComponent(id)}`; }} />
        ) : (
          <>
            <section aria-label="协议要回答的四个问题" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {PROTOCOL_QUESTIONS.map(([q, a]) => (
                <div key={q} className="rounded-lg border border-border bg-card p-3">
                  <b className="mb-1 block text-xs text-primary">{q}</b>
                  <span className="text-[13px] text-muted-foreground">{a}</span>
                </div>
              ))}
            </section>
            {task && <RunControl task={task.name} onFinished={() => setReloads((n) => n + 1)} />}
            <section className="rounded-xl border border-border bg-card p-5">
              {task ? (
                <TaskPage task={task} onSelectRun={selectRun} />
              ) : run ? (
                <RunPage run={run} />
              ) : (
                <p className="text-muted-foreground">选左侧一个任务或一次运行。</p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
