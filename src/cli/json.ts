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
 * `step.done.markdown` is the legacy report, carried on the event so a
 * terminal can still print it at the end of a run. It is already on disk as
 * `report.md`, and a machine reading this stream wants the row, not a second
 * copy of a rendering of it.
 */
function strip(event: RunEvent): RunEvent {
  if (event.type !== "step.done") return event;
  const { markdown: _markdown, ...rest } = event;
  return rest;
}
