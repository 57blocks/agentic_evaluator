#!/usr/bin/env node
/**
 * Required check: does the candidate's reactive graph actually behave?
 *
 * Declared in the spec as:
 *
 *   evaluators:
 *     required_checks:
 *       code-reactive-behaviour:
 *         kind: command
 *         argv: ["node", "tasks/code-reactive/checks/behaviour.mjs"]
 *         version_files: [tasks/code-reactive/spec.test.ts,
 *                         tasks/code-reactive/checks/behaviour.mjs]
 *
 * `tsc --noEmit` only proves the artifacts compile; the task README said so
 * plainly — "an implementation that compiles and is completely wrong still
 * passes the required check". This runs spec.test.ts, one test per numbered
 * requirement, against whatever the candidate left in the work dir.
 *
 * Exit 0 = pass, 1 = the candidate's implementation is wrong. Anything else
 * is the harness's problem, not the candidate's, and is recorded as an
 * evaluator error rather than a failure.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TASK_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GRADER = path.join(TASK_DIR, "spec.test.ts");
const LOCAL_GRADER = "spec.test.ts";

/**
 * The TypeScript loader, resolved from the repo rather than the work dir.
 * The work dir is a bare directory the candidate wrote into — it has no
 * node_modules, so a bare "tsx" specifier there resolves to nothing.
 */
let TSX_LOADER;
try {
  TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
} catch (err) {
  process.stderr.write(`cannot resolve the tsx loader: ${err.message}\n`);
  process.exit(3);
}

function say(evidence, reason) {
  process.stdout.write(JSON.stringify(reason === undefined ? { evidence } : { evidence, reason }));
}

/** The grader belongs to the task; a missing one is the harness's bug. */
if (!fs.existsSync(GRADER)) {
  process.stderr.write(`grader not found: ${GRADER}\n`);
  process.exit(3);
}

// The entry point the task requires. Absent means the candidate left nothing
// to grade — that is a candidate failure, not an evaluator error.
if (!fs.existsSync("signals.ts")) {
  say("signals.ts not found in the work dir", "the task requires signals.ts at the top level");
  process.exit(1);
}

// The grader imports "./signals.js" — the ESM spelling tsx maps back to
// signals.ts. A bare work dir has no package.json, so Node would treat both
// as CommonJS and that mapping would not happen. Declare the work dir as ESM
// unless the candidate shipped its own manifest, and put it back afterwards.
const MANIFEST = "package.json";
let wroteManifest = false;
try {
  fs.copyFileSync(GRADER, LOCAL_GRADER);
  if (!fs.existsSync(MANIFEST)) {
    fs.writeFileSync(MANIFEST, JSON.stringify({ type: "module" }));
    wroteManifest = true;
  }
} catch (err) {
  process.stderr.write(`cannot stage the grader: ${err.message}\n`);
  process.exit(3);
}

/** Node's runner prints "# pass 3" in TAP and "ℹ pass 3" otherwise. */
function tally(out, word) {
  return (out.match(new RegExp(`^[#\u2139] ${word} (\\d+)$`, "m")) ?? [])[1];
}

let code;
try {
  const out = execFileSync(
    process.execPath,
    ["--import", TSX_LOADER, "--test", LOCAL_GRADER],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
  );
  say(`spec.test.ts: ${tally(out, "pass") ?? "?"} passed, 0 failed`);
  code = 0;
} catch (err) {
  // A non-zero exit from the test runner is a failing implementation; a
  // runner that never produced a summary is an evaluator error.
  const out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  const failed = tally(out, "fail");
  if (failed === undefined) {
    process.stderr.write(`test runner produced no summary:\n${out.slice(0, 2000)}\n`);
    code = 3;
  } else {
    const first = (out.match(/^\s*(?:not ok \d+ - |\u2716 )(.+?)(?: \(\d|$)/m) ?? [])[1] ?? "";
    say(`spec.test.ts: ${failed} failed`, first ? `first failure: ${first}` : undefined);
    code = 1;
  }
}

// process.exit inside the try would skip this, leaving the grader and the
// manifest behind in a work dir the harness may still collect artifacts from.
for (const f of wroteManifest ? [LOCAL_GRADER, MANIFEST] : [LOCAL_GRADER]) {
  try {
    fs.unlinkSync(f);
  } catch {
    // Work dir is thrown away anyway.
  }
}
process.exit(code);
