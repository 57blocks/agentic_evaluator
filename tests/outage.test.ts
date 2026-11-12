/**
 * A network outage must pause a run, not fail it; a dead network must end
 * the run cleanly, not burn the budget recording provider errors.
 *
 * Both come from the 2026-10-30 claim-denials run: a few minutes of outage
 * cost 1,569 trials and $25 because each call gave up after three seconds
 * and the run kept dispatching. The gate (src/transport-gate.ts) and the
 * halt (src/canon/halt.ts) are the two guards that would have held it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { TransportGate, transportGap, transportGate } from "../src/transport-gate.js";
import { ProviderErrorHalt, haltGap } from "../src/canon/halt.js";
import { complete, LlmError } from "../src/llm.js";
import { runSuite } from "../src/core/execute.js";
import type { RunEvent } from "../src/core/events.js";

/* ── the gate ────────────────────────────────────────────────────────────── */

/** A gate on a fake clock: `sleep` advances time instead of waiting. */
function fakeGate(options: { pauseAfter?: number; maxPauseMs?: number } = {}): { gate: TransportGate; slept: number[]; clock: { now: number } } {
  const clock = { now: 1_000_000 };
  const slept: number[] = [];
  const gate = new TransportGate({
    pauseAfter: options.pauseAfter ?? 3,
    baseDelayMs: 5_000,
    maxDelayMs: 60_000,
    maxPauseMs: options.maxPauseMs ?? 600_000,
    now: () => clock.now,
    sleep: async (ms) => {
      slept.push(ms);
      clock.now += ms;
    },
  });
  return { gate, slept, clock };
}

test("too few failures in a row never close the gate", async () => {
  const { gate, slept } = fakeGate();
  assert.equal(gate.failed(), false);
  assert.equal(gate.failed(), false);
  gate.succeeded();
  assert.equal(gate.failed(), false);
  await gate.wait();
  assert.deepEqual(slept, []);
  assert.deepEqual(gate.state(), { pauses: 0, paused_ms: 0, gave_up: false });
});

test("three consecutive failures close the gate; waiters sleep out the pause; a success reopens it", async () => {
  const { gate, slept } = fakeGate();
  const events: string[] = [];
  gate.subscribe((e) => events.push(e.type));

  gate.failed();
  gate.failed();
  assert.equal(gate.failed(), true, "the third failure closes the gate");
  assert.equal(gate.failed(), true, "a sibling call arriving while it is closed also waits");
  await gate.wait();
  assert.deepEqual(slept, [5_000]);

  gate.succeeded();
  await gate.wait();
  assert.deepEqual(slept, [5_000], "an open gate holds nobody");
  assert.deepEqual(events, ["paused", "resumed"]);
  assert.deepEqual(gate.state(), { pauses: 1, paused_ms: 5_000, gave_up: false });
});

test("pauses double up to a minute while the outage lasts, and the gate gives up after its total", async () => {
  const { gate, slept } = fakeGate({ maxPauseMs: 150_000 });
  const delays: number[] = [];
  gate.subscribe((e) => {
    if (e.type === "paused") delays.push(e.delayMs);
  });
  // Every probe fails: 5 + 10 + 20 + 40 + 60 = 135 s, then 15 s to the cap, then give up.
  for (let i = 0; i < 3; i++) gate.failed();
  await gate.wait();
  for (let round = 0; round < 5; round++) {
    assert.equal(gate.failed(), true, `probe ${round + 1} still waits`);
    await gate.wait();
  }
  assert.deepEqual(delays, [5_000, 10_000, 20_000, 40_000, 60_000, 15_000]);
  assert.deepEqual(slept, delays);
  assert.equal(gate.failed(), false, "past the total, callers are on their own");
  assert.deepEqual(gate.state(), { pauses: 6, paused_ms: 150_000, gave_up: true });
  assert.match(transportGap(gate.state())!, /paused 6 time\(s\), 2\.5 min in all.*gave up/);

  // The network comes back: the next outage gets the full wait again.
  gate.succeeded();
  for (let i = 0; i < 3; i++) gate.failed();
  assert.equal(gate.failed(), true, "armed again for the next outage");
  assert.deepEqual(delays.slice(6), [5_000]);
  assert.deepEqual(gate.state(), { pauses: 7, paused_ms: 155_000, gave_up: true });
});

test("the shared gate is off until a run turns it on", () => {
  assert.equal(transportGate.failed(), false);
  assert.equal(transportGate.failed(), false);
  assert.equal(transportGate.failed(), false);
  transportGate.succeeded();
});

test("a zero total turns pausing off", () => {
  const { gate } = fakeGate({ maxPauseMs: 0 });
  for (let i = 0; i < 5; i++) assert.equal(gate.failed(), false);
  assert.equal(transportGap(gate.state()), null);
});

/* ── complete() at the gate ──────────────────────────────────────────────── */

/** Stub fetch: each entry is a response, or an Error to throw. Restored by the caller. */
function stubFetch(script: Array<Error | { status: number; body: unknown }>): { calls: () => number } {
  let n = 0;
  globalThis.fetch = (async () => {
    const next = script[Math.min(n, script.length - 1)];
    n += 1;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls: () => n };
}

const ok = { status: 200, body: { choices: [{ message: { content: "fine" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };

test("a call waits at the closed gate without spending its own retries, and comes back with the network", async () => {
  const realFetch = globalThis.fetch;
  const { gate, slept } = fakeGate({ pauseAfter: 1 });
  // Four network errors would exhaust two own retries; at the gate they are waits.
  const stub = stubFetch([new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("fetch failed"), new TypeError("fetch failed"), ok]);
  const retries: unknown[] = [];
  try {
    const result = await complete({
      model: "fake/model",
      prompt: "p",
      temperature: 0,
      endpoint: { route: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1" },
      gate,
      trace: (e) => {
        if (e.type === "model.retry") retries.push(e.context?.outage);
      },
    });
    assert.equal(result.text, "fine");
    assert.equal(result.transportRetries, 4);
    assert.equal(stub.calls(), 5);
    assert.deepEqual(retries, [true, true, true, true]);
    assert.deepEqual(slept, [5_000, 10_000, 20_000, 40_000]);
    assert.equal(gate.state().gave_up, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("once the gate has given up, a call fails after its own two retries as before", async () => {
  const realFetch = globalThis.fetch;
  const { gate } = fakeGate({ pauseAfter: 1, maxPauseMs: 0 });
  const stub = stubFetch([new TypeError("fetch failed")]);
  try {
    await assert.rejects(
      complete({ model: "fake/model", prompt: "p", temperature: 0, endpoint: { route: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1" }, gate }),
      (err: unknown) => err instanceof LlmError && err.kind === "network" && err.transportRetries === 2,
    );
    assert.equal(stub.calls(), 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ── the halt ────────────────────────────────────────────────────────────── */

test("the halt trips on consecutive provider errors only, and any answer resets it", () => {
  const halt = new ProviderErrorHalt(3);
  halt.record("provider_error");
  halt.record("provider_error");
  halt.record("timeout");
  halt.record("provider_error");
  halt.record("malformed");
  halt.record("provider_error");
  halt.record("provider_error");
  assert.equal(halt.tripped, false, "timeouts and empties are candidates' results; they break the run");
  halt.record("provider_error");
  assert.equal(halt.tripped, true);
  assert.equal(halt.allows("generation"), false);
  assert.equal(halt.allows("judging"), false);
  assert.equal(halt.state().skipped.generation, 1);
  assert.match(haltGap(halt.state())!, /3 consecutive calls failed.*1 generation\(s\), 1 judgement\(s\)/);
});

test("one slow candidate's timeouts never halt the run, however many in a row", () => {
  const halt = new ProviderErrorHalt(10, 3);
  for (let i = 0; i < 20; i++) halt.record("timeout", { candidate: "slow", trial: { candidate: "slow", input: `in-${i}`, trial: 1 } });
  assert.equal(halt.tripped, false);
  assert.equal(halt.state().longest_timeout_run, 20);
});

test("timeouts across two candidates halt the run, and the halt names the timeouts it blamed on the link", () => {
  // Arrange
  const halt = new ProviderErrorHalt(10, 3);
  const t = (candidate: string, input: string) => ({ candidate, trial: { candidate, input, trial: 1 } });

  // Act: a, b, a time out back to back; one more times out while in flight
  halt.record("timeout", t("a", "in-1"));
  halt.record("success", t("b", "in-1"));
  halt.record("timeout", t("a", "in-2"));
  halt.record("timeout", t("b", "in-2"));
  assert.equal(halt.tripped, false, "an answer in between reset the streak");
  halt.record("timeout", t("a", "in-3"));
  halt.record("timeout", t("b", "in-3"));

  // Assert
  assert.equal(halt.tripped, true);
  assert.equal(halt.trippedBy, "timeouts");
  assert.equal(halt.allows("generation"), false);
  const st = halt.state();
  assert.deepEqual(st.halted_timeouts?.map((h) => `${h.candidate}:${h.input}`), ["a:in-2", "b:in-2", "a:in-3", "b:in-3"], "the tripping streak, then the one in flight");
  assert.equal(st.halted_timeouts?.some((h) => h.input === "in-1"), false);
  assert.match(haltGap(st)!, /timeouts halted the run.*4 consecutive calls.*1 generation\(s\).*`run --reuse`: it generates those timeouts again/);
});

test("provider errors and timeouts together make one unanswered streak", () => {
  const halt = new ProviderErrorHalt(10, 4);
  halt.record("provider_error", { candidate: "a" });
  halt.record("timeout", { candidate: "b", trial: { candidate: "b", input: "in-1", trial: 1 } });
  halt.record("provider_error", { candidate: "a" });
  halt.record("timeout", { candidate: "b", trial: { candidate: "b", input: "in-2", trial: 1 } });
  assert.equal(halt.trippedBy, "timeouts");
});

test("a streak of provider errors alone is the provider-error halt's, not the timeout halt's", () => {
  const halt = new ProviderErrorHalt(3, 3);
  for (const c of ["a", "b", "a"]) halt.record("provider_error", { candidate: c });
  assert.equal(halt.trippedBy, "provider_errors");
  assert.equal(halt.state().halted_timeouts, undefined);
});

test("a null timeout limit turns the timeout halt off", () => {
  const halt = new ProviderErrorHalt(10, null);
  for (let i = 0; i < 50; i++) halt.record("timeout", { candidate: i % 2 ? "a" : "b" });
  assert.equal(halt.tripped, false);
});

test("a null limit turns the halt off", () => {
  const halt = new ProviderErrorHalt(null);
  for (let i = 0; i < 50; i++) halt.record("provider_error");
  assert.equal(halt.tripped, false);
  assert.equal(haltGap(halt.state()), null);
});

/* ── a whole run against a flaky local endpoint ──────────────────────────── */

/** An OpenAI-compatible endpoint that answers, or refuses with 503, per request. */
async function fakeEndpoint(refuse: (prompt: string) => boolean): Promise<{ url: string; requests: string[]; close: () => Promise<void> }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const prompt: string = JSON.parse(body).messages.at(-1).content;
      requests.push(prompt);
      if (refuse(prompt)) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "upstream unavailable" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "fake/model", choices: [{ message: { content: `answer to ${prompt}` }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 3 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

const INPUTS = Array.from({ length: 12 }, (_, i) => `in-${String(i + 1).padStart(2, "0")}`);

async function outageTask(baseUrl: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-outage-"));
  const task = path.join(dir, "tasks", "outage");
  await fs.mkdir(path.join(task, "inputs"), { recursive: true });
  await fs.mkdir(path.join(task, "prompts"), { recursive: true });
  await fs.mkdir(path.join(task, "rubrics"), { recursive: true });
  for (const slug of INPUTS) await fs.writeFile(path.join(task, "inputs", `${slug}.txt`), `${slug}\n`);
  await fs.writeFile(path.join(task, "prompts", "p.md"), "{{input}}");
  await fs.writeFile(path.join(task, "rubrics", "r.md"), "# unused\n");
  await fs.writeFile(
    path.join(task, "spec.yaml"),
    [
      'protocol_version: "0.3"',
      "run_name: outage",
      "budget_usd: 1",
      "workflow:",
      "  control_candidate: local",
      "  steps:",
      "    - id: answer",
      '      version: "1"',
      "      producer: prompt",
      "      prompt_file: prompts/p.md",
      "      rubric_file: rubrics/r.md",
      `      test_set: { id: q-v1, inputs: [${INPUTS.join(", ")}] }`,
      "      candidate_ids: [local]",
      "      required_checks: []",
      "      judged_dimensions: []",
      "      operating_mode: lowest-cost",
      "      maximum_completion_time_seconds: 10",
      "candidates:",
      "  - id: local",
      "    model: fake/model",
      "    provider_route: openai-compatible",
      `    base_url: ${baseUrl}`,
      "    price: { input: 1, output: 1 }",
      "evaluators:",
      "  required_checks: {}",
      "  judge:",
      "    model: google/gemini-3.1-pro-preview",
      "    provider_route: openrouter",
      "    rubric_file: rubrics/r.md",
      "    methods: []",
      "execution:",
      "  trials_per_case: 1",
      "  concurrency: 1",
      "  outage_wait_seconds: 0",
      "  max_consecutive_provider_errors: 4",
      "x-harness:",
      "  producer: prompt",
      "  prompt_file: prompts/p.md",
      "",
    ].join("\n"),
  );
  return path.join(task, "spec.yaml");
}

const trialsOf = (events: RunEvent[]) => events.filter((e): e is Extract<RunEvent, { type: "trial" }> => e.type === "trial");

test("a run halts after four consecutive provider errors, records what it skipped, and --reuse finishes it", async () => {
  // Arrange: the endpoint answers the first four inputs and refuses the rest, so
  // with concurrency 1 the halt trips at in-08 and in-09..in-12 never start.
  const down = new Set(INPUTS.slice(4));
  const endpoint = await fakeEndpoint((prompt) => down.has(prompt.trim()));
  const spec = await outageTask(endpoint.url);
  const first: RunEvent[] = [];
  try {
    // Act
    const result = await runSuite(spec, false, { yes: true, onEvent: (e) => first.push(e) });

    // Assert: 4 answered, 4 provider errors, 4 skipped for the halt; the run says so everywhere
    const trials = trialsOf(first);
    assert.equal(trials.filter((t) => t.state === "success").length, 4);
    assert.equal(trials.filter((t) => t.state === "provider_error").length, 4);
    assert.deepEqual(trials.filter((t) => t.state === "skipped").map((t) => [t.input, t.skipReason]), INPUTS.slice(8).map((i) => [i, "provider-errors"]));
    const halted = first.find((e): e is Extract<RunEvent, { type: "run.halted" }> => e.type === "run.halted");
    assert.deepEqual(halted && { consecutive: halted.consecutive, skipped: halted.skipped }, { consecutive: 4, skipped: { generation: 4, judging: 0, scoring: 0 } });
    const runDir = result!.dir;
    const summary = JSON.parse(await fs.readFile(path.join(runDir, "summary.json"), "utf-8"));
    assert.equal(summary.halt.stopped, true);
    assert.equal(summary.halt.max_consecutive_provider_errors, 4);
    assert.deepEqual(summary.transport, { pauses: 0, paused_ms: 0, gave_up: false });
    assert.match(await fs.readFile(path.join(runDir, "GAPS.md"), "utf-8"), /provider errors halted the run.*4 consecutive calls.*4 generation\(s\)/);
    const manifest = JSON.parse(await fs.readFile(path.join(runDir, "manifest.json"), "utf-8"));
    assert.equal(manifest.execution.max_consecutive_provider_errors, 4);
    assert.equal(manifest.execution.outage_wait_seconds, 0);
    // The halt never changed a rate: provider errors are outside the denominators.
    const local = summary.candidates.find((c: { candidate: string }) => c.candidate === "local");
    assert.equal(local.completion_states.provider_error, 4);
    assert.equal(local.reliability.denominator, 4, "the four provider errors are not in the denominator");

    // Act again: the network is back; reuse keeps the four answers and runs the other eight.
    down.clear();
    const second: RunEvent[] = [];
    process.env.EVAL_REUSE = "1";
    try {
      await runSuite(spec, false, { yes: true, onEvent: (e) => second.push(e) });
    } finally {
      delete process.env.EVAL_REUSE;
    }
    const again = trialsOf(second);
    assert.equal(again.filter((t) => t.reusedFrom).length, 4, JSON.stringify(again));
    assert.equal(again.filter((t) => !t.reusedFrom && t.state === "success").length, 8);
    assert.equal(second.some((e) => e.type === "run.halted"), false);
    assert.equal(endpoint.requests.length, 8 + 8 + 8, "4 answers + 4 refusals + 4 own retries each ×2, then 8 fresh calls");
  } finally {
    await endpoint.close();
    await fs.rm(path.dirname(path.dirname(path.dirname(spec))), { recursive: true, force: true });
  }
});

/* ── a whole run against an endpoint that hangs ──────────────────────────── */

/** An OpenAI-compatible endpoint that answers, or never answers at all, per request. */
async function hangingEndpoint(hang: (prompt: string) => boolean): Promise<{ url: string; requests: string[]; close: () => Promise<void> }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const prompt: string = JSON.parse(body).messages.at(-1).content;
      requests.push(prompt);
      if (hang(prompt)) return; // a black-holed request: no reply, no error
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "fake/model", choices: [{ message: { content: `answer to ${prompt}` }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 3 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

const HANG_INPUTS = INPUTS.slice(0, 6);

/** Two candidates on one endpoint, half a second each, halted after four unanswered calls. */
async function hangTask(baseUrl: string): Promise<string> {
  const spec = await outageTask(baseUrl);
  const text = (await fs.readFile(spec, "utf-8"))
    .replace(`inputs: [${INPUTS.join(", ")}]`, `inputs: [${HANG_INPUTS.join(", ")}]`)
    .replace("candidate_ids: [local]", "candidate_ids: [local, other]")
    .replace("maximum_completion_time_seconds: 10", "maximum_completion_time_seconds: 0.5")
    .replace("max_consecutive_provider_errors: 4", "max_consecutive_provider_errors: 4\n  max_consecutive_timeouts: 4")
    .replace("    price: { input: 1, output: 1 }\n", `    price: { input: 1, output: 1 }\n  - id: other\n    model: fake/other\n    provider_route: openai-compatible\n    base_url: ${baseUrl}\n    price: { input: 1, output: 1 }\n`);
  await fs.writeFile(spec, text);
  return spec;
}

test("a run halts on timeouts across candidates, and --reuse generates those timeouts again", async () => {
  // Arrange: the first two inputs are answered, then every request hangs. With
  // concurrency 1 the order is input by input, local then other: four
  // timeouts (in-03, in-04) trip the halt and in-05, in-06 never start.
  const down = new Set(HANG_INPUTS.slice(2));
  const endpoint = await hangingEndpoint((prompt) => down.has(prompt.trim()));
  const spec = await hangTask(endpoint.url);
  const first: RunEvent[] = [];
  try {
    // Act
    const result = await runSuite(spec, false, { yes: true, onEvent: (e) => first.push(e) });

    // Assert
    const trials = trialsOf(first);
    assert.equal(trials.filter((t) => t.state === "success").length, 4);
    assert.equal(trials.filter((t) => t.state === "timeout").length, 4);
    assert.deepEqual(new Set(trials.filter((t) => t.state === "skipped").map((t) => t.skipReason)), new Set(["timeouts"]));
    assert.equal(trials.filter((t) => t.state === "skipped").length, 4);
    const halted = first.find((e): e is Extract<RunEvent, { type: "run.halted" }> => e.type === "run.halted");
    assert.deepEqual(halted && { reason: halted.reason, consecutive: halted.consecutive }, { reason: "timeouts", consecutive: 4 });
    const summary = JSON.parse(await fs.readFile(path.join(result!.dir, "summary.json"), "utf-8"));
    assert.equal(summary.halt.reason, "timeouts");
    assert.equal(summary.halt.halted_timeouts.length, 4);
    assert.match(await fs.readFile(path.join(result!.dir, "GAPS.md"), "utf-8"), /timeouts halted the run/);
    const manifest = JSON.parse(await fs.readFile(path.join(result!.dir, "manifest.json"), "utf-8"));
    assert.equal(manifest.execution.max_consecutive_timeouts, 4);

    // Act again: the link is back. The answers are reused; the blamed timeouts are not.
    down.clear();
    const before = endpoint.requests.length;
    const second: RunEvent[] = [];
    process.env.EVAL_REUSE = "1";
    try {
      await runSuite(spec, false, { yes: true, onEvent: (e) => second.push(e) });
    } finally {
      delete process.env.EVAL_REUSE;
    }
    const again = trialsOf(second);
    assert.equal(again.filter((t) => t.reusedFrom).length, 4, JSON.stringify(again));
    assert.equal(again.filter((t) => t.reusedFrom && t.state === "timeout").length, 0, "no blamed timeout is kept");
    assert.equal(again.filter((t) => !t.reusedFrom && t.state === "success").length, 8);
    assert.equal(endpoint.requests.length - before, 8);
    assert.equal(second.some((e) => e.type === "run.halted"), false);
  } finally {
    await endpoint.close();
    await fs.rm(path.dirname(path.dirname(path.dirname(spec))), { recursive: true, force: true });
  }
});
