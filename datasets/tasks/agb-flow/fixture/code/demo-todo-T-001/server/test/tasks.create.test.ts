import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/index";

describe("POST /api/tasks", () => {
  it("creates a task that is then visible via GET /api/tasks with status todo (AC-02)", async () => {
    const title = `写周报-${Date.now()}`;

    const createRes = await request(app)
      .post("/api/tasks")
      .send({ title, description: "本周工作总结" });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({ title, status: "todo" });

    const listRes = await request(app).get("/api/tasks");
    expect(listRes.status).toBe(200);
    const created = listRes.body.tasks.find((t: { id: string }) => t.id === createRes.body.id);
    expect(created).toBeDefined();
    expect(created.status).toBe("todo");
  });

  it("makes a task created via one request visible to an independent later request (AC-14)", async () => {
    const title = `设备A创建-${Date.now()}`;

    const createRes = await request(app).post("/api/tasks").send({ title });
    expect(createRes.status).toBe(201);

    const listResFromOtherDevice = await request(app).get("/api/tasks");
    const visible = listResFromOtherDevice.body.tasks.find(
      (t: { id: string }) => t.id === createRes.body.id,
    );
    expect(visible).toBeDefined();
    expect(visible.title).toBe(title);
  });
});
