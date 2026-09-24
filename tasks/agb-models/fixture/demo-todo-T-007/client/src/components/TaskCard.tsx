import type { Task } from "../api/tasks";

const UNASSIGNED_LABEL = "未分配";

type Props = {
  task: Task;
  assigneeName: string | null;
  onSelect: (taskId: string) => void;
};

export function TaskCard({ task, assigneeName, onSelect }: Props) {
  return (
    <article
      data-testid="task-card"
      data-task-id={task.id}
      onClick={() => onSelect(task.id)}
    >
      <h3>{task.title}</h3>
      <span>{assigneeName ?? UNASSIGNED_LABEL}</span>
    </article>
  );
}
