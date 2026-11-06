#!/usr/bin/env node
/**
 * Required check: is this PRD buildable, and does it honour this brief?
 *
 * Reads the work dir the harness prepares: `output.txt` (the PRD) and
 * `meta.json` (which input this is). Two layers:
 *
 *   1. Structure, for every brief: PRD-n requirement ids, acceptance criteria
 *      for each one, a user story, an out-of-scope section and an open
 *      questions / assumptions section.
 *   2. This brief's expectations (checks/expectations.json): the constraints
 *      it states must appear, its exclusions must be listed as out of scope,
 *      and its contradictions must be raised as open questions.
 *
 * Quality beyond that (scope creep, granularity, clarity) is the judge's job:
 * a requirement count says how finely a PRD is split, not whether it invents.
 *
 * Exit 0 = pass, 1 = fail, 3 = evaluator error (never blamed on the candidate).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REQ_ID = /\bPRD-(\d+)\b/g;
const HAS_REQ_ID = /\bPRD-\d+\b/;
// A line that starts with a requirement id, after markdown markers: "### PRD-3:", "- **PRD-3 —", "| PRD-3 |".
const DEFINES_REQ = /^[\s#>*|-]*(?:\d+[.)]\s*)?\**\s*PRD-(\d+)\b/;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const AC_WORDS = /acceptance|criteri|\bAC\b|\bgiven\b|\bverif|done when|\bthen\b|expected/i;
// A plain numbered line ("5. Out of Scope") is a heading only when it names a PRD section.
const SECTION_NAME = /problem|goal|user stor|requirement|acceptance|scope|non-?goal|open question|assumption|overview|background|success|metric|risk|dependenc/i;
const USER_STORY = /\bas an?\b[^\n]{0,120}?\bi want\b/i;
const OUT_OF_SCOPE = /out[- ]of[- ]scope|non[- ]?goals?/i;
const OPEN_QUESTIONS = /open questions?|assumptions?/i;

function say(evidence, reason) {
  process.stdout.write(JSON.stringify({ evidence, reason }));
}

function bail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(3);
}

function readOr(file, fallback) {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return fallback;
  }
}

/** A heading: a markdown `#` line, a line that is only bold text, or a short numbered section name. */
function headingText(line) {
  const hash = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
  if (hash) return hash[1];
  const bold = line.match(/^\s*\*\*(.+?)\*\*:?\s*$/);
  if (bold) return bold[1];
  const numbered = line.match(/^\d+(?:\.\d+)*[.)]?\s+([^:]+?):?\s*$/);
  if (numbered && numbered[1].split(/\s+/).length <= 6 && SECTION_NAME.test(numbered[1])) return numbered[1];
  return null;
}

/** Markdown `#` count; bold-only lines nest under anything; numbered ones sit at level 2. */
function headingLevel(line) {
  const hash = line.match(/^\s{0,3}(#{1,6})\s/);
  if (hash) return hash[1].length;
  return /^\s*\*\*/.test(line) ? 99 : 2;
}

/**
 * Body of every section whose heading matches, concatenated. A section runs
 * until a heading at its own level or above, so its sub-headings
 * ("### Contradiction: …" under "## Open questions") belong to it.
 */
function sectionBody(lines, pattern) {
  const bodies = [];
  let level = null;
  for (const line of lines) {
    const heading = headingText(line);
    if (heading !== null) {
      const here = headingLevel(line);
      if (level !== null && here > level) {
        bodies.push(heading);
        continue;
      }
      level = pattern.test(heading) ? here : null;
      continue;
    }
    if (level !== null) bodies.push(line);
  }
  return bodies.join("\n").trim();
}

/** Ids the PRD defines; a PRD that only names ids inline falls back to every id it mentions. */
function requirementIds(lines) {
  const defined = lines.map((l) => l.match(DEFINES_REQ)).filter(Boolean).map((m) => Number(m[1]));
  const ids = defined.length > 0 ? defined : lines.flatMap((l) => [...l.matchAll(REQ_ID)].map((m) => Number(m[1])));
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * Ids with no acceptance criteria. A requirement owns the lines from the line
 * that starts with its id until the next such line or PRD section; a mere mention
 * ("recalculates per PRD-5") does not move ownership. It has criteria when
 * its lines use an acceptance word or it has a sub-bullet under it (criteria
 * written as plain bullets); a table row counts when the table's header names
 * acceptance criteria.
 */
function idsWithoutCriteria(lines, ids) {
  const owned = new Map(ids.map((id) => [id, []]));
  let current = null;
  let tableHasCriteria = false;
  for (const line of lines) {
    const isRow = line.trim().startsWith("|");
    if (!isRow) tableHasCriteria = false;
    if (isRow && AC_WORDS.test(line) && !HAS_REQ_ID.test(line)) tableHasCriteria = true;
    const defined = line.match(DEFINES_REQ);
    if (defined) {
      current = Number(defined[1]);
      owned.get(current)?.push(isRow && tableHasCriteria ? `${line} acceptance` : line);
      continue;
    }
    // A new PRD section ("## Out of scope") ends the requirement; a sub-heading
    // under it ("**Acceptance criteria:**", "**Notes**") stays with it.
    const heading = headingText(line);
    if (heading !== null && SECTION_NAME.test(heading) && !AC_WORDS.test(heading)) {
      current = null;
      continue;
    }
    if (current !== null) owned.get(current)?.push(line);
  }
  const hasCriteria = (owned) => AC_WORDS.test(owned.join("\n")) || owned.slice(1).some((l) => BULLET.test(l));
  return ids.filter((id) => !hasCriteria(owned.get(id)));
}

function missingPatterns(text, pairs) {
  return pairs.filter(([, pattern]) => !new RegExp(pattern, "i").test(text)).map(([label]) => label);
}

function structureProblems(lines, text) {
  const problems = [];
  const ids = requirementIds(lines);
  if (ids.length === 0) return ["no PRD-n requirement ids"];
  const noCriteria = idsWithoutCriteria(lines, ids);
  if (noCriteria.length > 0) problems.push(`no acceptance criteria for ${noCriteria.map((n) => `PRD-${n}`).join(", ")}`);
  // Stories as prose ("As a …, I want …") or as a table under a "User stories" heading.
  if (!USER_STORY.test(text) && !sectionBody(lines, /user stor/i)) problems.push("no user story (as a …, I want …)");
  if (!sectionBody(lines, OUT_OF_SCOPE)) problems.push("no out-of-scope / non-goals section");
  if (!sectionBody(lines, OPEN_QUESTIONS)) problems.push("no open questions / assumptions section");
  return problems;
}

function expectationProblems(lines, text, expect) {
  const problems = [];
  const missing = missingPatterns(text, expect.mentions ?? []);
  if (missing.length > 0) problems.push(`brief constraints not covered: ${missing.join("; ")}`);
  const notExcluded = missingPatterns(sectionBody(lines, OUT_OF_SCOPE), expect.outOfScope ?? []);
  if (notExcluded.length > 0) problems.push(`exclusions not listed as out of scope: ${notExcluded.join("; ")}`);
  const notRaised = missingPatterns(sectionBody(lines, OPEN_QUESTIONS), expect.openQuestions ?? []);
  if (notRaised.length > 0) problems.push(`not raised as an open question: ${notRaised.join("; ")}`);
  return problems;
}

// Models write "30‑minute" and "Out‑of‑Scope" with U+2011 and friends; match on ASCII.
const output = readOr("output.txt", "").replace(/[\u2010-\u2013\u2212]/g, "-").replace(/\u00a0/g, " ");
const meta = JSON.parse(readOr("meta.json", "{}"));
const expectations = JSON.parse(readOr(path.join(HERE, "expectations.json"), "null") ?? "null");
if (expectations === null) bail("checks/expectations.json is missing");
const expect = expectations[meta.input];
if (expect === undefined) bail(`no expectations for input "${meta.input}" in checks/expectations.json`);

if (output.trim() === "") {
  say("output.txt is empty", "no PRD produced");
  process.exit(1);
}

const lines = output.split(/\r?\n/);
const problems = [...structureProblems(lines, output), ...expectationProblems(lines, output, expect)];
const count = requirementIds(lines).length;
if (problems.length > 0) {
  say(`${count} requirements; ${problems.join(" | ")}`, problems[0]);
  process.exit(1);
}
say(`${count} requirements, each with acceptance criteria; every constraint, exclusion and open question this brief needs is present`, "pass");
