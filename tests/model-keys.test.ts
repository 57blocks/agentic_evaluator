import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runSuite } from "../src/core/execute.js";
import { missingModelKeys } from "../src/core/model-keys.js";
import { preflightTask } from "../src/core/preflight.js";
import { loadWorkflow } from "../src/spec/load-spec.js";

const KEY = "OPENROUTER_API_KEY";

/** Run `body` with OPENROUTER_API_KEY set to `value` (undefined = unset), restoring it after. */
async function withKey<T>(value: string | undefined, body: () => Promise<T>): Promise<T> {
  const saved = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try {
    return await body();
  } finally {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  }
}

/** A throwaway copy of a bundled task, without its runs. */
async function copyTask(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keys-"));
  await fs.cp(path.join("tasks", name), dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}runs`) });
  return dir;
}

test("run refuses to start without the OpenRouter key, and writes no run", async () => {
  // Arrange
  const dir = await copyTask("codegen-w38");

  // Act + Assert
  await withKey(undefined, () =>
    assert.rejects(runSuite(path.join(dir, "spec.yaml"), false, { yes: true }), /cannot start[\s\S]*OPENROUTER_API_KEY/),
  );
  assert.equal(await fs.stat(path.join(dir, "runs")).catch(() => null), null, "no run directory is written");

  await fs.rm(dir, { recursive: true, force: true });
});

test("an empty key counts as missing", async () => {
  const dir = await copyTask("codegen-w38");
  const [suite] = await loadWorkflow(path.join(dir, "spec.yaml"));

  const missing = await withKey("", async () => missingModelKeys(suite));

  assert.ok(missing.some((k) => k.env === KEY));
  await fs.rm(dir, { recursive: true, force: true });
});

test("a preview needs no key", async () => {
  const dir = await copyTask("codegen-w38");

  const planned = await withKey(undefined, () => runSuite(path.join(dir, "spec.yaml"), false, {}));

  assert.equal(planned, null);
  await fs.rm(dir, { recursive: true, force: true });
});

test("a CLI agent with no judging method needs no key", async () => {
  const dir = await copyTask("smoke-local");
  const suites = await loadWorkflow(path.join(dir, "spec.yaml"));

  const missing = await withKey(undefined, async () => suites.flatMap(missingModelKeys));

  assert.deepEqual(missing, []);
  await fs.rm(dir, { recursive: true, force: true });
});

test("the judge's key is required only when the step judges", async () => {
  // Arrange - a CLI agent candidate, judged: only the judge needs the key.
  const dir = await copyTask("smoke-workflow");
  const suites = await loadWorkflow(path.join(dir, "spec.yaml"));

  const missing = await withKey(undefined, async () => suites.flatMap(missingModelKeys));

  assert.ok(missing.length > 0);
  assert.ok(missing.every((k) => k.who.startsWith("judge ") && k.env === KEY));
  await fs.rm(dir, { recursive: true, force: true });
});

test("check-task warns, without blocking, when the OpenRouter key is not set", async () => {
  const dir = await copyTask("codegen-w38");

  const report = await withKey(undefined, () => preflightTask(path.join(dir, "spec.yaml")));

  const keys = report.steps.flatMap((s) => s.findings).filter((f) => f.code === "endpoint.key-missing");
  assert.ok(keys.length > 0);
  assert.ok(keys.every((f) => f.severity === "warning" && /refuse to start/.test(f.message)));
  await fs.rm(dir, { recursive: true, force: true });
});
