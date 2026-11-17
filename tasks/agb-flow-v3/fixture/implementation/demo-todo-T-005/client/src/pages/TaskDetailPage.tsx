import { useEffect, useState, type ChangeEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchMembers, type Member } from "../api/members";
import { fetchTask, updateTask, type Task, type UpdateTaskInput } from "../api/tasks";

type LoadState = "loading" | "not-found" | "error" | "ready";
type EditableField = "title" | "description" | "assigneeId";

const NOT_FOUND_MESSAGE = "任务不存在";
const UNASSIGNED_VALUE = "";

const STATUS_LABEL: Record<Task["status"], string> = {
  todo: "待办",
  in_progress: "进行中",
  done: "已完成",
};

export function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();

  const [task, setTask] = useState<Task | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [savingField, setSavingField] = useState<EditableField | null>(null);
  const [savedField, setSavedField] = useState<EditableField | null>(null);
  const [fieldError, setFieldError] = useState("");

  useEffect(() => {
    if (!taskId) return;
    let isCancelled = false;
    Promise.all([fetchTask(taskId), fetchMembers()])
      .then(([fetchedTask, fetchedMembers]) => {
        if (isCancelled) return;
        setTask(fetchedTask);
        setTitle(fetchedTask.title);
        setDescription(fetchedTask.description);
        setMembers(fetchedMembers);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (isCancelled) return;
        if (error instanceof Error && error.message === NOT_FOUND_MESSAGE) {
          setLoadState("not-found");
          return;
        }
        setLoadError(error instanceof Error ? error.message : "加载失败");
        setLoadState("error");
      });
    return () => {
      isCancelled = true;
    };
  }, [taskId]);

  async function saveField(field: EditableField, patch: UpdateTaskInput, revert: () => void) {
    if (!taskId) return;
    setSavingField(field);
    setSavedField(null);
    setFieldError("");
    try {
      const updated = await updateTask(taskId, patch);
      setTask(updated);
      setSavedField(field);
    } catch (error: unknown) {
      revert();
      setFieldError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSavingField(null);
    }
  }

  function handleTitleBlur() {
    const trimmed = title.trim();
    if (!task || trimmed === task.title) return;
    saveField("title", { title: trimmed }, () => setTitle(task.title));
  }

  function handleDescriptionBlur() {
    if (!task || description === task.description) return;
    saveField("description", { description }, () => setDescription(task.description));
  }

  function handleAssigneeChange(event: ChangeEvent<HTMLSelectElement>) {
    if (!task) return;
    const nextAssigneeId = event.target.value === UNASSIGNED_VALUE ? null : event.target.value;
    const previousAssigneeId = task.assigneeId;
    setTask({ ...task, assigneeId: nextAssigneeId });
    saveField("assigneeId", { assigneeId: nextAssigneeId }, () =>
      setTask((current) => (current ? { ...current, assigneeId: previousAssigneeId } : current)),
    );
  }

  if (loadState === "loading") {
    return <div>加载中…</div>;
  }

  if (loadState === "not-found") {
    return (
      <div data-testid="task-detail-not-found">
        {NOT_FOUND_MESSAGE}
        <Link to="/" data-testid="task-detail-back-link">
          返回看板
        </Link>
      </div>
    );
  }

  if (loadState === "error" || !task) {
    return <div>{loadError}</div>;
  }

  return (
    <div>
      <Link to="/" data-testid="task-detail-back-link">
        返回看板
      </Link>

      <span data-testid="task-detail-status-badge">{STATUS_LABEL[task.status]}</span>

      {fieldError && <div>{fieldError}</div>}
      {savingField && <span data-testid="task-detail-saving-indicator">保存中…</span>}
      {!savingField && savedField && <span data-testid="task-detail-saving-indicator">已保存</span>}

      <input
        data-testid="task-detail-title-input"
        value={title}
        disabled={savingField === "title"}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={handleTitleBlur}
      />

      <textarea
        data-testid="task-detail-description-textarea"
        value={description}
        disabled={savingField === "description"}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={handleDescriptionBlur}
      />

      <select
        data-testid="task-detail-assignee-select"
        value={task.assigneeId ?? UNASSIGNED_VALUE}
        disabled={savingField === "assigneeId"}
        onChange={handleAssigneeChange}
      >
        <option value={UNASSIGNED_VALUE}>未分配</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
    </div>
  );
}
