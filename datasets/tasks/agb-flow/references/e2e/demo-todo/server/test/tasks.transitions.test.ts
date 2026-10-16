import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/index";

describe("POST /api/tasks/:taskId/transitions", () => {
  it("rejects any further transition once a task has reached done (AC-07, WF-01)", async () => {
    const taskRes = await request(app)
      .post("/api/tasks")
      .send({ title: `完成后不可再转移-${Date.now()}` });
    const taskId = taskRes.body.id;

    await request(app)
      .post(`/api/tasks/${taskId}/transitions`)
      .send({ to: "in_progress" })
      .expect(200);

    const doneRes = await request(app)
      .post(`/api/tasks/${taskId}/transitions`)
      .send({ to: "done" });
    expect(doneRes.status).toBe(200);
    expect(doneRes.body.status).toBe("done");

    const rejectedRes = await request(app)
      .post(`/api/tasks/${taskId}/transitions`)
      .send({ to: "in_progress" });
    expect(rejectedRes.status).toBeGreaterThanOrEqual(400);

    const finalRes = await request(app).get(`/api/tasks/${taskId}`);
    expect(finalRes.body.status).toBe("done");
  });
});
