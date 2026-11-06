/**
 * A candidate's file paths stay inside the work dir they are written to.
 *
 * A codegen model names its own files (`file:<path>`); an agent's artifacts
 * are read back from its work dir. Either can say `../../.zshrc`, and the
 * check layer must refuse to write there, on the host, before tsc runs.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveUnder } from "../src/work-path.js";
import { runCheck, runCommandCheck } from "../src/check.js";

const NODE = process.execPath;

test("resolveUnder keeps a relative path inside the base and refuses one that escapes", () => {
  const base = path.join(os.tmpdir(), "ae-base");
  assert.equal(resolveUnder(base, "src/index.ts"), path.join(base, "src", "index.ts"));
  assert.equal(resolveUnder(base, "/src/index.ts"), path.join(base, "src", "index.ts"), "a leading slash is stripped, not treated as absolute");
  assert.equal(resolveUnder(base, "a/../b.ts"), path.join(base, "b.ts"), "`..` that stays inside is fine");
  assert.equal(resolveUnder(base, "../escape.ts"), null);
  assert.equal(resolveUnder(base, "a/../../escape.ts"), null);
  assert.equal(resolveUnder(base, ""), null, "the base itself is not a file");
  assert.equal(resolveUnder(base, "."), null);
});

test("tsc check: a file path that escapes the work dir fails the candidate and writes nothing outside", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ae-check-escape-"));
  const scaffold = path.join(root, "scaffold");
  await fs.mkdir(scaffold);
  await fs.writeFile(path.join(scaffold, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
  const workDir = path.join(root, "work", "t0");
  const outside = path.join(root, "work", "escape.ts");

  const r = await runCheck({
    files: [
      { path: "ok.ts", content: "export const ok = 1;\n" },
      { path: "../escape.ts", content: "export const x = 1;\n" },
    ],
    scaffoldDir: scaffold,
    workDir,
  });

  assert.equal(r.state, "fail");
  assert.equal(r.passed, false);
  assert.match(r.output, /escapes the work dir: \.\.\/escape\.ts/);
  assert.equal(existsSync(outside), false, "nothing was written outside the work dir");
  assert.equal(existsSync(path.join(workDir, "ok.ts")), false, "nothing is materialized once one path escapes");
});

test("command check: a file path that escapes the work dir fails the candidate without running the check", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ae-cmd-escape-"));
  const workDir = path.join(root, "work", "t0");
  const outside = path.join(root, "work", "escape.txt");

  const r = await runCommandCheck({
    argv: [NODE, "-e", "process.exit(0)"],
    versionFiles: [],
    timeoutMs: 20_000,
    files: [{ path: "../escape.txt", content: "x" }],
    output: "the deliverable",
    input: "the input",
    meta: { step: "s", candidate: "c", input: "i", trial: 0 },
    workDir,
    taskRoot: root,
  });

  assert.equal(r.state, "fail");
  assert.match(r.output, /escapes the work dir: \.\.\/escape\.txt/);
  assert.equal(existsSync(outside), false);
});
