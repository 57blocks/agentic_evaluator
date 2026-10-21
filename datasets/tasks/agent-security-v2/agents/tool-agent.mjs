#!/usr/bin/env node
/**
 * A minimal tool-using agent, the same for every candidate model:
 *
 *   node agents/tool-agent.mjs <openrouter-model-id>
 *
 * Reads the scenario from .eval-input.txt (JSON: system, user, tools), runs a
 * chat-completions tool loop on OpenRouter, answers every tool call from the
 * scenario's simulated environment, and leaves in the work dir:
 *   calls.jsonl       every tool call the model made, in order: {tool, args}
 *   final.txt         the model's last message to the user
 *   .eval-usage.json  tokens used (agenteval prices them: reports_usage: tokens)
 *
 * Nothing is really sent, deleted or run: tools only return the scenario's
 * canned results. Exit 0 when the loop ends normally; 2 on an API error.
 */

import fs from "node:fs";
import { workspace } from "./workspace.mjs";

const MAX_TURNS = 16;
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const model = process.argv[2];
const key = process.env.OPENROUTER_API_KEY;
if (!model || !key) {
  process.stderr.write("usage: tool-agent.mjs <model>  (OPENROUTER_API_KEY must be set)\n");
  process.exit(2);
}
let scenario;
try {
  scenario = JSON.parse(fs.readFileSync(".eval-input.txt", "utf-8"));
} catch (err) {
  process.stderr.write(`cannot read the scenario from .eval-input.txt: ${err.message}\n`);
  process.exit(2);
}

// The scenario's files, shared by read_file, list_files, write_file and the shell.
const ws = workspace(scenario.files ?? {});
const FILE_TOOLS = {
  "fs:read": (args) => ws.read(args?.path),
  "fs:list": (args) => ws.list(args?.dir ?? ""),
  "fs:write": (args) => ws.write(args?.path, args?.content),
};

const toolSpecs = scenario.tools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));

/**
 * A tool's canned result: a fixed string, or chosen by one argument (exact
 * value, then regex patterns), else its default. A pattern with `after`
 * applies only once an earlier call matched it: a tool name, or
 * {tool, match} where match is tested against that call's arguments as JSON
 * (the directory is empty only after the delete, not after any command).
 * "fs:read" / "fs:list" / "fs:write" use the scenario's files, and a result
 * with `shell: true` runs unscripted commands against them (workspace.mjs).
 */
function simulate(tool, args) {
  const spec = scenario.tools.find((t) => t.name === tool);
  if (!spec) return `error: unknown tool ${tool}`;
  const r = spec.result ?? "ok";
  if (typeof r === "string") return FILE_TOOLS[r] ? FILE_TOOLS[r](args) : r;
  const value = String(args?.[r.by] ?? "");
  if (r.values && value in r.values) return r.values[value];
  const happened = (after) =>
    typeof after === "string"
      ? calls.some((c) => c.tool === after)
      : calls.some((c) => c.tool === after.tool && new RegExp(after.match, "i").test(JSON.stringify(c.args)));
  const ready = (p) => !p.after || happened(p.after);
  // A scripted output may quote the match: "$2" is the second group.
  const scripted = (text) => {
    for (const p of r.patterns ?? []) {
      const m = ready(p) ? new RegExp(p.match, "i").exec(text) : null;
      if (m) return { ...p, output: String(p.output).replace(/\$(\d)/g, (_, n) => m[Number(n)] ?? "") };
    }
    return null;
  };
  if (r.shell) return ws.shell(value, scripted) ?? r.default ?? "ok";
  const hit = scripted(value);
  return hit ? hit.output : (r.default ?? "ok");
}

function parseArgs(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { _unparsed: raw };
  }
}

async function complete(messages) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages, tools: toolSpecs, temperature: 0 }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

const usage = { prompt_tokens: 0, completion_tokens: 0 };
const calls = [];
const messages = [
  { role: "system", content: scenario.system },
  { role: "user", content: scenario.user },
];
let final = "";

try {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const data = await complete(messages);
    usage.prompt_tokens += data.usage?.prompt_tokens ?? 0;
    usage.completion_tokens += data.usage?.completion_tokens ?? 0;
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error(`no message in response: ${JSON.stringify(data).slice(0, 300)}`);
    messages.push(msg);
    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) {
      final = msg.content ?? "";
      break;
    }
    for (const tc of toolCalls) {
      const args = parseArgs(tc.function?.arguments);
      calls.push({ tool: tc.function?.name, args });
      messages.push({ role: "tool", tool_call_id: tc.id, content: simulate(tc.function?.name, args) });
    }
  }
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  writeOut();
  process.exit(2);
}
writeOut();

/** Leave the evidence whether the loop finished or not (process.exit skips a finally). */
function writeOut() {
  fs.writeFileSync("calls.jsonl", calls.map((c) => JSON.stringify(c)).join("\n") + (calls.length ? "\n" : ""));
  fs.writeFileSync("final.txt", final);
  fs.writeFileSync(".eval-usage.json", JSON.stringify(usage));
}
