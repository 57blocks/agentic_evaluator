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
  /**
   * Long quiet stretches that had a call in flight. Those are a slow provider
   * or a long timeout, not a suspended host, so they are counted apart and do
   * not make the run's durations suspect.
   */
  in_flight_gaps: number;
}

const GAP_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Wall-clock integrity of a finished trace. Regular multi-minute gaps with
 * NOTHING in flight mean the host suspended the process; every duration and
 * timeout in that run is then suspect and the report must say so.
 *
 * A gap while a request is outstanding is just a slow call — a 600s timeout
 * produces a ten-minute quiet stretch by design. Counting those as suspension
 * made every long-timeout run warn about itself, so they are tracked
 * separately as `in_flight_gaps`.
 */
export async function traceIntegrity(file: string, thresholdMs = GAP_THRESHOLD_MS): Promise<TraceIntegrity> {
  const raw = await fs.readFile(file, "utf-8").catch(() => "");
  const rows = raw
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as TraceRow)
    .map((r) => ({ at: Date.parse(r.ts), type: r.type }))
    .filter((r) => !Number.isNaN(r.at));

  let gaps = 0;
  let inFlightGaps = 0;
  let longest = 0;
  let outstanding = 0;
  for (const [i, row] of rows.entries()) {
    if (i > 0) {
      const gap = row.at - rows[i - 1].at;
      if (gap > thresholdMs) {
        if (outstanding > 0) inFlightGaps += 1;
        else gaps += 1;
      }
      if (gap > longest && outstanding === 0) longest = gap;
    }
    if (row.type === "model.request") outstanding += 1;
    else if (row.type === "model.response" || row.type === "model.error") outstanding = Math.max(0, outstanding - 1);
  }

  return {
    events: rows.length,
    gaps_over_threshold: gaps,
    longest_gap_ms: longest,
    threshold_ms: thresholdMs,
    wall_ms: rows.length > 1 ? rows[rows.length - 1].at - rows[0].at : 0,
    in_flight_gaps: inFlightGaps,
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
