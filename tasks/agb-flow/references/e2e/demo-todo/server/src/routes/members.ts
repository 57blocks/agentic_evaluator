import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db.js";

interface MemberRow {
  id: string;
  name: string;
}

export const membersRouter = Router();

membersRouter.get("/", (_req, res) => {
  const members = db.prepare("SELECT id, name FROM members ORDER BY rowid").all() as MemberRow[];
  res.json({ members });
});

membersRouter.post("/", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "姓名不能为空" });
    return;
  }

  const existing = db.prepare("SELECT id FROM members WHERE name = ?").get(name);
  if (existing) {
    res.status(409).json({ error: "该成员已存在" });
    return;
  }

  const id = randomUUID();
  db.prepare("INSERT INTO members (id, name) VALUES (?, ?)").run(id, name);
  res.status(201).json({ id, name });
});

const removeMemberAndUnassignTasks = db.transaction((memberId: string) => {
  db.prepare("UPDATE tasks SET assigneeId = NULL WHERE assigneeId = ?").run(memberId);
  return db.prepare("DELETE FROM members WHERE id = ?").run(memberId);
});

membersRouter.delete("/:memberId", (req, res) => {
  const { memberId } = req.params;
  const result = removeMemberAndUnassignTasks(memberId);
  if (result.changes === 0) {
    res.status(404).json({ error: "成员不存在" });
    return;
  }
  res.status(200).json({ id: memberId });
});
