/**
 * The trace a command candidate leaves in its work dir, read when the spec
 * declares `cli.trace`. One fixed file name per format, like
 * `.eval-usage.json`: the wrapper copies or tees into it, and agenteval
 * never mistakes it for the candidate's output.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { TraceError, type AgentTrace, type TraceFormat } from "../canon/agent-trace.js";
import { parseAtif } from "./atif.js";

export const TRACE_FILES: Readonly<Record<TraceFormat, string>> = { atif: ".eval-trace.json" };

export type TraceRead = { trace: AgentTrace } | { error: string } | null;

/**
 * The trace in a work dir, or why it could not be read; null when the
 * command left none. Absence is not an error: a killed command may have
 * never got that far, and GAPS says so.
 */
export async function readTraceFile(workDir: string, format: TraceFormat): Promise<TraceRead> {
  let text: string;
  try {
    text = await fs.readFile(path.join(workDir, TRACE_FILES[format]), "utf-8");
  } catch {
    return null;
  }
  try {
    return { trace: parseAtif(JSON.parse(text)) };
  } catch (err) {
    const why = err instanceof TraceError ? err.message : err instanceof SyntaxError ? `not JSON: ${err.message}` : String(err);
    return { error: `${TRACE_FILES[format]} unreadable as ${format}: ${why}` };
  }
}
