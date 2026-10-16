export type TaskStatus = "todo" | "in_progress" | "done";

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "done"];

const VALID_TRANSITIONS: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
  ["todo", "in_progress"],
  ["in_progress", "todo"],
  ["in_progress", "done"],
];

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS.some(([validFrom, validTo]) => validFrom === from && validTo === to);
}
