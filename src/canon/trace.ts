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
