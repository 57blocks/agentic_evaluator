/** Trials run outside the repo; what they left is kept as evidence (docs/design/agb-flow-gaps.md A5). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateOne } from "../src/core/generate.js";
import type { Suite } from "../src/types.js";

test("a trial runs in a temp dir, and its files but not its installs are kept under the run", async () => {
  const taskRoot = await fs.mkdtemp(path.join(os.tmpdir(), "task-"));
  const evidence = path.join(taskRoot, "runs", "r1", "checks", "c__i__t0");
  const code = [
    "const fs = require('fs');",
    "fs.writeFileSync('cwd.txt', process.cwd());",
    "fs.mkdirSync('node_modules/dep', { recursive: true });",
    "fs.writeFileSync('node_modules/dep/index.js', '');",
    "console.log('blocked on a permission');",
  ].join(" ");
  const suite = { step: "s", taskRoot, inputs: ["i"], candidates: ["c"] } as unknown as Suite;

  await generateOne({
    suite,
    producer: "codegen",
    promptTpl: "",
    inputSlug: "i",
    inputText: "go",
    def: { id: "c", adapter: "agent-cli", cli: { argv: [process.execPath, "-e", code] } },
    temperature: 0,
    timeoutMs: 10_000,
    checkWorkDir: evidence,
    trace: () => {},
    traceContext: {},
  });

  const ranIn = await fs.readFile(path.join(evidence, "cwd.txt"), "utf-8");
  assert.ok(!ranIn.startsWith(taskRoot), `ran in ${ranIn}, inside the task`);
  await assert.rejects(fs.stat(ranIn), "the temp work dir is removed afterwards");
  await assert.rejects(fs.stat(path.join(evidence, "node_modules")), "installs are not evidence");
  assert.match(await fs.readFile(path.join(evidence, "AGENT_OUTPUT.log"), "utf-8"), /blocked on a permission/, "what the agent printed is kept");
});

test("a timed-out agent's output is kept too", async () => {
  const taskRoot = await fs.mkdtemp(path.join(os.tmpdir(), "task-"));
  const evidence = path.join(taskRoot, "runs", "r1", "checks", "c__i__t0");
  const suite = { step: "s", taskRoot, inputs: ["i"], candidates: ["c"] } as unknown as Suite;

  await assert.rejects(
    generateOne({
      suite, producer: "codegen", promptTpl: "", inputSlug: "i", inputText: "go",
      def: { id: "c", adapter: "agent-cli", cli: { argv: [process.execPath, "-e", "console.log('still verifying the plan'); setTimeout(() => {}, 60000)"] } },
      temperature: 0, timeoutMs: 800, checkWorkDir: evidence, trace: () => {}, traceContext: {},
    }),
    /timed out/,
  );

  assert.match(await fs.readFile(path.join(evidence, "AGENT_OUTPUT.log"), "utf-8"), /still verifying the plan/);
});
