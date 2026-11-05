/**
 * trace.jsonl is written through a promise chain so rows land in emit order.
 * One failed append must not break the chain for every later row, and must
 * not become an unhandled rejection that kills the run mid-generation; the
 * run learns of it when the trace is closed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openTrace } from "../src/canon/trace.js";

test("a failed append is reported by failure(), not as an unhandled rejection, and later rows still land", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ae-trace-sink-"));
  const sink = await openTrace(dir, "run-1");
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown): void => {
    unhandled.push(err);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    sink.emit({ type: "model.request", model: "m", promptSha: "a", promptChars: 1 });
    await sink.flush();
    // The file goes away under the sink: the next append fails.
    await fs.rm(sink.file);
    await fs.mkdir(sink.file);
    sink.emit({ type: "model.request", model: "m", promptSha: "b", promptChars: 1 });
    await sink.flush().catch(() => undefined);
    await fs.rm(sink.file, { recursive: true });
    // Back to a file: the chain is still alive and this row lands.
    sink.emit({ type: "model.request", model: "m", promptSha: "c", promptChars: 1 });

    assert.equal(await sink.close(), 3, "close() counts the rows and never rejects");
    assert.match(sink.failure() ?? "", /EISDIR/);
    const rows = (await fs.readFile(sink.file, "utf-8")).trim().split("\n");
    assert.ok(rows.some((r) => /"promptSha":"c"/.test(r)), "the row emitted after the failure was still written");
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});
