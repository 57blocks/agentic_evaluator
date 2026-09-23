#!/usr/bin/env node
/**
 * Required check: does a task breakdown actually cover the PRD it was given?
 *
 * Declared in a spec as:
 *
 *   evaluators:
 *     required_checks:
 *       task-coverage:
 *         kind: command
 *         argv: ["node", "checks/task-coverage.mjs"]
 *         version_files: [checks/task-coverage.mjs]
 *
 * Reads the work dir the harness prepares: `output.txt` (the candidate's task
 * list) and `input.txt` (the PRD). Fails when the breakdown invents a
 * requirement id the PRD never defines, or leaves a requirement uncovered.
 *
 * This is the kind of gate that turns a step from "one judge's opinion" into a
 * measured outcome: it is checkable, it cites what it found, and it does not
 * need a model.
 *
 * Exit 0 = pass, 1 = fail. Anything else the harness records as an evaluator
 * error rather than blaming the candidate.
 */

import fs from "node:fs";

const ID_PATTERN = /\b(?:FR|AC|US|IC|PAGE|CMP)-[0-9]+(?:\.[0-9]+)*\b/g;

function say(evidence, reason) {
  process.stdout.write(JSON.stringify(reason === undefined ? { evidence } : { evidence, reason }));
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch (err) {
    // The harness owns the work dir; a missing file is its bug, not the
    // candidate's, so exit with a code that means "evaluator error".
    process.stderr.write(`cannot read ${file}: ${err.message}\n`);
    process.exit(3);
  }
}

/** The task array, from raw JSON or from a ```json fence. */
function parseTasks(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const parsed = JSON.parse(body);
  if (!Array.isArray(parsed)) throw new Error("top level is not an array");
  return parsed;
}

const output = read("output.txt");
const prd = read("input.txt");

const declared = new Set(prd.match(ID_PATTERN) ?? []);
if (declared.size === 0) {
  process.stderr.write("no FR-/AC-/US- requirement ids found in the PRD; nothing to check against\n");
  process.exit(3);
}

let tasks;
try {
  tasks = parseTasks(output);
} catch (err) {
  say(`task list is not valid JSON: ${err.message}`, "unparsable task list");
  process.exit(1);
}

const citedBy = new Map();
const unknown = [];
const uncited = [];

for (const [i, task] of tasks.entries()) {
  const id = typeof task?.id === "string" ? task.id : `#${i + 1}`;
  const cites = JSON.stringify(task ?? {}).match(ID_PATTERN) ?? [];
  if (cites.length === 0) {
    uncited.push(id);
    continue;
  }
  for (const req of cites) {
    if (!declared.has(req)) {
      unknown.push(`${id} cites ${req}`);
      continue;
    }
    citedBy.set(req, [...(citedBy.get(req) ?? []), id]);
  }
}

const uncovered = [...declared].filter((req) => !citedBy.has(req)).sort();
const problems = [];
if (uncited.length > 0) problems.push(`${uncited.length} task(s) cite no requirement: ${uncited.slice(0, 8).join(", ")}`);
if (unknown.length > 0) problems.push(`${unknown.length} citation(s) to ids the PRD does not define: ${unknown.slice(0, 8).join("; ")}`);
if (uncovered.length > 0) problems.push(`${uncovered.length} requirement(s) covered by no task: ${uncovered.slice(0, 8).join(", ")}`);

const summary = `${tasks.length} task(s), ${declared.size - uncovered.length}/${declared.size} requirements covered`;

if (problems.length > 0) {
  say(`${summary}. ${problems.join(". ")}.`, problems[0]);
  process.exit(1);
}
say(summary);
