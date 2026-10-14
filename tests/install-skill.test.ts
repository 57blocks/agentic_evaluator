import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli/index.js";
import { EXIT } from "../src/cli/exit-codes.js";
import { bufferIo } from "../src/cli/io.js";
import { UsageError } from "../src/cli/args.js";
import { INSTALL_ROOT } from "../src/paths.js";

const SKILL = path.join("skills", "agenteval-new-task", "SKILL.md");

async function workspace(): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "eval-skill-"));
  await fs.mkdir(path.join(ws, "tasks"));
  return ws;
}

test("install-skill puts the authoring skill where Claude Code finds it, in the workspace", async () => {
  const ws = await workspace();
  const io = bufferIo();

  const code = await main(["install-skill", "--workspace", ws], io);

  assert.equal(code, EXIT.ok);
  const installed = await fs.readFile(path.join(ws, ".claude", "skills", "agenteval-new-task", "SKILL.md"), "utf-8");
  assert.equal(installed, await fs.readFile(path.join(INSTALL_ROOT, SKILL), "utf-8"));
  assert.match(io.stdout, /\/agenteval-new-task/);
});

test("install-skill puts the README beside the skill, so the spec reference it cites is there to read", async () => {
  const ws = await workspace();

  await main(["install-skill", "--workspace", ws], bufferIo());

  const reference = await fs.readFile(path.join(ws, ".claude", "skills", "agenteval-new-task", "reference.md"), "utf-8");
  assert.equal(reference, await fs.readFile(path.join(INSTALL_ROOT, "README.md"), "utf-8"));
  assert.match(await fs.readFile(path.join(INSTALL_ROOT, SKILL), "utf-8"), /reference\.md/);
});

test("install-skill will not overwrite an edited copy unless asked", async () => {
  const ws = await workspace();
  const target = path.join(ws, ".claude", "skills", "agenteval-new-task", "SKILL.md");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "my edits");

  await assert.rejects(main(["install-skill", "--workspace", ws], bufferIo()), (e: unknown) => e instanceof UsageError && /--force/.test(e.message));
  assert.equal(await fs.readFile(target, "utf-8"), "my edits");
  const forced = await main(["install-skill", "--workspace", ws, "--force"], bufferIo());

  assert.equal(forced, EXIT.ok);
  assert.notEqual(await fs.readFile(target, "utf-8"), "my edits");
});

test("the skill ships with the package", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(INSTALL_ROOT, "package.json"), "utf-8")) as { files: string[] };

  assert.ok(pkg.files.includes("skills"));
  assert.match(await fs.readFile(path.join(INSTALL_ROOT, SKILL), "utf-8"), /^---\nname: agenteval-new-task\n/);
});

test("install-skill replaces a symlink in its way instead of writing through it", async () => {
  const ws = await workspace();
  const outside = path.join(ws, "outside.txt");
  await fs.writeFile(outside, "keep me");
  const dir = path.join(ws, ".claude", "skills", "agenteval-new-task");
  await fs.mkdir(dir, { recursive: true });
  await fs.symlink(outside, path.join(dir, "reference.md"));
  await fs.symlink(outside, path.join(dir, "SKILL.md"));

  await main(["install-skill", "--workspace", ws, "--force"], bufferIo());

  assert.equal(await fs.readFile(outside, "utf-8"), "keep me");
  assert.ok(!(await fs.lstat(path.join(dir, "reference.md"))).isSymbolicLink());
  assert.ok(!(await fs.lstat(path.join(dir, "SKILL.md"))).isSymbolicLink());
});

test("install-skill refuses a skill directory that leads out of the workspace", async () => {
  const ws = await workspace();
  const elsewhere = await fs.mkdtemp(path.join(os.tmpdir(), "eval-elsewhere-"));
  await fs.symlink(elsewhere, path.join(ws, ".claude"));

  await assert.rejects(main(["install-skill", "--workspace", ws], bufferIo()), (e: unknown) => e instanceof UsageError && /outside/.test(e.message));
  assert.deepEqual(await fs.readdir(elsewhere), []);
});
