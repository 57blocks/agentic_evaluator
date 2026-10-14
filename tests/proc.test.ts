/** Commands as process trees we can stop (docs/design/agb-flow-gaps.md A7, A8). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runProcess, SpawnError } from "../src/proc.js";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A command that starts a grandchild sleeping for a minute and reports its pid. */
async function spawnsGrandchild(dir: string, thenExit: boolean): Promise<string[]> {
  const pidFile = path.join(dir, "grandchild.pid");
  const code = [
    "const { spawn } = require('child_process');",
    "const g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });",
    `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));`,
    thenExit ? "process.exit(0);" : "setTimeout(() => {}, 60000);",
  ].join(" ");
  return [process.execPath, "-e", code, pidFile];
}

test("a timeout stops the whole process tree, not only the command", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proc-"));
  const [cmd, flag, code, pidFile] = await spawnsGrandchild(dir, false);

  const r = await runProcess(cmd!, [flag!, code!], { cwd: dir, timeoutMs: 500 });

  assert.equal(r.timedOut, true);
  const grandchild = Number(await fs.readFile(pidFile!, "utf-8"));
  await sleep(200);
  assert.equal(alive(grandchild), false, "the grandchild was killed with its group");
});

test("what a command leaves running is stopped when it exits", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proc-"));
  const [cmd, flag, code, pidFile] = await spawnsGrandchild(dir, true);

  const r = await runProcess(cmd!, [flag!, code!], { cwd: dir, timeoutMs: 10_000 });

  assert.equal(r.timedOut, false);
  assert.equal(r.exitCode, 0);
  await sleep(200);
  assert.equal(alive(Number(await fs.readFile(pidFile!, "utf-8"))), false);
});

test("a command that prints a lot keeps running, and its output's tail is kept", async () => {
  const code = "for (let i = 0; i < 2000; i++) console.log('line ' + i + ' ' + 'x'.repeat(100)); console.log('THE END'); process.exit(3);";

  const r = await runProcess(process.execPath, ["-e", code], { cwd: os.tmpdir(), timeoutMs: 10_000, tailBytes: 4096 });

  assert.equal(r.exitCode, 3, "not killed for its output");
  assert.ok(r.stdout.endsWith("THE END\n"));
  assert.ok(r.stdout.length <= 4096);
  assert.ok(r.droppedBytes > 200_000);
});

test("a command that does not exist is a spawn error", async () => {
  await assert.rejects(
    runProcess("definitely-not-a-command-xyz", [], { cwd: os.tmpdir(), timeoutMs: 1000 }),
    (e: unknown) => e instanceof SpawnError && e.code === "ENOENT",
  );
});
