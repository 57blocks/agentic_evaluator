/** Pricing an agent's tokens, its spend cap, and its secrets (docs/design/agb-flow-gaps.md B1-B4). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agentCliAdapter } from "../src/adapters/resolve.js";
import { expandEnv } from "../src/adapters/agent-cli.js";
import { AdapterError, type CandidateRequest } from "../src/adapters/types.js";
import { costOf, resetCatalog } from "../src/pricing.js";
import { runChainArm, type E2eGeneration } from "../src/e2e-control.js";
import type { Suite } from "../src/types.js";

const USAGE = { prompt_tokens: 1_000, completion_tokens: 2_000, cache_read_tokens: 100_000, cache_write_tokens: 10_000 };

/** A command that reports USAGE as tokens and records the env and argv it got. */
function reporter(extra: Partial<CandidateRequest> = {}, argv: string[] = []): CandidateRequest {
  const code = [
    "const fs = require('fs');",
    `fs.writeFileSync('.eval-usage.json', ${JSON.stringify(JSON.stringify(USAGE))});`,
    "fs.writeFileSync('got.json', JSON.stringify({ cap: process.env.EVAL_MAX_COST_USD, price: process.env.EVAL_MODEL_PRICE, key: process.env.PROVIDER_KEY, argv: process.argv.slice(1) }));",
  ].join(" ");
  return {
    stepId: "s", candidateId: "c", inputId: "i", inputText: "go", promptTemplate: "", temperature: 0, timeoutMs: 10_000,
    cli: { argv: [process.execPath, "-e", code, ...argv], reports_usage: "tokens" },
    ...extra,
  };
}

const run = async (req: CandidateRequest) => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pricing-"));
  const r = await agentCliAdapter.execute(req, { workDir, taskRoot: workDir });
  return { r, got: JSON.parse(await fs.readFile(path.join(workDir, "got.json"), "utf-8")) };
};

test("tokens are priced per kind: input, cache reads, cache writes, output", () => {
  const usd = costOf({ input: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000, output: 1_000_000 }, { input: 1, output: 10, cacheRead: 0.1, cacheWrite: 1.25 });
  assert.equal(usd, 1 + 0.1 + 1.25 + 10);
  assert.equal(costOf({ input: 0, cacheRead: 1_000_000, cacheWrite: 0, output: 0 }, { input: 2, output: 8 }), 2, "no cache price: input price");
});

test("a command reporting tokens is priced by agenteval at the candidate's price", async () => {
  const { r } = await run(reporter({ price: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } }));

  assert.equal(r.costSource, "estimated");
  assert.equal(r.costUsd, (1_000 * 2 + 100_000 * 0.2 + 10_000 * 2.5 + 2_000 * 10) / 1e6);
  assert.equal(r.promptTokens, 111_000);
  assert.equal(r.cachedTokens, 100_000);
  assert.equal(r.completionTokens, 2_000);
});

test("without a price the model's catalog price is used, and with neither the cost stays unobserved", async () => {
  resetCatalog(new Map([["vendor/model-x", { input: 1, output: 4 }]]));
  try {
    const priced = await run(reporter({ model: "vendor/model-x" }));
    assert.equal(priced.r.costUsd, (111_000 * 1 + 2_000 * 4) / 1e6);
    assert.equal(priced.r.costSource, "estimated");

    const unknown = await run(reporter({ model: "vendor/not-listed" }));
    assert.equal(unknown.r.costSource, "none");
    assert.equal(unknown.r.costUsd, 0);
    assert.equal(unknown.r.promptTokens, 111_000, "the tokens are still kept");
  } finally {
    resetCatalog();
  }
});

test("the command is handed the step's spend cap and its model's price", async () => {
  const { got } = await run(reporter({ maxCostUsd: 15, price: { input: 2, output: 10 } }, ["cap={{max_cost_usd}}"]));

  assert.equal(got.cap, "15");
  assert.deepEqual(JSON.parse(got.price), { input: 2, output: 10 });
  assert.deepEqual(got.argv, ["cap=15"]);
});

test("${NAME} in cli.env comes from the environment when the command starts", async () => {
  process.env.TEST_PROVIDER_SECRET = "s3cret";
  try {
    const req = reporter();
    const { got } = await run({ ...req, cli: { ...req.cli!, env: { PROVIDER_KEY: "${TEST_PROVIDER_SECRET}" } } });
    assert.equal(got.key, "s3cret");
  } finally {
    delete process.env.TEST_PROVIDER_SECRET;
  }
  assert.throws(() => expandEnv({ KEY: "${NOT_SET_ANYWHERE_XYZ}" }), (e: unknown) => e instanceof AdapterError && /NOT_SET_ANYWHERE_XYZ/.test(e.message));
});

test("a chain stops at a step that never got to finish (an outage, the budget)", async () => {
  const base = { requiredChecks: ["c"], successCriteria: { mandatory_checks: "all" } } as unknown as Suite;
  const steps: string[] = [];

  const report = await runChainArm({
    armId: "control",
    armKind: "control",
    assignment: { a: "x", b: "x" },
    chain: [{ ...base, step: "a" }, { ...base, step: "b", inputFrom: "a" }],
    rootInputs: [{ slug: "i", text: "t" }],
    trials: 1,
    generate: async (step): Promise<E2eGeneration> => {
      steps.push(step.step);
      return { completion_state: "cancelled", text: "", artifacts: [], cost_usd: 0, ms: 0, checks: [] };
    },
  });

  assert.deepEqual(steps, ["a"]);
  assert.equal(report.cases[0]!.aborted, true);
  assert.equal(report.totals.undetermined, 1);
});
