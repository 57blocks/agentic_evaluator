/**
 * Reader for ATIF, Harbor's Agent Trajectory Interchange Format: the JSON
 * Harbor writes to `agent/trajectory.json` for every trial, whichever agent
 * ran (Claude Code, Codex, terminus, …). Phoenix and Opik read the same file.
 *
 * Fields read, per Harbor's models (src/harbor/models/trajectories, v1.8):
 *   schema_version          "ATIF-v1.0" … "ATIF-v1.8"
 *   agent.model_name
 *   steps[].source          system | user | agent
 *   steps[].timestamp       ISO 8601
 *   steps[].model_name
 *   steps[].llm_call_count  model calls behind one agent step, when > 1
 *   steps[].tool_calls[]    { tool_call_id, function_name, arguments }
 *   steps[].observation     { results: [{ source_call_id?, content }] }
 *   steps[].metrics         { prompt_tokens, completion_tokens, cached_tokens, cost_usd }
 *   final_metrics           { total_cost_usd, … }
 *
 * ATIF has no notion of a retry, a permission denial or a context compaction,
 * and an observation carries content, not a verdict, so those stay null.
 */

import { TraceError, type AgentTrace, type ToolCallRecord, type TurnTokens } from "../canon/agent-trace.js";

const SCHEMA = /^ATIF-v1\.\d+$/;

interface AtifStep {
  source: string;
  timestamp?: string;
  model_name?: string;
  llm_call_count?: number;
  tool_calls?: Array<{ function_name?: string }>;
  metrics?: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number; cost_usd?: number };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function stepsOf(raw: unknown): AtifStep[] {
  if (!isRecord(raw)) throw new TraceError("not a JSON object");
  if (typeof raw.schema_version !== "string" || !SCHEMA.test(raw.schema_version)) {
    throw new TraceError(`schema_version ${JSON.stringify(raw.schema_version)} is not ATIF-v1.x`);
  }
  if (!Array.isArray(raw.steps)) throw new TraceError("steps is not an array");
  return raw.steps.map((s, i) => {
    if (!isRecord(s) || typeof s.source !== "string") throw new TraceError(`step ${i + 1} has no source`);
    return s as unknown as AtifStep;
  });
}

const msBetween = (a: string | undefined, b: string | undefined): number | null => {
  if (!a || !b) return null;
  const d = Date.parse(b) - Date.parse(a);
  return Number.isFinite(d) && d >= 0 ? d : null;
};

export function parseAtif(raw: unknown): AgentTrace {
  const steps = stepsOf(raw);
  const agentSteps = steps.filter((s) => s.source === "agent");

  const toolCalls: ToolCallRecord[] = [];
  const models: string[] = [];
  const turnTokens: TurnTokens[] = [];
  let sawMetrics = false;
  let stepCost = 0;
  let sawCost = false;

  steps.forEach((s, i) => {
    if (s.source !== "agent") return;
    if (s.model_name && !models.includes(s.model_name)) models.push(s.model_name);
    const calls = Array.isArray(s.tool_calls) ? s.tool_calls : [];
    // The gap to the next step covers every call this step made at once;
    // it is one call's duration only when the step made one call.
    const gap = calls.length === 1 ? msBetween(s.timestamp, steps[i + 1]?.timestamp) : null;
    for (const c of calls) toolCalls.push({ name: typeof c.function_name === "string" ? c.function_name : "?", ms: gap, failed: null });
    const m = isRecord(s.metrics) ? s.metrics : null;
    if (m) {
      sawMetrics = true;
      const cost = num(m.cost_usd);
      if (cost !== null) {
        stepCost += cost;
        sawCost = true;
      }
      turnTokens.push({ prompt: num(m.prompt_tokens) ?? 0, cached: num(m.cached_tokens) ?? 0, output: num(m.completion_tokens), costUsd: cost });
    } else {
      turnTokens.push({ prompt: 0, cached: 0, output: null, costUsd: null });
    }
  });

  const top = raw as Record<string, unknown>;
  const agent = isRecord(top.agent) ? top.agent : {};
  if (typeof agent.model_name === "string" && !models.includes(agent.model_name) && models.length === 0) models.push(agent.model_name);
  const finalMetrics = isRecord(top.final_metrics) ? top.final_metrics : null;
  const finalCost = finalMetrics ? num(finalMetrics.total_cost_usd) : null;

  return {
    format: "atif",
    turns: agentSteps.reduce((n, s) => n + Math.max(1, num(s.llm_call_count) ?? 1), 0),
    tool_calls: toolCalls,
    retries: null,
    denials: null,
    compactions: null,
    turn_tokens: sawMetrics ? turnTokens : null,
    models,
    cost_usd: finalCost ?? (sawCost ? stepCost : null),
    ended: null,
  };
}
