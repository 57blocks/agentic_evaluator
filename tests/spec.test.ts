import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { compileSpec, loadSpec, parseSpec, SpecError } from "../src/spec/load-spec.js";
import { sha256 } from "../src/canon/hash.js";

const CODEGEN = "specs/codegen-w38.yaml";

test("codegen spec compiles to a Suite with candidate ids, not model ids", async () => {
  const suite = await loadSpec(CODEGEN);
  assert.equal(suite.suiteId, "codegen-w38");
  assert.equal(suite.step, "codegen");
  assert.deepEqual(suite.candidates, ["sonnet-5", "deepseek-v4-pro", "kimi-k3"]);
  assert.equal(suite.candidateDefs?.["sonnet-5"].model, "anthropic/claude-sonnet-5");
  assert.equal(suite.judge, "google/gemini-3.1-pro-preview");
  assert.deepEqual(suite.requiredChecks, ["tsc-noemit"]);
  assert.equal(suite.check?.scaffoldDir, "scaffold");
  assert.equal(suite.trials, 3);
  assert.equal(suite.timeoutMs, 180_000);
  assert.equal(suite.mmd, null);
  assert.equal(suite.specSha?.length, 64);
});

test("prd spec has no required checks and no tsc gate", async () => {
  const suite = await loadSpec("specs/prd-w38.yaml");
  assert.deepEqual(suite.requiredChecks, []);
  assert.equal(suite.check, undefined);
  assert.equal(suite.producer, "prompt");
  assert.equal(suite.promptFile, "prompts/prd.md");
});

test("schema rejects an unknown top-level field", async () => {
  const text = (await fs.readFile(CODEGEN, "utf-8")) + "\nunexpected: 1\n";
  assert.throws(() => parseSpec(text, "x.yaml"), SpecError);
});

test("semantic check rejects a step referencing an undeclared candidate", async () => {
  const text = await fs.readFile(CODEGEN, "utf-8");
  const spec = parseSpec(text.replace("candidate_ids: [sonnet-5, deepseek-v4-pro, kimi-k3]", "candidate_ids: [sonnet-5, ghost]"), "x.yaml");
  assert.throws(() => compileSpec(spec, "x.yaml", sha256(text)), /unknown candidate ids ghost/);
});

test("semantic check rejects a judge from the same vendor as a candidate", async () => {
  const text = await fs.readFile(CODEGEN, "utf-8");
  const spec = parseSpec(text.replace("model: google/gemini-3.1-pro-preview", "model: anthropic/claude-opus-4.8"), "x.yaml");
  assert.throws(() => compileSpec(spec, "x.yaml", sha256(text)), /shares a vendor/);
});

test("same-vendor judge is allowed only with the explicit override", async () => {
  const text = await fs.readFile(CODEGEN, "utf-8");
  const patched = text
    .replace("model: google/gemini-3.1-pro-preview", "model: anthropic/claude-opus-4.8")
    .replace("default_temperature: 0.2", "default_temperature: 0.2\n  allow_same_vendor_judge: true");
  const spec = parseSpec(patched, "x.yaml");
  assert.equal(compileSpec(spec, "x.yaml", sha256(patched)).judge, "anthropic/claude-opus-4.8");
});
