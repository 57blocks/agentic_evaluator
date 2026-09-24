import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BoardPage } from "./BoardPage";
import { NewTaskPage } from "./NewTaskPage";
import { TaskDetailPage } from "./TaskDetailPage";
import { MembersPage } from "./MembersPage";
import * as tasksApi from "../api/tasks";
import * as membersApi from "../api/members";

vi.mock("../api/tasks");
vi.mock("../api/members");

const MEMBERS = [
  { id: "m1", name: "小美" },
  { id: "m2", name: "小刚" },
];

function makeTask(overrides: {
  id?: string;
  title?: string;
  description?: string;
  assigneeId?: string | null;
  status?: "todo" | "in_progress" | "done";
}) {
  return {
    id: overrides.id ?? `t-${Math.random()}`,
    title: overrides.title ?? "任务",
    description: overrides.description ?? "",
    assigneeId: overrides.assigneeId ?? null,
    status: overrides.status ?? "todo",
  };
}

function renderBoard() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <BoardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(membersApi.fetchMembers).mockResolvedValue(MEMBERS);
});

describe("BoardPage", () => {
  it("renders a newly fetched todo task as a card, with card count matching todo tasks (AC-02)", async () => {
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([
      makeTask({ id: "t1", title: "写周报", status: "todo" }),
      makeTask({ id: "t2", title: "已有任务", status: "todo" }),
    ]);
    renderBoard();

    const todoColumn = await screen.findByTestId("todo-column");
    const cards = within(todoColumn).getAllByTestId("task-card");
    expect(cards).toHaveLength(2);
    expect(within(todoColumn).getByText("写周报")).toBeInTheDocument();
  });

  it("moves a card from in-progress to done once the advance action succeeds (AC-07)", async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([
      makeTask({ id: "t1", title: "标记完成", status: "in_progress" }),
    ]);
    vi.mocked(tasksApi.transitionTask).mockResolvedValue(
      makeTask({ id: "t1", title: "标记完成", status: "done" }),
    );
    renderBoard();

    const inProgressColumn = await screen.findByTestId("in-progress-column");
    await user.click(within(inProgressColumn).getByTestId("task-card-advance-button"));

    await user.click(screen.getByTestId("show-completed-toggle"));
    const doneColumn = await screen.findByTestId("done-column");
    expect(within(doneColumn).getByText("标记完成")).toBeInTheDocument();
    expect(within(screen.getByTestId("in-progress-column")).queryByText("标记完成")).not.toBeInTheDocument();
  });

  it("shows no done cards on first load before the show-completed toggle is used (AC-08)", async () => {
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([
      makeTask({ id: "t1", title: "已完成任务", status: "done" }),
      makeTask({ id: "t2", title: "待办任务", status: "todo" }),
    ]);
    renderBoard();

    await screen.findByTestId("todo-column");
    expect(screen.queryByTestId("done-column")).not.toBeInTheDocument();
    expect(screen.queryByText("已完成任务")).not.toBeInTheDocument();
  });

  it("shows the empty-state message and no column skeletons when there are no tasks (AC-09)", async () => {
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([]);
    renderBoard();

    expect(await screen.findByTestId("board-empty")).toHaveTextContent(
      "还没有任务，点击「新建任务」开始",
    );
    expect(screen.queryByTestId("board-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("todo-column")).not.toBeInTheDocument();
  });

  it("shows only the selected assignee's cards once filtered (AC-11)", async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([
      makeTask({ id: "t1", title: "小美的任务", status: "todo", assigneeId: "m1" }),
      makeTask({ id: "t2", title: "小刚的任务", status: "todo", assigneeId: "m2" }),
    ]);
    renderBoard();

    await screen.findByText("小美的任务");
    await user.selectOptions(screen.getByTestId("assignee-filter-select"), "m1");

    expect(screen.getByText("小美的任务")).toBeInTheDocument();
    expect(screen.queryByText("小刚的任务")).not.toBeInTheDocument();
  });

  it("highlights the current member's cards without changing the assignee filter", async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([
      makeTask({ id: "t1", title: "小美的任务", status: "todo", assigneeId: "m1" }),
      makeTask({ id: "t2", title: "小刚的任务", status: "todo", assigneeId: "m2" }),
    ]);
    renderBoard();

    await screen.findByText("小美的任务");
    await user.selectOptions(screen.getByTestId("current-member-select"), "m1");

    expect(screen.getByText("小美的任务")).toBeInTheDocument();
    expect(screen.getByText("小刚的任务")).toBeInTheDocument();
    expect(screen.getByTestId("assignee-filter-select")).toHaveValue("");

    const highlightedCard = screen.getByText("小美的任务").closest("article");
    expect(highlightedCard).toHaveStyle({ border: "2px solid #2563eb" });
  });

  it("toggles the done column locally without refetching tasks (IC-04)", async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([
      makeTask({ id: "t1", title: "已完成任务", status: "done" }),
      makeTask({ id: "t2", title: "待办任务", status: "todo" }),
    ]);
    renderBoard();

    await screen.findByTestId("todo-column");
    expect(tasksApi.fetchTasks).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("show-completed-toggle"));
    const doneColumn = await screen.findByTestId("done-column");
    expect(within(doneColumn).getByText("已完成任务")).toBeInTheDocument();

    await user.click(screen.getByTestId("show-completed-toggle"));
    expect(screen.queryByTestId("done-column")).not.toBeInTheDocument();

    expect(tasksApi.fetchTasks).toHaveBeenCalledTimes(1);
  });

  it("shows 未分配 as the assignee on a card whose assigneeId is null (AC-13)", async () => {
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([
      makeTask({ id: "t1", title: "无主任务", status: "todo", assigneeId: null }),
    ]);
    renderBoard();

    const card = await screen.findByTestId("task-card");
    expect(within(card).getByText("未分配")).toBeInTheDocument();
  });

  it("navigates to task detail when a task card is clicked (IC-05)", async () => {
    const user = userEvent.setup();
    const task = makeTask({ id: "t1", title: "打开详情", status: "todo" });
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([task]);
    vi.mocked(tasksApi.fetchTask).mockResolvedValue(task);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const card = await screen.findByTestId("task-card");
    await user.click(card);

    expect(await screen.findByTestId("task-detail-back-link")).toBeInTheDocument();
  });

  it("navigates to /tasks/new when 新建任务 is clicked (IC-02)", async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/tasks/new" element={<NewTaskPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByTestId("board-empty");
    await user.click(screen.getByTestId("new-task-button"));

    expect(await screen.findByTestId("new-task-title-input")).toBeInTheDocument();
  });

  it("navigates to /members when 成员管理 is clicked (IC-07)", async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.fetchTasks).mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<BoardPage />} />
          <Route path="/members" element={<MembersPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByTestId("members-link"));

    expect(await screen.findByTestId("members-back-link")).toBeInTheDocument();
  });
});
