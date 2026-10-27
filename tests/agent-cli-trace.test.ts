/**
 * A command candidate that declares `cli.trace` has its trace read into the
 * result: on a normal exit, and after a kill, where the trace is the record
 * of how far it got. Declaring it changes nothing about the trial's identity.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AdapterError, agentCliAdapter, trialAdapterFields } from "../src/adapters/resolve.js";
import type { CandidateRequest } from "../src/adapters/types.js";
import type { CandidateDef } from "../src/canon/types.js";

const FIXTURE = path.resolve("tests/fixtures/agent-traces/atif-terminus-fix-git.json");

/** A command that copies the ATIF fixture into place as its trace, then does `then`. */
function copyingTrace(then = ""): string {
  return `require('fs').copyFileSync(${JSON.stringify(FIXTURE)}, '.eval-trace.json'); require('fs').writeFileSync('out.txt', 'done'); ${then}`;
}

function request(code: string, cli: Partial<CandidateRequest["cli"]> = {}, timeoutMs = 10_000): CandidateRequest {
  return { stepId: "s", candidateId: "c", inputId: "i", inputText: "go", promptTemplate: "", temperature: 0, timeoutMs, cli: { argv: [process.execPath, "-e", code], trace: "atif", ...cli } };
}

test("a declared trace is read into the result and is not part of the answer", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  const r = await agentCliAdapter.execute(request(copyingTrace()), { workDir, taskRoot: workDir });

  assert.deepEqual(r.artifacts.map((f) => f.path), ["out.txt"], "the trace file is not a deliverable");
  assert.equal(r.trace?.format, "atif");
  assert.equal(r.trace?.turns, 10);
  assert.equal(r.trace?.tool_calls.length, 23);
  assert.equal(r.trace?.ended, null);
  assert.equal(r.traceError, undefined);
});

test("without the declaration the same file is neither read nor hidden", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  const r = await agentCliAdapter.execute(request(copyingTrace(), { trace: undefined }), { workDir, taskRoot: workDir });
  assert.equal(r.trace, undefined);
  // Not in SKIP_NAMES by name alone? It is: the file name is reserved for the
  // harness whatever the spec says, like .eval-usage.json.
  assert.deepEqual(r.artifacts.map((f) => f.path), ["out.txt"]);
});

test("a trace that cannot be read is an error on the result, not a silent nothing", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  const r = await agentCliAdapter.execute(request("require('fs').writeFileSync('.eval-trace.json', '{\"steps\": 1}')"), { workDir, taskRoot: workDir });
  assert.equal(r.trace, undefined);
  assert.match(r.traceError ?? "", /unreadable as atif/);
});

test("a killed command's trace is read after the kill, and says it was killed", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-"));
  // Write the trace and usage, then hang past the timeout.
  const code = copyingTrace("require('fs').writeFileSync('.eval-usage.json', JSON.stringify({ cost_usd: 0.05, prompt_tokens: 100, completion_tokens: 10 })); setInterval(() => {}, 1000);");
  await assert.rejects(
    agentCliAdapter.execute(request(code, { reports_usage: true }, 1_500), { workDir, taskRoot: workDir }),
    (err: unknown) => {
      assert.ok(err instanceof AdapterError && err.kind === "timeout", String(err));
      assert.equal(err.partial?.trace?.ended, "killed");
      assert.equal(err.partial?.trace?.turns, 10);
      assert.equal(err.partial?.costUsd, 0.05);
      assert.equal(err.partial?.costSource, "estimated");
      return true;
    },
  );
});

test("declaring a trace does not change the trial's identity", () => {
  const plain: CandidateDef = { id: "a", adapter: "agent-cli", cli: { argv: ["node", "run.mjs"], reports_usage: true } };
  const traced: CandidateDef = { ...plain, cli: { ...plain.cli!, trace: "atif" } };
  assert.deepEqual(trialAdapterFields(traced, "agent"), trialAdapterFields(plain, "agent"));
  assert.notDeepEqual(trialAdapterFields({ ...plain, cli: { ...plain.cli!, argv: ["node", "other.mjs"] } }, "agent"), trialAdapterFields(plain, "agent"));
});
