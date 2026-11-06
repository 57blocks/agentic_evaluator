/**
 * A provider's failure must be recorded as the provider's, never as the
 * candidate's output: an HTTP 200 whose body carries an error object is an
 * HTTP failure (retried under §7, cause kept), not an empty completion; and a
 * judge reply with no verdict is a failed judge call, not a round of ties.
 */

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { complete, LlmError } from "../src/llm.js";
import { judgePair } from "../src/judge.js";
import { EvaluatorCallError } from "../src/canon/usage.js";

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...savedEnv };
});

/** Answer every request with `json`, counting the calls. */
function mockFetch(json: unknown | ((n: number) => unknown)): { calls: number } {
  const counter = { calls: 0 };
  globalThis.fetch = (async () => {
    counter.calls += 1;
    const body = typeof json === "function" ? (json as (n: number) => unknown)(counter.calls) : json;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return counter;
}

const USAGE = { prompt_tokens: 10, completion_tokens: 0, cost: 0.0001 };

test("a 200 whose choice carries an error is an http failure with the provider's message, not an empty completion", async () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  mockFetch({
    choices: [{ finish_reason: "error", error: { code: 502, message: "upstream provider timed out" }, message: { content: "" } }],
    usage: USAGE,
  });

  await assert.rejects(complete({ model: "x/y", prompt: "hi", temperature: 0, timeoutMs: 5_000 }), (err: unknown) => {
    assert.ok(err instanceof LlmError);
    assert.equal(err.kind, "http");
    assert.equal(err.httpStatus, 502);
    assert.match(err.message, /upstream provider timed out/);
    return true;
  });
});

test("a 200 whose body is a top-level error object is an http failure", async () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  mockFetch({ error: { code: 400, message: "model not found" } });

  await assert.rejects(complete({ model: "x/y", prompt: "hi", temperature: 0, timeoutMs: 5_000 }), (err: unknown) => {
    assert.ok(err instanceof LlmError);
    assert.equal(err.kind, "http");
    assert.equal(err.httpStatus, 400);
    assert.match(err.message, /model not found/);
    return true;
  });
});

const PAIR = {
  judgeModel: "x/judge",
  timeoutMs: 5_000,
  rubric: "be fair",
  dimensions: ["clarity"],
  inputSlug: "in-1",
  a: "cand-a",
  aText: "alpha",
  b: "cand-b",
  bText: "beta",
};

test("a judge reply with no overall verdict fails the call after its retries instead of counting as ties", async () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  const counter = mockFetch({ choices: [{ message: { content: '{"error":"outputs too long to compare"}' } }], usage: USAGE });

  await assert.rejects(judgePair(PAIR), (err: unknown) => {
    assert.ok(err instanceof EvaluatorCallError);
    assert.match(err.message, /no overall verdict/);
    assert.ok(err.attempts.length >= 3, "every billed attempt is kept");
    return true;
  });
  assert.ok(counter.calls >= 3, "the reply was retried, then given up on");
});

test("a judge reply with an overall verdict but a missing dimension still counts, the dimension as a tie", async () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  const verdict = (winner: string) => ({ choices: [{ message: { content: JSON.stringify({ overall: { winner, reason: "clearer" } }) } }], usage: USAGE });
  // Forward round says A, the swapped round says B: both point at the same candidate.
  mockFetch((n: number) => verdict(n === 1 ? "A" : "B"));

  const judged = await judgePair(PAIR);

  assert.equal(judged.overall.resolved, "a");
  assert.equal(judged.dimensions.clarity.resolved, "tie");
});
