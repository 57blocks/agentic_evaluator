/**
 * Minimal trace (protocol §7 step 7): one line per LLM call event, for
 * generation, judging and scoring alike. Append-only JSONL with a per-run
 * monotonically increasing `seq` so ordering never depends on timestamps.
 *
 * Prompt text never enters the trace — only its hash and length. Raw outputs
 * live in raw/, prompts are reproducible from the spec and inputs.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { LlmCallEvent, LlmTrace } from "../llm.js";

export interface TraceRow extends LlmCallEvent {
  seq: number;
  ts: string;
  run: string;
}

export interface TraceSink {
  readonly file: string;
  /** Records the event; writes are serialized in call order. */
  emit: LlmTrace;
  /** Resolves when every emitted row is on disk. */
  close(): Promise<number>;
}

export interface TraceIntegrity {
  events: number;
  /** Gaps between consecutive events longer than the threshold (process suspended, network stall). */
  gaps_over_threshold: number;
  longest_gap_ms: number;
  threshold_ms: number;
  /** Elapsed wall time between first and last event. */
  wall_ms: number;
}

export const GAP_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Wall-clock integrity of a finished trace. Regular multi-minute gaps mean the
 * host suspended the process; every duration and timeout in that run is then
 * suspect and the report must say so.
 */
export async function traceIntegrity(file: string, thresholdMs = GAP_THRESHOLD_MS): Promise<TraceIntegrity> {
  const raw = await fs.readFile(file, "utf-8").catch(() => "");
  const times = raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => Date.parse((JSON.parse(l) as TraceRow).ts))
    .filter((t) => !Number.isNaN(t));
  let gaps = 0;
  let longest = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > thresholdMs) gaps += 1;
    if (gap > longest) longest = gap;
  }
  return {
    events: times.length,
    gaps_over_threshold: gaps,
    longest_gap_ms: longest,
    threshold_ms: thresholdMs,
    wall_ms: times.length > 1 ? times[times.length - 1] - times[0] : 0,
  };
}

export async function openTrace(runDir: string, runId: string): Promise<TraceSink> {
  await fs.mkdir(runDir, { recursive: true });
  const file = path.join(runDir, "trace.jsonl");
  await fs.writeFile(file, "", "utf-8");

  let seq = 0;
  let chain: Promise<void> = Promise.resolve();

  const emit: LlmTrace = (event) => {
    seq += 1;
    const row: TraceRow = { seq, ts: new Date().toISOString(), run: runId, ...event };
    chain = chain.then(() => fs.appendFile(file, `${JSON.stringify(row)}\n`, "utf-8"));
  };

  return {
    file,
    emit,
    close: async () => {
      await chain;
      return seq;
    },
  };
}
