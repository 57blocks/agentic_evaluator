import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import * as tasksApi from "./api/tasks";
import * as membersApi from "./api/members";

// Covers the cross-page seam that per-page unit tests can't reach: after
// navigating back to the board, does it show fresh data or a stale cache?
vi.mock("./api/tasks");
vi.mock("./api/members");

const MEMBERS = [
  { id: "m1", name: "小美" },
  { id: "m2", name: "小刚" },
];

function makeTask(overrides: {
  id?: string;
  title?: string;
  assigneeId?: string | null;
  status?: "todo" | "in_progress" | "done";
}) {
  return {
    id: overrides.id ?? `t-${Math.random()}`,
    title: overrides.title ?? "任务",
    description: "",
    assigneeId: overrides.assigneeId ?? null,
    status: overrides.status ?? "todo",
  };
}

beforeEach(() => {
  vi.mocked(membersApi.fetchMembers).mockResolvedValue(MEMBERS);
});

describe("App (cross-page navigation)", () => {
  it("shows the newly created task in the todo column after returning to the board (AC-02)", async () => {
    const user = userEvent.setup();
    const existing = makeTask({ id: "t0", title: "已有任务", status: "todo" });
    const created = makeTask({ id: "t1", title: "写周报", status: "todo" });

    vi.mocked(tasksApi.fetchTasks)
      .mockResolvedValueOnce([existing])
      .mockResolvedValue([existing, created]);
    vi.mocked(tasksApi.createTask).mockResolvedValue(created);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    await screen.findByText("已有任务");
    await user.click(screen.getByTestId("new-task-button"));

    await user.type(await screen.findByTestId("new-task-title-input"), "写周报");
    await user.click(screen.getByTestId("new-task-submit-button"));

    const todoColumn = await screen.findByTestId("todo-column");
    await waitFor(() => {
      expect(within(todoColumn).getByText("写周报")).toBeInTheDocument();
    });
  });

  it("reflects a reassignment in the workload sidebar after returning to the board (AC-05)", async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: "t1", title: "改派任务", status: "todo", assigneeId: "m1" });
    const reassigned = { ...task, assigneeId: "m2" };

    vi.mocked(tasksApi.fetchTasks)
      .mockResolvedValueOnce([task])
      .mockResolvedValue([reassigned]);
    vi.mocked(tasksApi.fetchTask).mockResolvedValue(task);
    vi.mocked(tasksApi.updateTask).mockResolvedValue(reassigned);

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );

    const card = await screen.findByTestId("task-card");
    await user.click(card);

    const assigneeSelect = await screen.findByTestId("task-detail-assignee-select");
    await user.selectOptions(assigneeSelect, "m2");

    await user.click(await screen.findByTestId("task-detail-back-link"));

    await waitFor(() => {
      const m1 = screen.getAllByTestId("workload-item").find((el) => el.dataset.memberId === "m1");
      const m2 = screen.getAllByTestId("workload-item").find((el) => el.dataset.memberId === "m2");
      expect(m1).toHaveTextContent("0");
      expect(m2).toHaveTextContent("1");
    });
  });
});
