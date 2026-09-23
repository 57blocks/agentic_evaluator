/** Task tree: one row per task, its runs nested newest-first underneath. */

import type { RunView, TaskView } from "../../catalog.js";
import { isSmokeTask, latestLabel, runMeta, spendLabel } from "../render.js";
import { cn } from "@/lib/utils";

interface Props {
  tasks: TaskView[];
  unfiled: RunView[];
  selected: string | null;
  /** True when the cross-run overview is showing rather than a task or run. */
  home: boolean;
  onSelectTask: (task: TaskView) => void;
  onSelectRun: (run: RunView) => void;
  onSelectHome: () => void;
}

function TaskItem({ task, selected, onSelectTask, onSelectRun }: {
  task: TaskView;
  selected: string | null;
  onSelectTask: (t: TaskView) => void;
  onSelectRun: (r: RunView) => void;
}) {
  const spend = spendLabel(task);
  return (
    <li className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onSelectTask(task)}
        aria-current={selected === task.specPath ? "true" : undefined}
        className={cn(
          "w-full rounded-lg border border-transparent px-2.5 py-2 text-left",
          "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
          "aria-[current]:border-border aria-[current]:bg-accent",
        )}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-xs">{task.name}</span>
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            {task.runs.length} 次{" "}
            {spend && (
              <span className={cn(spend.over && "font-semibold text-bad")}>{spend.text}</span>
            )}
          </span>
        </span>
        <span className="block text-xs text-muted-foreground">{latestLabel(task)}</span>
      </button>

      {task.runs.length > 0 && (
        <ul className="ml-2.5 flex flex-col gap-0.5 border-l border-border pl-2">
          {task.runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onSelectRun(run)}
                aria-current={selected === run.id ? "true" : undefined}
                className={cn(
                  "w-full rounded-md border border-transparent px-2 py-1 text-left",
                  "text-[11px] text-muted-foreground",
                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                  "aria-[current]:border-border aria-[current]:bg-accent",
                )}
              >
                {runMeta(run)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Sidebar({ tasks, unfiled, selected, home, onSelectTask, onSelectRun, onSelectHome }: Props) {
  const smoke = tasks.filter(isSmokeTask);
  const real = tasks.filter((t) => !isSmokeTask(t));

  const section = (label: string, items: TaskView[]) =>
    items.length > 0 && (
      <nav aria-label={label}>
        <h2 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h2>
        <ul className="flex flex-col gap-1">
          {items.map((t) => (
            <TaskItem
              key={t.specPath}
              task={t}
              selected={selected}
              onSelectTask={onSelectTask}
              onSelectRun={onSelectRun}
            />
          ))}
        </ul>
      </nav>
    );

  return (
    <aside className="flex flex-col gap-1 overflow-y-auto border-r border-border bg-card p-4">
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
          Agent Evaluation Protocol v0.4
        </p>
        <h1 className="text-xl font-semibold">这一步该用谁</h1>
        <p className="text-[13px] text-muted-foreground">
          不是模型排行榜。推荐绑定步骤、测试集、运行模式。
        </p>
      </div>

      <button
        type="button"
        onClick={onSelectHome}
        aria-current={home ? "true" : undefined}
        className={cn(
          "mt-1 w-full rounded-lg border border-transparent px-2.5 py-2 text-left text-xs",
          "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
          "aria-[current]:border-border aria-[current]:bg-accent",
        )}
      >
        总览 —— 每一步的最新结论，和还没测的部分
      </button>

      {section("任务", real)}
      {smoke.length > 0 && (
        <>
          {section("冒烟（脚本候选）", smoke)}
          <p className="mt-1 text-xs text-muted-foreground">
            候选是本地脚本，不是模型。用来验证管线，不是证据。
          </p>
        </>
      )}

      {unfiled.length > 0 && (
        <nav aria-label="仓库样例">
          <h2 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            仓库样例
          </h2>
          <ul className="flex flex-col gap-1">
            {unfiled.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => onSelectRun(run)}
                  aria-current={selected === run.id ? "true" : undefined}
                  className={cn(
                    "w-full rounded-lg border border-transparent px-2.5 py-2 text-left",
                    "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                    "aria-[current]:border-border aria-[current]:bg-accent",
                  )}
                >
                  <span className="block font-mono text-xs">{run.runName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {run.sample && "样例 · "}
                    {runMeta(run)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted-foreground">
            committed 的示例证据，不属于任何任务。
          </p>
        </nav>
      )}
    </aside>
  );
}
