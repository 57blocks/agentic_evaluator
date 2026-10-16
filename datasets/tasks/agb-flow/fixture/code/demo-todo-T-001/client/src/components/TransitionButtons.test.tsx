import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TransitionButtons } from "./TransitionButtons";

describe("TransitionButtons", () => {
  it("renders exactly one 开始处理 button for a todo task (AC-06)", () => {
    render(<TransitionButtons status="todo" onTransition={() => {}} />);

    const buttons = screen.getAllByTestId("task-detail-transition-button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("data-transition-to", "in_progress");
  });

  it("renders no transition buttons for a done task (AC-06)", () => {
    render(<TransitionButtons status="done" onTransition={() => {}} />);

    expect(screen.queryAllByTestId("task-detail-transition-button")).toHaveLength(0);
  });
});
