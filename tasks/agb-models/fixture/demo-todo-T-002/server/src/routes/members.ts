import { randomUUID } from "node:crypto";
import { Router } from "express";
import { db } from "../db";

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
