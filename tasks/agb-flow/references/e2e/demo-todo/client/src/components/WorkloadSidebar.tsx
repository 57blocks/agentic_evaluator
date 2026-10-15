import type { Member } from "../api/members";
import type { Task } from "../api/tasks";

const WORKLOAD_STATUSES: Task["status"][] = ["todo", "in_progress"];

type Props = {
  members: Member[];
  tasks: Task[];
};

export function WorkloadSidebar({ members, tasks }: Props) {
  return (
    <aside>
      <h2>工作量</h2>
      <ul>
        {members.map((member) => {
          const count = tasks.filter(
            (task) => task.assigneeId === member.id && WORKLOAD_STATUSES.includes(task.status),
          ).length;
          return (
            <li key={member.id} data-testid="workload-item" data-member-id={member.id}>
              {member.name}：{count}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
