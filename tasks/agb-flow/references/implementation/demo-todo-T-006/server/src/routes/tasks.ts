import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db.js";
import { isValidTransition, TASK_STATUSES } from "../domain/taskWorkflow.js";

interface TaskRow {
  id: string;
  title: string;
  description: string;
  assigneeId: string | null;
  status: string;
}

export const tasksRouter = Router();

tasksRouter.get("/", (_req, res) => {
  const tasks = db
    .prepare("SELECT id, title, description, assigneeId, status FROM tasks ORDER BY rowid")
    .all() as TaskRow[];
  res.json({ tasks });
});

tasksRouter.post("/", (req, res) => {
  const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "标题不能为空" });
    return;
  }

  const description = typeof req.body?.description === "string" ? req.body.description : "";
  const assigneeId = typeof req.body?.assigneeId === "string" ? req.body.assigneeId : null;

  const id = randomUUID();
  try {
    db.prepare(
      "INSERT INTO tasks (id, title, description, assigneeId, status) VALUES (?, ?, ?, ?, 'todo')",
    ).run(id, title, description, assigneeId);
  } catch {
    res.status(400).json({ error: "负责人不存在" });
    return;
  }

  res.status(201).json({ id, title, description, assigneeId, status: "todo" });
});

tasksRouter.get("/:taskId", (req, res) => {
  const task = db
    .prepare("SELECT id, title, description, assigneeId, status FROM tasks WHERE id = ?")
    .get(req.params.taskId) as TaskRow | undefined;
  if (!task) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }
  res.json(task);
});

tasksRouter.patch("/:taskId", (req, res) => {
  const existing = db
    .prepare("SELECT id, title, description, assigneeId, status FROM tasks WHERE id = ?")
    .get(req.params.taskId) as TaskRow | undefined;
  if (!existing) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }

  const title = typeof req.body?.title === "string" ? req.body.title.trim() : undefined;
  if (title !== undefined && !title) {
    res.status(400).json({ error: "标题不能为空" });
    return;
  }
  const description = typeof req.body?.description === "string" ? req.body.description : undefined;
  const assigneeId =
    req.body && "assigneeId" in req.body
      ? typeof req.body.assigneeId === "string"
        ? req.body.assigneeId
        : null
      : undefined;

  const next = {
    title: title ?? existing.title,
    description: description ?? existing.description,
    assigneeId: assigneeId === undefined ? existing.assigneeId : assigneeId,
  };

  try {
    db.prepare("UPDATE tasks SET title = ?, description = ?, assigneeId = ? WHERE id = ?").run(
      next.title,
      next.description,
      next.assigneeId,
      req.params.taskId,
    );
  } catch {
    res.status(400).json({ error: "负责人不存在" });
    return;
  }

  res.json({ id: req.params.taskId, ...next, status: existing.status });
});

tasksRouter.post("/:taskId/transitions", (req, res) => {
  const existing = db
    .prepare("SELECT id, status FROM tasks WHERE id = ?")
    .get(req.params.taskId) as Pick<TaskRow, "id" | "status"> | undefined;
  if (!existing) {
    res.status(404).json({ error: "任务不存在" });
    return;
  }

  const to = typeof req.body?.to === "string" ? req.body.to : "";
  if (!TASK_STATUSES.includes(to as (typeof TASK_STATUSES)[number])) {
    res.status(400).json({ error: "目标状态无效" });
    return;
  }

  if (!isValidTransition(existing.status, to)) {
    res.status(400).json({ error: `不能从「${existing.status}」转移到「${to}」` });
    return;
  }

  db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(to, req.params.taskId);

  res.json({ id: req.params.taskId, status: to });
});
