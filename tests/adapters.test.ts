import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AdapterError, adapterFor, adapterIdOf, agentCliAdapter } from "../src/adapters/resolve.js";
import type { CandidateDef } from "../src/canon/types.js";

const helper = fileURLToPath(new URL("./helpers/fake-agent-cli.mjs", import.meta.url));

async function tmpWorkDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "eval-cli-"));
}

function request(cli: CandidateDef["cli"], extra?: { timeoutMs?: number; inputText?: string }) {
  return {
    stepId: "codegen",
    candidateId: "fake-cli",
    inputId: "code-utils",
    inputText: extra?.inputText ?? "build a helper",
    promptTemplate: "",
    temperature: 0,
    timeoutMs: extra?.timeoutMs ?? 5_000,
    cli,
  };
}

test("adapter id defaults from producer unless the candidate sets one", () => {
  const model: CandidateDef = { id: "sonnet-5", model: "anthropic/claude-sonnet-5" };
  assert.equal(adapterIdOf(model, "codegen"), "codegen");
  assert.equal(adapterIdOf(model, "prompt"), "model-api");
  assert.equal(adapterIdOf(model, "agent"), "agent-cli");
  assert.equal(adapterIdOf({ ...model, adapter: "agent-cli" }, "codegen"), "agent-cli");
  assert.equal(adapterFor(model, "codegen").id, "codegen");
  assert.equal(adapterFor(model, "prompt").id, "model-api");
});

test("agent-cli writes artifacts, costs nothing, and records stdout", async () => {
  const workDir = await tmpWorkDir();
  const r = await agentCliAdapter.execute(request({ argv: [process.execPath, helper] }), { workDir });
  assert.equal(r.finishReason, "stop");
  assert.equal(r.costSource, "none");
  assert.equal(r.costUsd, 0);
  assert.equal(r.text.trim(), "ok");
  assert.ok(r.artifacts.some((f) => f.path === "src/index.ts" && f.content.includes("inputLen")));
  assert.ok(!r.artifacts.some((f) => f.path === ".eval-input.txt"));
});

test("agent-cli substitutes {{input}} and {{workdir}}", async () => {
  const workDir = await tmpWorkDir();
  const inputText = "hello-subst";
  await agentCliAdapter.execute(
    request({ argv: [process.execPath, helper, "{{input}}", "{{workdir}}"] }, { inputText }),
    { workDir },
  );
  const args = await fs.readFile(path.join(workDir, "args.txt"), "utf-8");
  assert.equal(args, `${inputText}\n${workDir}`);
});

test("agent-cli non-zero exit is a completed attempt, not an adapter error", async () => {
  const workDir = await tmpWorkDir();
  const r = await agentCliAdapter.execute(
    request({ argv: [process.execPath, helper, "--mode", "fail"] }),
    { workDir },
  );
  assert.equal(r.finishReason, "exit 2");
  assert.match(r.text, /refused/);
});

test("agent-cli timeout throws AdapterError timeout", async () => {
  const workDir = await tmpWorkDir();
  await assert.rejects(
    () => agentCliAdapter.execute(request({ argv: ["sleep", "8"] }, { timeoutMs: 300 }), { workDir }),
    (err: unknown) => {
      assert.ok(err instanceof AdapterError);
      assert.equal(err.kind, "timeout");
      return true;
    },
  );
});

test("agent-cli missing binary throws AdapterError spawn", async () => {
  const workDir = await tmpWorkDir();
  await assert.rejects(
    () => agentCliAdapter.execute(request({ argv: ["eval-missing-binary-xyz"] }), { workDir }),
    (err: unknown) => {
      assert.ok(err instanceof AdapterError);
      assert.equal(err.kind, "spawn");
      return true;
    },
  );
});

test("agent-cli resolves a relative script against the task dir, not the harness", async () => {
  // Arrange - the script lives in the task, which is where a self-contained
  // task keeps its agent. The harness root has no copy of it.
  const taskRoot = await fs.mkdtemp(path.join(os.tmpdir(), "eval-task-"));
  await fs.mkdir(path.join(taskRoot, "agents"), { recursive: true });
  await fs.copyFile(helper, path.join(taskRoot, "agents", "agent.mjs"));
  const workDir = await tmpWorkDir();

  // Act
  const r = await agentCliAdapter.execute(
    request({ argv: [process.execPath, "agents/agent.mjs"] }),
    { workDir, taskRoot },
  );

  // Assert
  assert.equal(r.finishReason, "stop");
  assert.ok(r.artifacts.some((f) => f.path === "src/index.ts"));
});

test("agent-cli calls a declared script that does not exist a spawn error, not a candidate failure", async () => {
  // Arrange - a path that resolves nowhere. Left alone, node would exit 1 with
  // MODULE_NOT_FOUND and the stack trace would be recorded as the candidate's
  // deliverable, then judged and billed.
  const taskRoot = await fs.mkdtemp(path.join(os.tmpdir(), "eval-task-"));
  const workDir = await tmpWorkDir();

  // Act + Assert
  await assert.rejects(
    agentCliAdapter.execute(request({ argv: [process.execPath, "agents/missing.mjs"] }), { workDir, taskRoot }),
    (err: unknown) => {
      assert.ok(err instanceof AdapterError);
      assert.equal(err.kind, "spawn");
      assert.match(err.message, /agents\/missing\.mjs/);
      return true;
    },
  );
});
