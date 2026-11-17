export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: "todo" | "in_progress" | "done";
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  assigneeId?: string | null;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // response had no JSON body
  }
  return "请求失败";
}

export async function fetchTasks(): Promise<Task[]> {
  const response = await fetch("/api/tasks");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const body: { tasks: Task[] } = await response.json();
  return body.tasks;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const response = await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
}
