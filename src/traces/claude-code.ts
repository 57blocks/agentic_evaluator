/**
 * Reader for Claude Code's own stream: `claude -p --output-format stream-json
 * --verbose`, one JSON event per line, teed by the wrapper into
 * `.eval-trace.jsonl`. Harbor is not in the picture here (agb calls claude
 * directly), so there is no ATIF; this is what claude itself reports.
 *
 * Events read (Agent SDK reference, 2026-10-27):
 *   system/init            model, claude_code_version, apiKeySource
 *   assistant              message.id, message.model, message.usage,
 *                          content[] tool_use blocks, parent_tool_use_id
 *   user                   content[] tool_result blocks (tool_use_id, is_error)
 *   system/api_retry       one API retry
 *   system/compact_boundary one context compaction
 *   result                 subtype, num_turns, total_cost_usd, usage,
 *                          modelUsage (per model, with provider), permission_denials
 *
 * Rules, each the SDK's own:
 *   - a turn is one unique main-loop `message.id`: parallel tool calls share it;
 *   - messages with `parent_tool_use_id` are a subagent's, counted under that call;
 *   - per-message `output_tokens` is a placeholder, so output is read from
 *     the result only, and the per-turn figure stays null;
 *   - `total_cost_usd` is the client's estimate, recorded as "estimated";
 *   - a stream with no `result` line ended before claude did: `ended` null,
 *     which the adapter marks killed when it stopped the command.
 */

import { TraceError, type AgentEnd, type AgentTrace, type ToolCallRecord, type TurnTokens } from "../canon/agent-trace.js";

interface Block {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

interface Event {
  type?: string;
  subtype?: string;
  timestamp?: string;
  parent_tool_use_id?: string | null;
  message?: {
    id?: string;
    model?: string;
    usage?: Record<string, unknown>;
    content?: Block[] | string;
  };
  // system/init
  model?: string;
  apiKeySource?: string;
  // result
  num_turns?: number;
  total_cost_usd?: number;
  usage?: Record<string, unknown>;
  modelUsage?: Record<string, Record<string, unknown>>;
  permission_denials?: unknown[];
}

const END_OF: Record<string, AgentEnd> = {
  success: "finished",
  error_max_turns: "max_turns",
  error_max_budget_usd: "max_budget",
  error_during_execution: "error",
  error_max_structured_output_retries: "error",
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseLines(text: string): Event[] {
  const events: Event[] = [];
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new TraceError("empty stream");
  for (const [i, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A killed stream can end mid-line; everything before it still counts.
      if (i === lines.length - 1) break;
      throw new TraceError(`line ${i + 1} is not JSON`);
    }
    if (typeof parsed !== "object" || parsed === null || typeof (parsed as Event).type !== "string") throw new TraceError(`line ${i + 1} is not an event`);
    events.push(parsed as Event);
  }
  if (!events.some((e) => e.type === "system" && e.subtype === "init") && !events.some((e) => e.type === "assistant")) {
    throw new TraceError("no init or assistant event: not a claude stream");
  }
  return events;
}

/** Vendor as the stream names it: `firstParty` is Anthropic; a subscription login has no API key source. */
function providerOf(init: Event | undefined, modelUsage: Record<string, Record<string, unknown>> | undefined): string | null {
  const named = modelUsage ? Object.values(modelUsage).map((m) => m.provider).find((p): p is string => typeof p === "string") : undefined;
  if (named === undefined) return null;
  const vendor = named === "firstParty" ? "anthropic" : named;
  return init?.apiKeySource === "none" ? `${vendor}-subscription` : vendor;
}

export function parseClaudeCodeStream(text: string): AgentTrace {
  const events = parseLines(text);
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const result = events.find((e) => e.type === "result");

  const seen = new Set<string>();
  const turnTokens: TurnTokens[] = [];
  const models: string[] = [];
  const open = new Map<string, { record: ToolCallRecord; at: number | null; subagentTurns: Set<string> }>();
  const toolCalls: ToolCallRecord[] = [];
  let retries = 0;
  let compactions = 0;

  for (const e of events) {
    if (e.type === "system" && e.subtype === "api_retry") retries += 1;
    if (e.type === "system" && e.subtype === "compact_boundary") compactions += 1;
    if (e.type === "assistant" && e.message) {
      const m = e.message;
      if (e.parent_tool_use_id) {
        const parent = open.get(e.parent_tool_use_id);
        if (parent && m.id) parent.subagentTurns.add(m.id);
      } else if (m.id && !seen.has(m.id)) {
        seen.add(m.id);
        const u = m.usage ?? {};
        turnTokens.push({ prompt: num(u.input_tokens) ?? 0, cached: num(u.cache_read_input_tokens) ?? 0, output: null, costUsd: null });
        if (typeof m.model === "string" && !models.includes(m.model)) models.push(m.model);
      }
      const at = e.timestamp ? Date.parse(e.timestamp) : null;
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b.type !== "tool_use" || !b.id) continue;
        const record: ToolCallRecord = { name: b.name ?? "?", ms: null, failed: null };
        if (!e.parent_tool_use_id) toolCalls.push(record);
        open.set(b.id, { record, at: Number.isFinite(at) ? at : null, subagentTurns: new Set() });
      }
    }
    if (e.type === "user" && e.message && Array.isArray(e.message.content)) {
      const at = e.timestamp ? Date.parse(e.timestamp) : null;
      for (const b of e.message.content) {
        if (b.type !== "tool_result" || !b.tool_use_id) continue;
        const call = open.get(b.tool_use_id);
        if (!call) continue;
        call.record.failed = b.is_error === true;
        if (call.at !== null && at !== null && Number.isFinite(at)) call.record.ms = Math.max(0, at - call.at);
      }
    }
  }

  const totals = result?.modelUsage ? Object.values(result.modelUsage) : [];
  const sum = (key: string): number => totals.reduce((n, m) => n + (num(m[key]) ?? 0), 0);
  const usage =
    result?.modelUsage && totals.length > 0
      ? {
          prompt: sum("inputTokens") + sum("cacheCreationInputTokens"),
          completion: sum("outputTokens"),
          cached: sum("cacheReadInputTokens"),
          costUsd: num(result.total_cost_usd) ?? sum("costUSD"),
        }
      : null;
  if (init?.model && models.length === 0) models.push(init.model);

  return {
    format: "claude-code",
    turns: turnTokens.length,
    tool_calls: toolCalls,
    retries,
    denials: result ? (Array.isArray(result.permission_denials) ? result.permission_denials.length : 0) : null,
    compactions,
    turn_tokens: turnTokens.length > 0 ? turnTokens : null,
    models,
    cost_usd: usage?.costUsd ?? null,
    ended: result?.subtype ? (END_OF[result.subtype] ?? "error") : null,
    provider: providerOf(init, result?.modelUsage),
    usage,
  };
}
