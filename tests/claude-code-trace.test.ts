/**
 * Claude Code's stream reads as turns deduplicated by message id, tool calls
 * with their verdicts, and the run's own totals — honest about what the SDK
 * says is a placeholder (per-message output tokens) or an estimate (cost).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseClaudeCodeStream } from "../src/traces/claude-code.js";
import { TraceError } from "../src/canon/agent-trace.js";
import { agentCliAdapter } from "../src/adapters/resolve.js";
import { deploymentRef } from "../src/core/generate.js";
import type { CandidateRequest } from "../src/adapters/types.js";

const FIXTURES = path.resolve("tests/fixtures/agent-traces");
const read = (name: string) => fs.readFile(path.join(FIXTURES, name), "utf-8");

test("a finished run: two turns, one Read that succeeded, totals from the result", async () => {
  const t = parseClaudeCodeStream(await read("claude-code-read.jsonl"));
  assert.equal(t.format, "claude-code");
  assert.equal(t.turns, 2);
  assert.deepEqual(t.tool_calls.map((c) => [c.name, c.failed]), [["Read", false]]);
  assert.equal(t.retries, 0, "the stream records retries, so none is 0");
  assert.equal(t.denials, 0);
  assert.equal(t.compactions, 0);
  assert.equal(t.ended, "finished");
  assert.deepEqual(t.models, ["claude-sonnet-5-5"]);
  assert.equal(t.provider, "anthropic-subscription", "firstParty with no API key source is a subscription login");
  // Per-turn prompt and cache tokens; output is the SDK's placeholder, left null.
  assert.deepEqual(t.turn_tokens?.map((x) => [x.prompt, x.cached, x.output]), [[2, 11803, null], [2, 41267, null]]);
  // Whole-run totals from modelUsage; cost is claude's estimate.
  const COST = 0.13975500000000002; // the stream's own float, as claude printed it
  assert.deepEqual(t.usage, { prompt: 4 + 33205, completion: 162, cached: 53070, costUsd: COST });
  assert.equal(t.cost_usd, COST);
});

test("a run stopped on its budget: parallel blocks share a message id and count once", async () => {
  const t = parseClaudeCodeStream(await read("claude-code-max-budget.jsonl"));
  assert.equal(t.turns, 1);
  assert.equal(t.ended, "max_budget");
  assert.deepEqual(t.tool_calls.map((c) => [c.name, c.failed]), [["Read", null]], "no tool_result ever came");
  assert.equal(t.usage?.costUsd, 0.68467175);
});

test("a stream cut off before its result ended nowhere, and keeps what came", async () => {
  const lines = (await read("claude-code-read.jsonl")).split("\n").filter(Boolean);
  const cut = lines.slice(0, 3).join("\n") + "\n" + lines[3].slice(0, 40);
  const t = parseClaudeCodeStream(cut);
  assert.equal(t.ended, null);
  assert.equal(t.turns, 1);
  assert.equal(t.usage, null);
  assert.equal(t.denials, null, "denials are listed on the result, which never came");
});

test("what is not a claude stream is a TraceError", () => {
  assert.throws(() => parseClaudeCodeStream(""), TraceError);
  assert.throws(() => parseClaudeCodeStream('{"type":"x"}\nnot json\n{"type":"y"}'), TraceError);
  assert.throws(() => parseClaudeCodeStream('{"schema_version":"ATIF-v1.8","steps":[]}'), TraceError);
});

test("with trace: claude-code the adapter takes usage and provider from the stream", async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "cc-"));
  const fixture = path.join(FIXTURES, "claude-code-read.jsonl");
  const code = `require('fs').copyFileSync(${JSON.stringify(fixture)}, '.eval-trace.jsonl'); require('fs').writeFileSync('out.txt', 'x')`;
  const request: CandidateRequest = { stepId: "s", candidateId: "c", inputId: "i", inputText: "go", promptTemplate: "", temperature: 0, timeoutMs: 10_000, cli: { argv: [process.execPath, "-e", code], trace: "claude-code" } };
  const r = await agentCliAdapter.execute(request, { workDir, taskRoot: workDir });
  assert.equal(r.costSource, "estimated");
  assert.equal(r.costUsd, 0.13975500000000002);
  assert.equal(r.promptTokens, 4 + 33205 + 53070);
  assert.equal(r.cachedTokens, 53070);
  assert.equal(r.provider, "anthropic-subscription");
  assert.deepEqual(r.artifacts.map((f) => f.path), ["out.txt"]);
});

test("a command candidate's deployment is labelled cli/, never openrouter/", () => {
  const def = { id: "a", adapter: "agent-cli" as const, cli: { argv: ["node", "x.mjs"] } };
  assert.equal(deploymentRef(def, "anthropic-subscription"), "cli/anthropic-subscription");
  assert.equal(deploymentRef(def, "local-cli"), "cli/local-cli");
  assert.equal(deploymentRef({ id: "m", model: "anthropic/claude-sonnet-5" }, "Anthropic"), "openrouter/anthropic");
});
