import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MembersPage } from "./MembersPage";
import * as membersApi from "../api/members";

vi.mock("../api/members");

const MEMBERS = [
  { id: "m1", name: "小美" },
  { id: "m2", name: "小刚" },
];

function renderMembers() {
  return render(
    <MemoryRouter initialEntries={["/members"]}>
      <MembersPage />
    </MemoryRouter>,
  );
}

function findMemberRow(memberId: string) {
  return screen.getAllByTestId("member-row").find((el) => el.dataset.memberId === memberId);
}

beforeEach(() => {
  vi.mocked(membersApi.fetchMembers).mockResolvedValue(MEMBERS);
});

describe("MembersPage", () => {
  it('shows "该成员已存在" when adding a duplicate name, roster unchanged (AC-12)', async () => {
    const user = userEvent.setup();
    vi.mocked(membersApi.createMember).mockRejectedValue(new Error("该成员已存在"));
    renderMembers();

    await user.type(await screen.findByTestId("new-member-name-input"), "小美");
    await user.click(screen.getByTestId("add-member-button"));

    expect(await screen.findByTestId("new-member-name-error")).toHaveTextContent("该成员已存在");
    expect(screen.getAllByTestId("member-row")).toHaveLength(2);
  });

  it("removes the member row once removal is confirmed (AC-13)", async () => {
    const user = userEvent.setup();
    vi.mocked(membersApi.removeMember).mockResolvedValue(undefined);
    renderMembers();

    await screen.findByTestId("member-row");
    const row = findMemberRow("m1");
    expect(row).toBeDefined();
    const removeButton = row!.querySelector('[data-testid="member-remove-button"]') as HTMLElement;
    await user.click(removeButton);
    await user.click(await screen.findByTestId("member-remove-confirm-button"));

    await waitFor(() => {
      expect(membersApi.removeMember).toHaveBeenCalledWith("m1");
    });
    expect(findMemberRow("m1")).toBeUndefined();
  });
});
