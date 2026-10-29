#!/usr/bin/env node
/**
 * Required check: are the release notes complete?
 *
 * Runs in the trial's work dir, which holds the candidate's files plus
 * `input.txt` (the task) and `output.txt` (the deliverable). An agent leaves
 * RELEASE_NOTES.md behind; a model's answer is `output.txt`. Passes when the
 * notes have every required section and cite every PR number the task lists.
 *
 * Exit 0 = pass, 1 = the candidate failed. Any other exit code is recorded as
 * an evaluator error, never blamed on the candidate. stdout may be
 * {"evidence": "...", "reason": "..."}.
 */
import fs from "node:fs";

const REQUIRED_SECTIONS = ["## Features", "## Fixes", "## Breaking changes"];

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

const task = read("input.txt");
if (task === null) {
  process.stderr.write("input.txt missing: the harness prepares it, so this is an evaluator error\n");
  process.exit(2);
}
const notes = read("RELEASE_NOTES.md") ?? read("output.txt");
if (notes === null) {
  process.stdout.write(JSON.stringify({ evidence: "no RELEASE_NOTES.md or output.txt in the work dir", reason: "deliverable missing" }));
  process.exit(1);
}

const expected = [...task.matchAll(/^#(\d+) /gm)].map((m) => `#${m[1]}`);
const missingPrs = expected.filter((id) => !notes.includes(id));
const missingSections = REQUIRED_SECTIONS.filter((s) => !notes.includes(s));
const problems = [
  ...missingPrs.map((id) => `PR ${id} not cited`),
  ...missingSections.map((s) => `section "${s}" missing`),
];

process.stdout.write(
  JSON.stringify({
    evidence: `${expected.length - missingPrs.length}/${expected.length} PRs cited; ${REQUIRED_SECTIONS.length - missingSections.length}/${REQUIRED_SECTIONS.length} sections`,
    ...(problems.length > 0 ? { reason: problems.join("; ") } : {}),
  }),
);
process.exit(problems.length === 0 ? 0 : 1);
