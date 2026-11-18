import type { Task } from "../api/tasks";

type TaskStatus = Task["status"];

interface Transition {
  to: TaskStatus;
  label: string;
}

const TRANSITIONS_BY_STATUS: Record<TaskStatus, Transition[]> = {
  todo: [{ to: "in_progress", label: "开始处理" }],
  in_progress: [
    { to: "todo", label: "退回待办" },
    { to: "done", label: "标记完成" },
  ],
  done: [],
};

type Props = {
  status: TaskStatus;
  onTransition: (to: TaskStatus) => void;
  disabled?: boolean;
};

export function TransitionButtons({ status, onTransition, disabled = false }: Props) {
  const transitions = TRANSITIONS_BY_STATUS[status];

  return (
    <>
      {transitions.map((transition) => (
        <button
          key={transition.to}
          type="button"
          data-testid="task-detail-transition-button"
          data-transition-to={transition.to}
          disabled={disabled}
          onClick={() => onTransition(transition.to)}
        >
          {transition.label}
        </button>
      ))}
    </>
  );
}
