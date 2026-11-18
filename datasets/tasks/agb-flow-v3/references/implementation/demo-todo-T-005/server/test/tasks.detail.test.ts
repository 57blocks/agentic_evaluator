import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/index";

describe("PATCH /api/tasks/:taskId", () => {
  it("persists an assignee reassignment so it is visible via a later GET (AC-05)", async () => {
    const memberRes = await request(app)
      .post("/api/members")
      .send({ name: `负责人-${Date.now()}` });
    expect(memberRes.status).toBe(201);

    const taskRes = await request(app)
      .post("/api/tasks")
      .send({ title: `待改派任务-${Date.now()}` });
    expect(taskRes.status).toBe(201);

    const patchRes = await request(app)
      .patch(`/api/tasks/${taskRes.body.id}`)
      .send({ assigneeId: memberRes.body.id });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.assigneeId).toBe(memberRes.body.id);

    const getRes = await request(app).get(`/api/tasks/${taskRes.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.assigneeId).toBe(memberRes.body.id);
  });
});
