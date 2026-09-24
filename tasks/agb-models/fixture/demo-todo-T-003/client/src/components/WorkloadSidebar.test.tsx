import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkloadSidebar } from "./WorkloadSidebar";

const MEMBERS = [
  { id: "m1", name: "小美" },
  { id: "m2", name: "小刚" },
];

function makeTask(overrides: { assigneeId?: string | null; status?: "todo" | "in_progress" | "done" }) {
  return {
    id: `t-${Math.random()}`,
    title: "任务",
    description: "",
    assigneeId: overrides.assigneeId ?? null,
    status: overrides.status ?? "todo",
  };
}

function findWorkloadItem(memberId: string) {
  return screen.getAllByTestId("workload-item").find((el) => el.dataset.memberId === memberId);
}

describe("WorkloadSidebar", () => {
  it("counts only todo/in_progress tasks per member as their workload (AC-10, RULE-01)", () => {
    const tasks = [
      makeTask({ assigneeId: "m1", status: "todo" }),
      makeTask({ assigneeId: "m1", status: "in_progress" }),
      makeTask({ assigneeId: "m1", status: "done" }),
      makeTask({ assigneeId: "m2", status: "done" }),
    ];

    render(<WorkloadSidebar members={MEMBERS} tasks={tasks} />);

    const m1 = findWorkloadItem("m1");
    const m2 = findWorkloadItem("m2");
    expect(m1).toBeDefined();
    expect(m2).toBeDefined();
    expect(m1).toHaveTextContent("2");
    expect(m2).toHaveTextContent("0");
  });

  it("shifts workload by one in each direction when a task is reassigned (AC-05)", () => {
    const before = [makeTask({ assigneeId: "m1", status: "todo" })];
    const { rerender } = render(<WorkloadSidebar members={MEMBERS} tasks={before} />);
    expect(findWorkloadItem("m1")).toHaveTextContent("1");
    expect(findWorkloadItem("m2")).toHaveTextContent("0");

    const after = [makeTask({ assigneeId: "m2", status: "todo" })];
    rerender(<WorkloadSidebar members={MEMBERS} tasks={after} />);
    expect(findWorkloadItem("m1")).toHaveTextContent("0");
    expect(findWorkloadItem("m2")).toHaveTextContent("1");
  });
});
