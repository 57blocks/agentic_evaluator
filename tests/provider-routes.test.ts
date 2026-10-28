import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileSpec, parseSpec, loadSpec, loadWorkflow, SpecError } from "../src/spec/load-spec.js";
import { loadCandidatePrompts, loadPromptTemplate } from "../src/core/execute.js";
import { trialAdapterFields } from "../src/adapters/resolve.js";
import { samplingOf } from "../src/adapters/types.js";
import { preflightTask } from "../src/core/preflight.js";
import type { CandidateDef } from "../src/canon/types.js";

const CODEGEN = "tasks/codegen-w38/spec.yaml";
const SONNET = `  - id: sonnet-5
    model: anthropic/claude-sonnet-5
    provider_route: openrouter
    generation_settings: { temperature: 0.2 }`;
const PRICE = "price: { input: 2, output: 10, cache_read: 0.2 }";

async function codegenWith(sonnet: string, judge?: string): Promise<string> {
  let text = (await fs.readFile(CODEGEN, "utf-8")).replace(SONNET, sonnet);
  if (judge) text = text.replace("    model: google/gemini-3.1-pro-preview\n    provider_route: openrouter", judge);
  return text;
}

const TASK_ROOT = path.dirname(path.resolve(CODEGEN));

/** Schema and semantic checks both: the spec must not compile. */
function rejects(text: string, pattern: RegExp): void {
  assert.throws(
    () => compileSpec(parseSpec(text, "x.yaml"), "x.yaml", "sha", TASK_ROOT),
    (err: unknown) => err instanceof SpecError && pattern.test(err.message),
  );
}

// ── Spec validation ──────────────────────────────────────────────────────────

test("a direct route without a price is rejected: its trials would read as free", async () => {
  rejects(await codegenWith(SONNET.replace("openrouter", "anthropic")), /sonnet-5.*needs a price/);
});

test("openai-compatible needs base_url", async () => {
  rejects(await codegenWith(SONNET.replace("openrouter", `openai-compatible\n    ${PRICE}`)), /needs base_url/);
});

test("an unknown route on a model candidate is rejected", async () => {
  rejects(await codegenWith(SONNET.replace("openrouter", "bedrock")), /provider_route "bedrock" is not one of/);
});

test("a per-candidate prompt_file needs the model-api adapter", async () => {
  rejects(await codegenWith(`${SONNET}\n    prompt_file: prompts/x.md`), /prompt_file needs adapter model-api/);
});

test("the judge's route is validated and compiled into the suite", async () => {
  rejects(await codegenWith(SONNET, "    model: gpt-5.5\n    provider_route: openai"), /evaluators\.judge: .*needs a price/);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "routes-"));
  await fs.cp(path.dirname(CODEGEN), dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  await fs.writeFile(
    path.join(dir, "spec.yaml"),
    await codegenWith(SONNET, `    model: gpt-5.5\n    provider_route: openai\n    ${PRICE}`),
  );
  const suite = await loadSpec(path.join(dir, "spec.yaml"));
  assert.equal(suite.judgeEndpoint?.route, "openai");
  assert.deepEqual(suite.judgeEndpoint?.price, { input: 2, output: 10, cacheRead: 0.2 });
});

test("same-vendor judge check sees through bare direct-route model ids", async () => {
  const sonnetDirect = SONNET.replace("anthropic/claude-sonnet-5", "claude-sonnet-5-5").replace("openrouter", `anthropic\n    ${PRICE}`);
  rejects(await codegenWith(sonnetDirect, "    model: anthropic/claude-opus-5.5\n    provider_route: openrouter"), /shares a vendor/);
});

// ── Trial identity ───────────────────────────────────────────────────────────

const plain: CandidateDef = { id: "s", model: "anthropic/claude-sonnet-5", provider_route: "openrouter", generation_settings: { temperature: 0.2 } };

test("a plain openrouter candidate adds nothing to its trial identity", () => {
  assert.deepEqual(trialAdapterFields(plain, "prompt"), {});
  assert.deepEqual(trialAdapterFields({ ...plain, price: { input: 1, output: 2 } }, "prompt"), {});
});

test("route, system prompt and settings change the trial identity; price and key do not", () => {
  const direct = trialAdapterFields({ ...plain, provider_route: "anthropic" }, "prompt");
  assert.equal(direct.adapter, "model-api");
  assert.ok(direct.adapterConfigSha);

  const repriced = trialAdapterFields({ ...plain, provider_route: "anthropic", price: { input: 9, output: 9 }, api_key_env: "OTHER" }, "prompt");
  assert.deepEqual(repriced, direct);

  const shas = [
    direct,
    trialAdapterFields({ ...plain, system: "be brief" }, "prompt"),
    trialAdapterFields({ ...plain, generation_settings: { temperature: 0.2, reasoning_effort: "high" } }, "prompt"),
    trialAdapterFields({ ...plain, provider_route: "openai-compatible", base_url: "http://a/v1" }, "prompt"),
    trialAdapterFields({ ...plain, provider_route: "openai-compatible", base_url: "http://b/v1" }, "prompt"),
  ].map((f) => f.adapterConfigSha);
  assert.equal(new Set(shas).size, shas.length);
});

test("only declared settings are sent", () => {
  assert.deepEqual(samplingOf(plain), { temperatureDeclared: true });
  assert.deepEqual(samplingOf({ id: "x", model: "m" }), {});
  assert.deepEqual(samplingOf({ id: "x", model: "m", system: "s", generation_settings: { top_p: 0.9, seed: 1, stop: ["E"], reasoning_effort: "low" } }), {
    system: "s",
    topP: 0.9,
    seed: 1,
    stop: ["E"],
    reasoningEffort: "low",
  });
});

// ── Preflight ────────────────────────────────────────────────────────────────

test("check-task blocks a direct route whose key is not set, and warns about settings it will not send", async () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "routes-"));
    await fs.cp(path.dirname(CODEGEN), dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
    const direct = SONNET.replace("anthropic/claude-sonnet-5", "claude-sonnet-5-5").replace("openrouter", `anthropic\n    ${PRICE}`);
    await fs.writeFile(path.join(dir, "spec.yaml"), await codegenWith(direct));

    const report = await preflightTask(path.join(dir, "spec.yaml"));
    const all = report.steps.flatMap((s) => s.findings);
    const key = all.find((f) => f.code === "endpoint.key-missing");
    assert.equal(key?.severity, "blocking");
    assert.match(key?.message ?? "", /ANTHROPIC_API_KEY/);
    const unsent = all.find((f) => f.code === "endpoint.setting-not-sent");
    assert.equal(unsent?.severity, "warning");
    assert.match(unsent?.message ?? "", /temperature/);
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  }
});

// ── Prompt variants ──────────────────────────────────────────────────────────

test("a candidate's own prompt_file is loaded over the step's, with its own hash", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "routes-"));
  await fs.cp("tasks/prd-w38", dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  await fs.writeFile(path.join(dir, "prompts", "prd-terse.md"), "Write a one-page PRD for:\n\n{{input}}\n");
  // A variant is its own candidate, in the prompt step only (codegen has no template).
  const spec = (await fs.readFile(path.join(dir, "spec.yaml"), "utf-8"))
    .replace("candidate_ids: [sonnet-5, deepseek-v4-pro, kimi-k3]", "candidate_ids: [sonnet-5, sonnet-terse, deepseek-v4-pro, kimi-k3]")
    .replace("\ncandidates:\n", "\ncandidates:\n  - id: sonnet-terse\n    model: anthropic/claude-sonnet-5\n    prompt_file: prompts/prd-terse.md\n");
  await fs.writeFile(path.join(dir, "spec.yaml"), spec);
  const first = "sonnet-terse";

  const [suite] = await loadWorkflow(path.join(dir, "spec.yaml"));
  const prompts = await loadCandidatePrompts(suite);
  const { promptTemplateSha } = await loadPromptTemplate(suite, "prompt");

  assert.deepEqual([...prompts.keys()], [first]);
  assert.match(prompts.get(first)!.promptTpl, /one-page PRD/);
  assert.notEqual(prompts.get(first)!.promptTemplateSha, promptTemplateSha);
});

test("a vendor's default key is not sent to another host, nor over plain http", async () => {
  const direct = (extra: string) => SONNET.replace("openrouter", `anthropic\n    ${PRICE}\n    ${extra}`);
  rejects(await codegenWith(direct("base_url: https://proxy.example/v1")), /needs api_key_env/);
  rejects(await codegenWith(direct("base_url: http://proxy.example/v1\n    api_key_env: PROXY_KEY")), /must use https/);
  const compatible = (extra: string) => SONNET.replace("openrouter", `openai-compatible\n    ${PRICE}\n    ${extra}`);
  rejects(await codegenWith(compatible("base_url: http://gpu-box:8000/v1\n    api_key_env: VLLM_KEY")), /must use https/);

  // Keyless local servers, loopback, and an explicitly keyed proxy all compile.
  for (const ok of [
    direct("base_url: https://proxy.example/v1\n    api_key_env: PROXY_KEY"),
    compatible("base_url: http://gpu-box:8000/v1"),
    compatible("base_url: http://localhost:11434/v1\n    api_key_env: OLLAMA_KEY"),
  ]) {
    const text = await codegenWith(ok);
    assert.doesNotThrow(() => compileSpec(parseSpec(text, "x.yaml"), "x.yaml", "sha", TASK_ROOT));
  }
});
