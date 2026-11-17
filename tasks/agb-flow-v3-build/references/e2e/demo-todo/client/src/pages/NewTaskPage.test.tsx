import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { NewTaskPage } from "./NewTaskPage";
import * as membersApi from "../api/members";
import * as tasksApi from "../api/tasks";

// api/members and api/tasks are the typed HTTP clients from _contracts/api-routes.json;
// mocking them keeps this a frontend-only (unit level) test per DEC-005.
vi.mock("../api/members");
vi.mock("../api/tasks");

const MEMBERS = [
  { id: "m1", name: "小美" },
  { id: "m2", name: "小刚" },
];

function renderNewTaskPage() {
  return render(
    <MemoryRouter initialEntries={["/tasks/new"]}>
      <Routes>
        <Route path="/tasks/new" element={<NewTaskPage />} />
        <Route path="/" element={<div data-testid="board-page-stub" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(membersApi.fetchMembers).mockResolvedValue(MEMBERS);
});

describe("NewTaskPage", () => {
  it("disables the submit button and shows an inline error once title is blurred empty (AC-01)", async () => {
    const user = userEvent.setup();
    renderNewTaskPage();

    const titleInput = await screen.findByTestId("new-task-title-input");
    await user.click(titleInput);
    await user.tab();

    expect(await screen.findByTestId("new-task-title-error")).toHaveTextContent("标题必填");
    expect(screen.getByTestId("new-task-submit-button")).toBeDisabled();
  });

  it("submits the create payload and navigates back to the board on success (AC-02)", async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.createTask).mockResolvedValue({
      id: "t1",
      title: "写周报",
      description: "",
      assigneeId: null,
      status: "todo",
    });
    renderNewTaskPage();

    await user.type(await screen.findByTestId("new-task-title-input"), "写周报");
    await user.click(screen.getByTestId("new-task-submit-button"));

    await waitFor(() => {
      expect(tasksApi.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: "写周报" }),
      );
    });
    expect(await screen.findByTestId("board-page-stub")).toBeInTheDocument();
  });

  it("stays on the page, keeps input, and shows the backend error on submit failure (AC-03)", async () => {
    const user = userEvent.setup();
    vi.mocked(tasksApi.createTask).mockRejectedValue(new Error("服务器开小差了，请稍后重试"));
    renderNewTaskPage();

    const titleInput = await screen.findByTestId("new-task-title-input");
    await user.type(titleInput, "写周报");
    await user.type(screen.getByTestId("new-task-description-textarea"), "本周总结");
    await user.click(screen.getByTestId("new-task-submit-button"));

    expect(await screen.findByTestId("new-task-error")).toHaveTextContent(
      "服务器开小差了，请稍后重试",
    );
    expect(screen.getByTestId("new-task-title-input")).toHaveValue("写周报");
    expect(screen.getByTestId("new-task-description-textarea")).toHaveValue("本周总结");
    expect(screen.queryByTestId("board-page-stub")).not.toBeInTheDocument();
  });

  it("offers exactly the member roster plus 未分配, defaulting to 未分配 (AC-04)", async () => {
    renderNewTaskPage();

    const select = await screen.findByTestId("new-task-assignee-select");
    const optionLabels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);

    expect(optionLabels).toEqual(["未分配", "小美", "小刚"]);
    expect((select as HTMLSelectElement).value).toBe("");
  });
});
