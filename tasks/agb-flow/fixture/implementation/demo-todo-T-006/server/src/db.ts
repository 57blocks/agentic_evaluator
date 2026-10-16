import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

function resolveDbPath(): string {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  if (process.env.NODE_ENV === "test") {
    return path.join(os.tmpdir(), `agb-demo-todo-${randomUUID()}.sqlite`);
  }
  const dataDir = path.join(import.meta.dirname, "..", "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "app.db");
}

export const db = new Database(resolveDbPath());
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assigneeId TEXT REFERENCES members(id),
      status TEXT NOT NULL DEFAULT 'todo'
    );
  `);
}
