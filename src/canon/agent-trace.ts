/**
 * How a command candidate's agent worked, read from the trace it left.
 *
 * A command candidate is a black box: agenteval gives it an input and keeps
 * the files it leaves. When the spec says the command also leaves a trace
 * (`cli.trace`, src/traces/), that trace is read into this one small model —
 * turns, tool calls, how it ended — and summarised on the trial's row. The
 * wire formats (Harbor's ATIF, Claude Code's stream) stay in their readers.
 *
 * A field a format has no notion of is null, never 0: ATIF records no
 * retries, so an ATIF trace says nothing about them.
 */

export type TraceFormat = "atif";

export const TRACE_FORMATS: readonly TraceFormat[] = ["atif"];

/** How the agent's run ended, as its trace or the harness saw it. */
export type AgentEnd = "finished" | "max_turns" | "max_budget" | "error" | "killed";

export interface ToolCallRecord {
  name: string;
  /** From the call to its observation; null when the trace has no timestamps for it. */
  ms: number | null;
  /** Null when the trace records the observation but no verdict on it (ATIF). */
  failed: boolean | null;
}

export interface TurnTokens {
  prompt: number;
  cached: number;
  /** Null where the format reports no honest per-turn figure. */
  output: number | null;
  costUsd: number | null;
}

export interface AgentTrace {
  format: TraceFormat;
  /** Model calls in the agent's main loop. */
  turns: number;
  tool_calls: ToolCallRecord[];
  /** Null when the format has no notion of it. */
  retries: number | null;
  denials: number | null;
  compactions: number | null;
  /**
   * One entry per agent step, when the trace carries per-step metrics; null
   * otherwise. A step that made several model calls (ATIF `llm_call_count`)
   * is one entry here and several in `turns`.
   */
  turn_tokens: TurnTokens[] | null;
  /** Model names the trace saw, in first-seen order. */
  models: string[];
  /** The trace's own cost figure, an estimate by the agent, not a bill. */
  cost_usd: number | null;
  ended: AgentEnd | null;
}

/** What the trial row carries: counts, not the turn list (that is in traces/). */
export interface AgentActivity {
  format: TraceFormat;
  turns: number;
  tool_calls: number;
  /** Calls per tool name. */
  tools: Record<string, number>;
  retries: number | null;
  denials: number | null;
  compactions: number | null;
  ended: AgentEnd | null;
}

export function activityOf(trace: AgentTrace): AgentActivity {
  const tools: Record<string, number> = {};
  for (const c of trace.tool_calls) tools[c.name] = (tools[c.name] ?? 0) + 1;
  return {
    format: trace.format,
    turns: trace.turns,
    tool_calls: trace.tool_calls.length,
    tools,
    retries: trace.retries,
    denials: trace.denials,
    compactions: trace.compactions,
    ended: trace.ended,
  };
}

/** A trace the command left but agenteval could not read: recorded on the row, never dropped. */
export class TraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraceError";
  }
}
