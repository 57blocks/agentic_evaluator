import { test } from "node:test";
import assert from "node:assert/strict";
import { loadLegacySuite, loadSuiteOrSpec } from "../src/spec/load-spec.js";

test("legacy suites/codegen.json synthesizes candidate defs keyed by model id", async () => {
  const suite = await loadLegacySuite("suites/codegen.json");
  assert.ok(suite.candidates.length > 0);
  for (const id of suite.candidates) {
    const def = suite.candidateDefs?.[id];
    assert.ok(def, `no candidateDef for ${id}`);
    assert.equal(def.model, id);
    assert.equal(def.provider_route, "openrouter");
    assert.equal(def.adapter, "codegen");
  }
  assert.deepEqual(suite.requiredChecks, ["tsc-noemit"]);
  assert.deepEqual(suite.successCriteria, { mandatory_checks: "all" });
  assert.equal(suite.specSha?.length, 64);
});

test("legacy prd suite has no required checks", async () => {
  const suite = await loadLegacySuite("suites/prd.json");
  assert.deepEqual(suite.requiredChecks, []);
  assert.equal(suite.successCriteria, undefined);
  assert.equal(suite.producer, "prompt");
  assert.equal(suite.candidateDefs?.[suite.candidates[0]]?.adapter, "model-api");
});

test("loader picks YAML vs JSON by extension", async () => {
  const yaml = await loadSuiteOrSpec("tasks/codegen-w38/spec.yaml");
  const json = await loadSuiteOrSpec("suites/codegen.json");
  assert.equal(yaml.candidateDefs?.["sonnet-5"]?.model, "anthropic/claude-sonnet-5");
  assert.equal(json.candidateDefs?.["anthropic/claude-sonnet-5"]?.model, "anthropic/claude-sonnet-5");
});
