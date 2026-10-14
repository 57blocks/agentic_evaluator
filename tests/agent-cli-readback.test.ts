/** What an agent left is read back as text, within bounds (docs/design/agb-flow-gaps.md A8). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentCliAdapter } from "../src/adapters/resolve.js";
import type { LlmCallEvent } from "../src/llm.js";

test("a huge file and a binary one are left out of the answer, and named", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "readback-"));
  const code = [
    "const fs = require('fs');",
    "fs.writeFileSync('notes.md', '# notes');",
    "fs.writeFileSync('run.log', 'x'.repeat(3 * 1024 * 1024));",
    "fs.writeFileSync('app.db', Buffer.from([83, 81, 76, 0, 1, 2]));",
  ].join(" ");
  const events: LlmCallEvent[] = [];

  const r = await agentCliAdapter.execute(
    { stepId: "s", candidateId: "c", inputId: "i", inputText: "go", promptTemplate: "", temperature: 0, timeoutMs: 10_000, cli: { argv: [process.execPath, "-e", code] } },
    { workDir, taskRoot: workDir, emit: (e) => events.push(e) },
  );

  assert.deepEqual(r.artifacts.map((f) => f.path), ["notes.md"]);
  const skipped = events.find((e) => e.type === "model.response")?.skippedFiles ?? [];
  assert.deepEqual(skipped.sort(), ["app.db (binary)", `run.log (${3 * 1024 * 1024} bytes, over ${2 * 1024 * 1024})`]);
});
