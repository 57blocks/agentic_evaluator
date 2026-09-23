/**
 * Starting a run over HTTP.
 *
 * The dashboard spends money, so most of these assertions are about refusing
 * to: a stale acknowledgement, a second concurrent run, a task that does not
 * exist. The one that does spend is `tasks/smoke-local`, which spends nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { INSTALL_ROOT } from "../src/paths.js";
import { workspaceAt } from "../src/core/workspace.js";
import { createDemoServer, listenDemo } from "../src/demo/server.js";
import type { PlanAck } from "../src/server/runs.js";
import type { RunEvent } from "../src/core/events.js";

async function workspaceWithSmoke(): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "eval-srv-"));
  await fs.cp(path.join(INSTALL_ROOT, "tasks", "smoke-local"), path.join(ws, "tasks", "smoke-local"), {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });
  return ws;
}

interface Fixture {
  origin: string;
  ws: string;
  close: () => Promise<void>;
}

async function serve(): Promise<Fixture> {
  const ws = await workspaceWithSmoke();
  const server = createDemoServer(workspaceAt(ws));
  const origin = await listenDemo(server, 0);
  return {
    origin,
    ws,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(ws, { recursive: true, force: true });
    },
  };
}

async function json(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : JSON.parse(text) };
}

function post(origin: string, body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** Read an SSE stream to its end, returning the events it carried. */
function followRun(origin: string, runId: string): Promise<RunEvent[]> {
  return new Promise((resolve, reject) => {
    const events: RunEvent[] = [];
    const req = http.get(`${origin}/api/runs/${runId}/events`, (res) => {
      let buffer = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          if (frame.startsWith("event: end")) continue;
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (line) events.push(JSON.parse(line.slice(6)) as RunEvent);
        }
      });
      res.on("end", () => resolve(events));
    });
    req.on("error", reject);
  });
}

test("the plan endpoint answers with what a caller must acknowledge", async () => {
  const f = await serve();
  try {
    // Act
    const { status, body } = await json(`${f.origin}/api/plan/smoke-local`);

    // Assert
    assert.equal(status, 200);
    assert.deepEqual(body.ack, { generations: 2, judgeCalls: 0, scoreCalls: 0, budgetUsd: 1 });
    assert.equal(body.plan.steps[0].step, "codegen");
  } finally {
    await f.close();
  }
});

test("a run starts only when the caller echoes the plan it was shown", async () => {
  const f = await serve();
  try {
    // Arrange - an acknowledgement from a page rendered before the spec changed.
    const stale: PlanAck = { generations: 99, judgeCalls: 0, scoreCalls: 0, budgetUsd: 1 };

    // Act
    const refused = await json(`${f.origin}/api/runs`, post(f.origin, { task: "smoke-local", ack: stale }));

    // Assert - refused, and told what the plan says now, so a human re-reads it.
    assert.equal(refused.status, 409);
    assert.deepEqual(refused.body.ack, { generations: 2, judgeCalls: 0, scoreCalls: 0, budgetUsd: 1 });

    // Assert - nothing was written: a refused start is not a run.
    const runsDir = path.join(f.ws, "tasks", "smoke-local", "runs");
    assert.equal(await fs.readdir(runsDir).then((d) => d.length).catch(() => 0), 0);
  } finally {
    await f.close();
  }
});

test("a POST without an ack at all is refused, not defaulted", async () => {
  const f = await serve();
  try {
    const r = await json(`${f.origin}/api/runs`, post(f.origin, { task: "smoke-local" }));
    assert.equal(r.status, 400);
    assert.match(r.body.error, /ack is required/);
  } finally {
    await f.close();
  }
});

test("an unknown task is 404, not a 500", async () => {
  const f = await serve();
  try {
    const r = await json(`${f.origin}/api/plan/nope`);
    assert.equal(r.status, 404);
  } finally {
    await f.close();
  }
});

test("a run started over HTTP streams its events and writes its evidence", async () => {
  const f = await serve();
  try {
    // Arrange
    const { body: planned } = await json(`${f.origin}/api/plan/smoke-local`);

    // Act
    const started = await json(`${f.origin}/api/runs`, post(f.origin, { task: "smoke-local", ack: planned.ack }));
    assert.equal(started.status, 201);
    const events = await followRun(f.origin, started.body.id);

    // Assert - the same stream the CLI renders, over the wire.
    const trials = events.filter((e) => e.type === "trial");
    assert.equal(trials.length, 2);
    const done = events.find((e) => e.type === "step.done") as Extract<RunEvent, { type: "step.done" }>;
    assert.equal(done.chosen, "fake-pass");
    assert.equal(done.ledgerTotal, 0, "nothing was billed");

    // Assert - and the run landed on disk, beside its task.
    const runs = await fs.readdir(path.join(f.ws, "tasks", "smoke-local", "runs"));
    assert.equal(runs.length, 1);

    // Assert - the handle says how it ended.
    const handle = await json(`${f.origin}/api/runs/${started.body.id}`);
    assert.equal(handle.body.status, "done");
    assert.ok(handle.body.finishedAt);
  } finally {
    await f.close();
  }
});

test("a second run is refused while one is in flight", async () => {
  const f = await serve();
  try {
    // Arrange
    const { body: planned } = await json(`${f.origin}/api/plan/smoke-local`);
    const first = await json(`${f.origin}/api/runs`, post(f.origin, { task: "smoke-local", ack: planned.ack }));

    // Act - immediately, while the first is still going.
    const second = await json(`${f.origin}/api/runs`, post(f.origin, { task: "smoke-local", ack: planned.ack }));

    // Assert - two runs would compete for one rate limit and one budget.
    assert.equal(second.status, 409);
    assert.match(second.body.error, /already in flight/);
    assert.equal(second.body.runId, first.body.id);

    await followRun(f.origin, first.body.id);
  } finally {
    await f.close();
  }
});

test("a subscriber that arrives after the run finished still sees the whole run", async () => {
  const f = await serve();
  try {
    // Arrange
    const { body: planned } = await json(`${f.origin}/api/plan/smoke-local`);
    const started = await json(`${f.origin}/api/runs`, post(f.origin, { task: "smoke-local", ack: planned.ack }));
    await followRun(f.origin, started.body.id);

    // Act - subscribe again, well after the end.
    const replay = await followRun(f.origin, started.body.id);

    // Assert - the buffer is the record, not a tail.
    assert.ok(replay.some((e) => e.type === "step.done"));
    assert.equal(replay.filter((e) => e.type === "trial").length, 2);
  } finally {
    await f.close();
  }
});

test("cancelling a run that is not in flight is refused rather than silently accepted", async () => {
  const f = await serve();
  try {
    const r = await json(`${f.origin}/api/runs/no-such-run`, { method: "DELETE" });
    assert.equal(r.status, 409);
  } finally {
    await f.close();
  }
});
