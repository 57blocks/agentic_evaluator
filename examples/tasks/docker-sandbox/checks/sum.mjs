#!/usr/bin/env node
/**
 * Required check: is SUM.txt the sum of the numbers in the task?
 *
 * Runs on the host, in the trial's work dir: the candidate's files plus
 * `input.txt`. Exit 0 = pass, 1 = the candidate failed; any other exit is an
 * evaluator error. The evidence also says where the candidate ran, read from
 * the ENVIRONMENT.json it left behind.
 */
import fs from "node:fs";

const read = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const task = read("input.txt");
if (task === null) {
  process.stderr.write("input.txt missing: the harness prepares it, so this is an evaluator error\n");
  process.exit(2);
}
const expected = task.trim().split(/\s+/).map(Number).reduce((a, b) => a + b, 0);
const got = read("SUM.txt");
const env = JSON.parse(read("ENVIRONMENT.json") ?? "{}");
const where = env.inContainer
  ? `in a container, ${env.sawChecks ? "with checks/ visible" : "without access to checks/"}`
  : "on the host, with this machine's files and network";

if (got === null) {
  process.stdout.write(JSON.stringify({ evidence: `no SUM.txt; ran ${where}`, reason: "deliverable missing" }));
  process.exit(1);
}
const ok = Number(got.trim()) === expected;
process.stdout.write(
  JSON.stringify({
    evidence: `SUM.txt = ${got.trim()}, expected ${expected}; ran ${where}`,
    ...(ok ? {} : { reason: `wrong sum: ${got.trim()} != ${expected}` }),
  }),
);
process.exit(ok ? 0 : 1);
