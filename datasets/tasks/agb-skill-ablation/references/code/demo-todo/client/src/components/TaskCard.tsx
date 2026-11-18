import type { Task } from "../api/tasks";

const UNASSIGNED_LABEL = "未分配";

const NEXT_STATUS: Record<Task["status"], Task["status"] | null> = {
  todo: "in_progress",
  in_progress: "done",
  done: null,
};

const ADVANCE_LABEL: Record<Task["status"], string> = {
  todo: "开始处理",
  in_progress: "标记完成",
  done: "",
};

type Props = {
  task: Task;
  assigneeName: string | null;
  onSelect: (taskId: string) => void;
  onAdvance: (taskId: string, to: Task["status"]) => void;
  isAdvancing?: boolean;
  isHighlighted?: boolean;
};

export function TaskCard({
  task,
  assigneeName,
  onSelect,
  onAdvance,
  isAdvancing = false,
  isHighlighted = false,
}: Props) {
  const nextStatus = NEXT_STATUS[task.status];

  return (
    <article
      data-testid="task-card"
      data-task-id={task.id}
      onClick={() => onSelect(task.id)}
      style={isHighlighted ? { border: "2px solid #2563eb" } : undefined}
    >
      <h3>{task.title}</h3>
      <span>{assigneeName ?? UNASSIGNED_LABEL}</span>
      {nextStatus && (
        <button
          type="button"
          data-testid="task-card-advance-button"
          data-task-id={task.id}
          disabled={isAdvancing}
          onClick={(event) => {
            event.stopPropagation();
            onAdvance(task.id, nextStatus);
          }}
        >
          {isAdvancing ? "处理中…" : ADVANCE_LABEL[task.status]}
        </button>
      )}
    </article>
  );
}
