import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { complete, LlmError } from "../src/llm.js";
import { trialHash } from "../src/canon/hash.js";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const realFetch = globalThis.fetch;
const savedEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...savedEnv };
});

/** Replace fetch with one that records the request and answers with `reply`. */
function mockFetch(reply: { status?: number; json?: unknown; text?: string }): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const status = reply.status ?? 200;
    const payload = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.text ?? "");
    return new Response(payload, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

// ── OpenRouter (the default route): pinned before the provider split ──────────

test("openrouter: posts a chat completion and reads provider-reported cost", async () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  const calls = mockFetch({
    json: {
      provider: "Anthropic",
      choices: [{ finish_reason: "stop", message: { content: "hello" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0042, prompt_tokens_details: { cached_tokens: 3 } },
    },
  });

  const r = await complete({ model: "anthropic/claude-sonnet-5", prompt: "hi", temperature: 0.3, maxTokens: 100, jsonMode: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer or-key");
  assert.deepEqual(calls[0].body, {
    model: "anthropic/claude-sonnet-5",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.3,
    max_tokens: 100,
    response_format: { type: "json_object" },
    usage: { include: true },
  });
  assert.equal(r.text, "hello");
  assert.equal(r.costUsd, 0.0042);
  assert.equal(r.costSource, "provider-reported");
  assert.equal(r.promptTokens, 10);
  assert.equal(r.completionTokens, 5);
  assert.equal(r.cachedTokens, 3);
  assert.equal(r.provider, "Anthropic");
  assert.equal(r.finishReason, "stop");
});

test("openrouter: a 400 is an http error and is not retried", async () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  const calls = mockFetch({ status: 400, text: "bad request" });
  await assert.rejects(
    complete({ model: "m/x", prompt: "hi", temperature: 0 }),
    (err: unknown) => err instanceof LlmError && err.kind === "http" && err.httpStatus === 400,
  );
  assert.equal(calls.length, 1);
});

test("openrouter: an empty completion still carries its billed usage", async () => {
  process.env.OPENROUTER_API_KEY = "or-key";
  mockFetch({ json: { choices: [{ message: { content: "  " } }], usage: { prompt_tokens: 4, completion_tokens: 0, cost: 0.001 } } });
  await assert.rejects(
    complete({ model: "m/x", prompt: "hi", temperature: 0 }),
    (err: unknown) => err instanceof LlmError && err.kind === "empty" && err.usage?.costUsd === 0.001,
  );
});

// ── Trial identity: an unchanged openrouter candidate keeps its hash ─────────

test("trial hash of a plain openrouter candidate is unchanged (reuse keeps matching old runs)", () => {
  const hash = trialHash({
    producer: "prompt",
    producerVersion: "1",
    promptTemplateSha: "a".repeat(64),
    inputSha: "b".repeat(64),
    model: "anthropic/claude-sonnet-5",
    temperature: 0.3,
    maxTokens: 4000,
    trial: 0,
  });
  assert.equal(hash, "9b751ebea94f13c1c564e9b03acb504e31ba0f909616ed1a48acaa2b155e6f9c");
});

// ── Direct routes ────────────────────────────────────────────────────────────

const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

test("anthropic: Messages request with no sampling fields, priced from the declared price", async () => {
  process.env.ANTHROPIC_API_KEY = "ant-key";
  const calls = mockFetch({
    json: {
      model: "claude-sonnet-5-5",
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: "hel" }, { type: "text", text: "lo" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 },
    },
  });

  const r = await complete({
    model: "claude-sonnet-5-5",
    prompt: "hi",
    system: "be brief",
    temperature: 0.3,
    temperatureDeclared: true,
    stop: ["END"],
    reasoningEffort: "low",
    jsonMode: true,
    endpoint: { route: "anthropic", price: PRICE },
  });

  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].headers["x-api-key"], "ant-key");
  assert.equal(calls[0].headers["anthropic-version"], "2026-10-21");
  assert.deepEqual(calls[0].body, {
    model: "claude-sonnet-5-5",
    max_tokens: 16000,
    system: "be brief",
    messages: [{ role: "user", content: "hi" }],
    stop_sequences: ["END"],
    output_config: { effort: "low" },
  });
  assert.equal(r.text, "hello");
  assert.equal(r.promptTokens, 1600);
  assert.equal(r.cachedTokens, 500);
  assert.equal(r.costSource, "estimated");
  // (1000×2 + 500×0.2 + 100×2.5 + 200×10) / 1e6
  assert.ok(Math.abs(r.costUsd - 0.00435) < 1e-12);
  assert.equal(r.provider, "claude-sonnet-5-5");
});

test("anthropic: a refusal keeps its explanation", async () => {
  process.env.ANTHROPIC_API_KEY = "ant-key";
  mockFetch({
    json: {
      model: "claude-opus-5-5",
      content: [{ type: "text", text: "I can't help with that." }],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "declined: cyber" },
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  });
  const r = await complete({ model: "claude-opus-5-5", prompt: "x", temperature: 0, endpoint: { route: "anthropic", price: PRICE } });
  assert.equal(r.finishReason, "refusal");
  assert.equal(r.refusal, "declined: cyber");
});

test("a direct route without its key fails before any request", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const calls = mockFetch({ json: {} });
  await assert.rejects(
    complete({ model: "claude-opus-5-5", prompt: "x", temperature: 0, endpoint: { route: "anthropic" } }),
    /ANTHROPIC_API_KEY is not set/,
  );
  assert.equal(calls.length, 0);
});

test("openai: sends only a declared temperature and uses max_completion_tokens", async () => {
  process.env.OPENAI_API_KEY = "oa-key";
  const calls = mockFetch({
    json: {
      model: "gpt-5.5-2026-09-01",
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
      usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } },
    },
  });

  const r = await complete({
    model: "gpt-5.5",
    prompt: "hi",
    temperature: 0.3,
    maxTokens: 500,
    seed: 7,
    reasoningEffort: "high",
    endpoint: { route: "openai", price: PRICE },
  });

  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer oa-key");
  assert.deepEqual(calls[0].body, {
    model: "gpt-5.5",
    messages: [{ role: "user", content: "hi" }],
    max_completion_tokens: 500,
    seed: 7,
    reasoning_effort: "high",
  });
  // (60×2 + 40×0.2 + 10×10) / 1e6
  assert.ok(Math.abs(r.costUsd - 0.000228) < 1e-12);
  assert.equal(r.costSource, "estimated");
  assert.equal(r.provider, "gpt-5.5-2026-09-01");
});

test("openai-compatible: posts to base_url with the declared key env", async () => {
  process.env.DEEPSEEK_API_KEY = "ds-key";
  const calls = mockFetch({
    json: { model: "deepseek-v4-pro", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
  });
  await complete({
    model: "deepseek-v4-pro",
    prompt: "hi",
    system: "sys",
    temperature: 0.3,
    topP: 0.9,
    endpoint: { route: "openai-compatible", baseUrl: "https://api.deepseek.com/v1/", apiKeyEnv: "DEEPSEEK_API_KEY", price: PRICE },
  });
  assert.equal(calls[0].url, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(calls[0].headers.authorization, "Bearer ds-key");
  assert.deepEqual(calls[0].body, {
    model: "deepseek-v4-pro",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ],
    temperature: 0.3,
    top_p: 0.9,
  });
});

test("a direct route with no price records its cost as unobserved, not zero-priced", async () => {
  process.env.OPENAI_API_KEY = "oa-key";
  mockFetch({ json: { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 100, completion_tokens: 10 } } });
  const r = await complete({ model: "gpt-5.5", prompt: "hi", temperature: 0, endpoint: { route: "openai" } });
  assert.equal(r.costSource, "none");
});
