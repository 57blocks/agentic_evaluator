/**
 * `agenteval dash --export DIR` replaces DIR. It must never replace the
 * workspace, the directory the user stands in, their home, or a directory
 * that holds something other than a previous export.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertExportDir, exportDashboard } from "../src/demo/export.js";
import { workspaceAt } from "../src/core/workspace.js";

async function workspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dash-export-guard-"));
  await fs.mkdir(path.join(root, "tasks", "demo"), { recursive: true });
  await fs.writeFile(path.join(root, "tasks", "demo", "spec.yaml"), "id: demo\n");
  return root;
}

test("export refuses the workspace root, its ancestors, cwd, home and the filesystem root", async () => {
  const root = await workspace();
  const ws = workspaceAt(root);
  for (const dir of [root, path.dirname(root), process.cwd(), os.homedir(), path.parse(root).root]) {
    await assert.rejects(exportDashboard(ws, dir), /refusing to export into/, dir);
  }
  assert.equal(existsSync(path.join(root, "tasks", "demo", "spec.yaml")), true, "the workspace survived");
});

test("export refuses a non-empty directory that is not a previous export", async () => {
  const root = await workspace();
  const out = path.join(root, "out");
  await fs.mkdir(out);
  await fs.writeFile(path.join(out, "notes.md"), "mine");
  await assert.rejects(exportDashboard(workspaceAt(root), out), /not empty/);
  assert.equal(await fs.readFile(path.join(out, "notes.md"), "utf-8"), "mine");
});

test("export refuses a file, and a directory that holds a previous export plus anything else", async () => {
  const root = await workspace();
  const file = path.join(root, "out.html");
  await fs.writeFile(file, "<!doctype html>");
  await assert.rejects(exportDashboard(workspaceAt(root), file), /it is a file/);
  assert.equal(await fs.readFile(file, "utf-8"), "<!doctype html>");
  const mixed = path.join(root, "mixed");
  await fs.mkdir(path.join(mixed, "data"), { recursive: true });
  await fs.writeFile(path.join(mixed, "index.html"), "");
  await fs.writeFile(path.join(mixed, "notes.md"), "mine");
  await assert.rejects(exportDashboard(workspaceAt(root), mixed), /not a previous export/);
  assert.equal(await fs.readFile(path.join(mixed, "notes.md"), "utf-8"), "mine");
});

test("assertExportDir accepts a missing dir, an empty dir and a previous export", async () => {
  const root = await workspace();
  await assertExportDir(root, path.join(root, "fresh"));
  const empty = path.join(root, "empty");
  await fs.mkdir(empty);
  await assertExportDir(root, empty);
  const previous = path.join(root, "previous");
  await fs.mkdir(path.join(previous, "data"), { recursive: true });
  await fs.writeFile(path.join(previous, "index.html"), "<!doctype html>");
  await assertExportDir(root, previous);
});
