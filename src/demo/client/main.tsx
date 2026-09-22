/**
 * Demo UI client. Fetches the catalog once, then renders whatever the hash
 * selects. Typed against the catalog view models the server actually sends,
 * so a shape change there fails the build rather than rendering "undefined".
 */

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RunView, TaskView } from "../catalog.js";
import { Sidebar } from "./components/Sidebar";
import { TaskPage } from "./components/TaskPage";
import { RunPage } from "./components/RunPage";
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
  const [error, setError] = useState<string | null>(null);
  const hash = useHash();

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => r.json() as Promise<Catalog>)
      .then(setCatalog)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="p-6 text-muted-foreground">加载失败：{error}</p>;
  if (!catalog) return <p className="p-6 text-muted-foreground">载入中…</p>;

  const params = new URLSearchParams(hash);
  const specPath = params.get("spec");
  const runId = params.get("run");
  const allRuns = [...catalog.tasks.flatMap((t) => t.runs), ...catalog.unfiled];

  const task = catalog.tasks.find((t) => t.specPath === specPath);
  const run = allRuns.find((r) => r.id === runId);
  const selectTask = (t: TaskView) => { location.hash = `spec=${encodeURIComponent(t.specPath)}`; };
  const selectRun = (r: RunView) => { location.hash = `run=${encodeURIComponent(r.id)}`; };

  // Nothing selected yet: open the newest run, or the first task if none ran.
  if (!task && !run) {
    if (allRuns[0]) selectRun(allRuns[0]);
    else if (catalog.tasks[0]) selectTask(catalog.tasks[0]);
  }

  return (
    <div className="grid min-h-screen grid-cols-[minmax(240px,300px)_1fr]">
      <Sidebar
        tasks={catalog.tasks}
        unfiled={catalog.unfiled}
        selected={specPath ?? runId}
        onSelectTask={selectTask}
        onSelectRun={selectRun}
      />
      <main className="flex flex-col gap-4 overflow-x-hidden p-6">
        <section aria-label="协议要回答的四个问题" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PROTOCOL_QUESTIONS.map(([q, a]) => (
            <div key={q} className="rounded-lg border border-border bg-card p-3">
              <b className="mb-1 block text-xs text-primary">{q}</b>
              <span className="text-[13px] text-muted-foreground">{a}</span>
            </div>
          ))}
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          {task ? (
            <TaskPage task={task} onSelectRun={selectRun} />
          ) : run ? (
            <RunPage run={run} />
          ) : (
            <p className="text-muted-foreground">选左侧一个任务或一次运行。</p>
          )}
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
