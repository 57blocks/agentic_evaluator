import type { Task } from "../api/tasks";

const UNASSIGNED_LABEL = "未分配";

type Props = {
  task: Task;
  assigneeName: string | null;
  onSelect: (taskId: string) => void;
  isHighlighted?: boolean;
};

export function TaskCard({ task, assigneeName, onSelect, isHighlighted = false }: Props) {
  return (
    <article
      data-testid="task-card"
      data-task-id={task.id}
      onClick={() => onSelect(task.id)}
      style={isHighlighted ? { border: "2px solid #2563eb" } : undefined}
    >
      <h3>{task.title}</h3>
      <span>{assigneeName ?? UNASSIGNED_LABEL}</span>
    </article>
  );
}
