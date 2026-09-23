/**
 * Events as newline-delimited JSON.
 *
 * What `--json` gives a script, and the same objects the dashboard receives
 * over SSE — one shape for both, so a thing that reads a run does not have to
 * care whether it came from a pipe or a socket.
 */

import type { RunEvent, RunEventSink } from "../core/events.js";

export function jsonSink(write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): RunEventSink {
  return (event: RunEvent) => write(JSON.stringify(strip(event)));
}

/**
 * `step.done.rows` is every trial row of the step, carried so a renderer can
 * build its own table. They are already on disk as `scores.jsonl`, one row per
 * line, and repeating all of them on one event line makes the stream unusable
 * to read. The counts and the recommendation stay.
 */
function strip(event: RunEvent): RunEvent {
  if (event.type !== "step.done") return event;
  const { rows: _rows, ...rest } = event;
  return { ...rest, rows: [] };
}
