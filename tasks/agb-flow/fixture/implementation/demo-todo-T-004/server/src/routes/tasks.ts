import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db.js";

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
