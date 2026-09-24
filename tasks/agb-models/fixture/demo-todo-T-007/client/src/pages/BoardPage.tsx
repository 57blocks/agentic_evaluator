import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TaskCard } from "../components/TaskCard";
import { fetchMembers, type Member } from "../api/members";
import { fetchTasks, type Task } from "../api/tasks";

type LoadState = "loading" | "error" | "ready";

const VISIBLE_COLUMNS: { status: Task["status"]; label: string; testId: string }[] = [
  { status: "todo", label: "待办", testId: "todo-column" },
  { status: "in_progress", label: "进行中", testId: "in-progress-column" },
];

export function BoardPage() {
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let isCancelled = false;
    Promise.all([fetchTasks(), fetchMembers()])
      .then(([fetchedTasks, fetchedMembers]) => {
        if (isCancelled) return;
        setTasks(fetchedTasks);
        setMembers(fetchedMembers);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (isCancelled) return;
        setLoadError(error instanceof Error ? error.message : "加载失败");
        setLoadState("error");
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  const memberNameById = new Map(members.map((member) => [member.id, member.name]));

  return (
    <div>
      <h1>看板</h1>
      <div>
        <button type="button" data-testid="new-task-button" onClick={() => navigate("/tasks/new")}>
          新建任务
        </button>
        <Link to="/members" data-testid="members-link">
          成员管理
        </Link>
      </div>

      {loadState === "loading" && <div data-testid="board-loading">加载中…</div>}

      {loadState === "error" && <div data-testid="board-error">{loadError}</div>}

      {loadState === "ready" && tasks.length === 0 && (
        <div data-testid="board-empty">还没有任务，点击「新建任务」开始</div>
      )}

      {loadState === "ready" && tasks.length > 0 && (
        <div>
          {VISIBLE_COLUMNS.map((column) => (
            <section key={column.status} data-testid={column.testId}>
              <h2>{column.label}</h2>
              {tasks
                .filter((task) => task.status === column.status)
                .map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    assigneeName={task.assigneeId ? (memberNameById.get(task.assigneeId) ?? null) : null}
                    onSelect={(taskId) => navigate(`/tasks/${taskId}`)}
                  />
                ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
