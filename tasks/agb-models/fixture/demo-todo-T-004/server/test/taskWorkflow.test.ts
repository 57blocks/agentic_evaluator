import { describe, it, expect } from "vitest";
import { isValidTransition, TASK_STATUSES } from "../src/domain/taskWorkflow";

const VALID_TRANSITIONS: Array<[string, string]> = [
  ["todo", "in_progress"],
  ["in_progress", "todo"],
  ["in_progress", "done"],
];

describe("taskWorkflow.isValidTransition (WF-01)", () => {
  it("allows exactly the three transitions defined by WF-01", () => {
    for (const [from, to] of VALID_TRANSITIONS) {
      expect(isValidTransition(from, to)).toBe(true);
    }
  });

  it("rejects every from/to combination not declared by WF-01", () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        const isDeclaredValid = VALID_TRANSITIONS.some(
          ([validFrom, validTo]) => validFrom === from && validTo === to,
        );
        if (!isDeclaredValid) {
          expect(isValidTransition(from, to)).toBe(false);
        }
      }
    }
  });

  it("rejects done -> in_progress specifically (PRD §2.1: done is terminal, no reopening)", () => {
    expect(isValidTransition("done", "in_progress")).toBe(false);
  });
});
