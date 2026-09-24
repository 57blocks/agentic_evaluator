import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { TaskDetailPage } from "./TaskDetailPage";
import * as tasksApi from "../api/tasks";
import * as membersApi from "../api/members";

vi.mock("../api/tasks");
vi.mock("../api/members");

const TASK = {
  id: "t1",
  title: "任务详情",
  description: "描述",
  assigneeId: null,
  status: "todo" as const,
};

const MEMBERS = [
  { id: "m1", name: "小美" },
  { id: "m2", name: "小刚" },
];

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/tasks/t1"]}>
      <Routes>
        <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(tasksApi.fetchTask).mockResolvedValue(TASK);
  vi.mocked(membersApi.fetchMembers).mockResolvedValue(MEMBERS);
  vi.mocked(tasksApi.updateTask).mockResolvedValue({ ...TASK, assigneeId: "m1" });
});

describe("TaskDetailPage", () => {
  it("saves immediately when a new assignee is selected, with no extra confirmation step (AC-05)", async () => {
    const user = userEvent.setup();
    renderDetail();

    const select = await screen.findByTestId("task-detail-assignee-select");
    await user.selectOptions(select, "m1");

    await waitFor(() => {
      expect(tasksApi.updateTask).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ assigneeId: "m1" }),
      );
    });
  });
});
