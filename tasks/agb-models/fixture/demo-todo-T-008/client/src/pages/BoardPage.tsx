import { useEffect, useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TaskCard } from "../components/TaskCard";
import { WorkloadSidebar } from "../components/WorkloadSidebar";
import { fetchMembers, type Member } from "../api/members";
import { fetchTasks, type Task } from "../api/tasks";

type LoadState = "loading" | "error" | "ready";

const UNFILTERED_VALUE = "";

const BASE_COLUMNS: { status: Task["status"]; label: string; testId: string }[] = [
  { status: "todo", label: "待办", testId: "todo-column" },
  { status: "in_progress", label: "进行中", testId: "in-progress-column" },
];

const DONE_COLUMN: { status: Task["status"]; label: string; testId: string } = {
  status: "done",
  label: "已完成",
  testId: "done-column",
};

export function BoardPage() {
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");

  const [currentMemberId, setCurrentMemberId] = useState(UNFILTERED_VALUE);
  const [assigneeFilterId, setAssigneeFilterId] = useState(UNFILTERED_VALUE);
  const [showCompleted, setShowCompleted] = useState(false);

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
  const columns = showCompleted ? [...BASE_COLUMNS, DONE_COLUMN] : BASE_COLUMNS;
  const visibleTasks = assigneeFilterId
    ? tasks.filter((task) => task.assigneeId === assigneeFilterId)
    : tasks;

  function handleCurrentMemberChange(event: ChangeEvent<HTMLSelectElement>) {
    setCurrentMemberId(event.target.value);
  }

  function handleAssigneeFilterChange(event: ChangeEvent<HTMLSelectElement>) {
    setAssigneeFilterId(event.target.value);
  }

  function handleShowCompletedToggle(event: ChangeEvent<HTMLInputElement>) {
    setShowCompleted(event.target.checked);
  }

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

      <div>
        <label>
          当前成员
          <select
            data-testid="current-member-select"
            value={currentMemberId}
            onChange={handleCurrentMemberChange}
          >
            <option value={UNFILTERED_VALUE}>未选择</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          负责人筛选
          <select
            data-testid="assignee-filter-select"
            value={assigneeFilterId}
            onChange={handleAssigneeFilterChange}
          >
            <option value={UNFILTERED_VALUE}>全部</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          显示已完成
          <input
            type="checkbox"
            data-testid="show-completed-toggle"
            checked={showCompleted}
            onChange={handleShowCompletedToggle}
          />
        </label>
      </div>

      {loadState === "loading" && <div data-testid="board-loading">加载中…</div>}

      {loadState === "error" && <div data-testid="board-error">{loadError}</div>}

      {loadState === "ready" && tasks.length === 0 && (
        <div data-testid="board-empty">还没有任务，点击「新建任务」开始</div>
      )}

      {loadState === "ready" && tasks.length > 0 && (
        <div>
          {columns.map((column) => (
            <section key={column.status} data-testid={column.testId}>
              <h2>{column.label}</h2>
              {visibleTasks
                .filter((task) => task.status === column.status)
                .map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    assigneeName={task.assigneeId ? (memberNameById.get(task.assigneeId) ?? null) : null}
                    onSelect={(taskId) => navigate(`/tasks/${taskId}`)}
                    isHighlighted={currentMemberId !== UNFILTERED_VALUE && task.assigneeId === currentMemberId}
                  />
                ))}
            </section>
          ))}
        </div>
      )}

      {loadState === "ready" && <WorkloadSidebar members={members} tasks={tasks} />}
    </div>
  );
}
