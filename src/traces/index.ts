/**
 * The trace a command candidate leaves in its work dir, read when the spec
 * declares `cli.trace`. One fixed file name per format, like
 * `.eval-usage.json`: the wrapper copies or tees into it, and agenteval
 * never mistakes it for the candidate's output.
 *
 * The file is the candidate's: it is read only as a regular file under the
 * size cap (src/adapters/work-file.ts), and what could not be read is
 * reported by kind, never by quoting it.
 */

import { TraceError, type AgentTrace, type TraceFormat } from "../canon/agent-trace.js";
import { readWorkFile } from "../adapters/work-file.js";
import { parseAtif } from "./atif.js";
import { parseClaudeCodeStream } from "./claude-code.js";

export const TRACE_FILES: Readonly<Record<TraceFormat, string>> = { atif: ".eval-trace.json", "claude-code": ".eval-trace.jsonl" };

export type TraceRead = { trace: AgentTrace } | { error: string } | null;

function parse(format: TraceFormat, text: string): AgentTrace {
  switch (format) {
    case "atif":
      return parseAtif(JSON.parse(text));
    case "claude-code":
      return parseClaudeCodeStream(text);
  }
}

/**
 * The trace in a work dir, or why it could not be read; null when the
 * command left none. Absence is not an error: a killed command may have
 * never got that far, and GAPS says so.
 */
export async function readTraceFile(workDir: string, format: TraceFormat): Promise<TraceRead> {
  const read = await readWorkFile(workDir, TRACE_FILES[format]);
  if (read === null) return null;
  if ("refused" in read) return { error: `${read.refused}; not read as ${format}` };
  try {
    return { trace: parse(format, read.text) };
  } catch (err) {
    if (err instanceof SyntaxError) return { error: `${TRACE_FILES[format]} unreadable as ${format}: not JSON` };
    // TraceError messages name a field, never the file's contents.
    const why = err instanceof TraceError ? err.message : "unexpected shape";
    return { error: `${TRACE_FILES[format]} unreadable as ${format}: ${why}` };
  }
}
