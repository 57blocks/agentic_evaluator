/** The answer key is out of reach while a run is in flight (docs/design/agb-flow-gaps.md A6). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hideAnswerKey, referencesCopyFor, restoreAnswerKey } from "../src/core/answer-key.js";
import { runCommandCheck } from "../src/check.js";

async function taskWithReferences(): Promise<string> {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "answer-key-"));
  await fs.mkdir(path.join(task, "references", "demo"), { recursive: true });
  await fs.writeFile(path.join(task, "references", "demo", "ANSWER.md"), "42\n");
  return task;
}

test("during a run references/ cannot be read, and afterwards it can again", async () => {
  const task = await taskWithReferences();

  const key = await hideAnswerKey(task);
  await assert.rejects(fs.readFile(path.join(task, "references", "demo", "ANSWER.md"), "utf-8"), /EACCES/);
  await key.restore();

  assert.equal(await fs.readFile(path.join(task, "references", "demo", "ANSWER.md"), "utf-8"), "42\n");
  assert.equal(referencesCopyFor(task), null, "the private copy is gone");
});

test("a check still reads the answers during a run, from its private copy", async () => {
  const task = await taskWithReferences();
  const key = await hideAnswerKey(task);
  try {
    const r = await runCommandCheck({
      argv: [process.execPath, "-e", "const fs = require('fs'); const a = fs.readFileSync(process.env.EVAL_REFERENCES_DIR + '/demo/ANSWER.md', 'utf-8'); process.exit(a.trim() === '42' ? 0 : 1);"],
      versionFiles: [],
      timeoutMs: 10_000,
      files: [],
      output: "",
      input: "",
      meta: { step: "s", candidate: "c", input: "demo", trial: 0 },
      workDir: await fs.mkdtemp(path.join(os.tmpdir(), "check-")),
      taskRoot: task,
    });
    assert.equal(r.state, "pass", r.output);
  } finally {
    await key.restore();
  }
});

test("references left unreadable by a killed run are made readable again", async () => {
  const task = await taskWithReferences();
  await fs.chmod(path.join(task, "references"), 0);

  assert.equal(restoreAnswerKey(task), true);
  assert.equal(await fs.readFile(path.join(task, "references", "demo", "ANSWER.md"), "utf-8"), "42\n");
  assert.equal(restoreAnswerKey(task), false, "nothing to do the second time");
});

test("a task without references/ is left alone", async () => {
  const task = await fs.mkdtemp(path.join(os.tmpdir(), "answer-key-"));
  const key = await hideAnswerKey(task);
  await key.restore();
  await assert.rejects(fs.stat(path.join(task, "references")));
});
