/** The review page's plan view: reading agb-shaped plans, and leaving everything else alone. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { line, parseTaskPlan, stats } from "../src/demo/client/features/review/taskPlan.js";

const PLAN = JSON.stringify({
  assumptions: ["A-01 one domain added", { id: "ASM-02", assumption: "layout from DEC-005" }],
  domains: [
    { id: "platform", name: "Platform", tasks: [{ id: "T-001", title: "server starts", role: "backend", dependsOn: [], files: ["a.ts"], estLines: 80 }] },
    { id: "task", name: "Tasks", dependsOn: ["platform"], tasks: [
      { id: "T-002", title: "list tasks", dependsOn: ["T-001"], acceptanceCriteria: [{ id: "AC-1", text: "shows 200 rows" }], estLines: 120 },
      { id: "T-003", title: "edit task", dependsOn: ["T-002"] },
    ] },
  ],
});

test("an agb plan is read into domains and tasks, with its counts", () => {
  const plan = parseTaskPlan(PLAN)!;

  assert.equal(plan.domains.length, 2);
  assert.deepEqual(plan.domains[1].dependsOn, ["platform"]);
  assert.deepEqual(stats(plan), { tasks: 3, lines: 200, crossDomain: 1 });
  assert.equal(line(plan.domains[1].tasks[0].acceptanceCriteria![0]), "AC-1 shows 200 rows");
  assert.equal(line(plan.assumptions![1]), "ASM-02 layout from DEC-005");
});

test("anything that is not a plan is left for the raw view", () => {
  assert.equal(parseTaskPlan("# UI contract"), null);
  assert.equal(parseTaskPlan(JSON.stringify({ components: [] })), null);
  assert.equal(parseTaskPlan(JSON.stringify({ domains: [{ id: "x" }] })), null);
});

test("agb's files object is flattened, each path labelled create or modify", () => {
  const plan = parseTaskPlan(JSON.stringify({ domains: [{ id: "d", tasks: [{ id: "T-1", files: { creates: ["a.ts", "b.ts"], modifies: ["c.ts"] } }] }] }))!;

  assert.deepEqual(plan.domains[0].tasks[0].files, ["creates: a.ts", "creates: b.ts", "modifies: c.ts"]);
});
