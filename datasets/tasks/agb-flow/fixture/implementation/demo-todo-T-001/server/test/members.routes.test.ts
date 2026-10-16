import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/index";

describe("POST /api/members", () => {
  it("rejects a duplicate name and leaves the roster count unchanged (AC-12)", async () => {
    const name = `重复成员-${Date.now()}`;

    const first = await request(app).post("/api/members").send({ name });
    expect(first.status).toBe(201);

    const before = await request(app).get("/api/members");
    const countBefore = before.body.members.length;

    const duplicate = await request(app).post("/api/members").send({ name });
    expect(duplicate.status).toBeGreaterThanOrEqual(400);

    const after = await request(app).get("/api/members");
    expect(after.body.members.length).toBe(countBefore);
  });
});

describe("DELETE /api/members/:memberId", () => {
  it("nulls out assigneeId on that member's tasks while the tasks themselves remain (AC-13)", async () => {
    const memberRes = await request(app)
      .post("/api/members")
      .send({ name: `待移除成员-${Date.now()}` });
    const memberId = memberRes.body.id;

    const taskRes = await request(app)
      .post("/api/tasks")
      .send({ title: `在办任务-${Date.now()}`, assigneeId: memberId });
    const taskId = taskRes.body.id;

    const deleteRes = await request(app).delete(`/api/members/${memberId}`);
    expect(deleteRes.status).toBe(200);

    const taskAfter = await request(app).get(`/api/tasks/${taskId}`);
    expect(taskAfter.status).toBe(200);
    expect(taskAfter.body.assigneeId).toBeNull();

    const membersAfter = await request(app).get("/api/members");
    expect(
      membersAfter.body.members.find((m: { id: string }) => m.id === memberId),
    ).toBeUndefined();
  });
});
