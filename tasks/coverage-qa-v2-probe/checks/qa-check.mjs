#!/usr/bin/env node
/**
 * Required check: is the coverage answer right, and does it cite the clauses that decide it?
 *
 * Reads `output.txt` (the candidate's answer) and `meta.json` (which input)
 * from the work dir, and the answer key from references/<input>.txt. Graded:
 * the answer exactly (yes, no, not_addressed, or the number or date the
 * question asks for; a date in any common form is read as YYYY-MM-DD); every required citation
 * present (an entry that lists several sections is met by any one); and no
 * citation of a section the policy does not have. Extra real citations are
 * allowed. The explanation is the judge's.
 *
 * Exit 0 = pass, 1 = fail, 3 = evaluator error (never blamed on the candidate).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFERENCES = process.env.EVAL_REFERENCES_DIR ?? path.join(HERE, "..", "references");

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

/** The first JSON object in the text that parses, from each `{` to each later `}`. */
function firstJsonObject(text) {
  const starts = [...text.matchAll(/\{/g)].map((m) => m.index);
  const ends = [...text.matchAll(/\}/g)].map((m) => m.index).reverse();
  for (const s of starts) {
    for (const e of ends) {
      if (e <= s) break;
      try {
        const value = JSON.parse(text.slice(s, e + 1));
        if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
      } catch {
        // not this span
      }
    }
  }
  return null;
}

/** "§2.1", "2.1", "Section 2.1", "MP-118 §R1", "R1" → "§2.1" / "§R1"; null when no section number is there. */
function section(citation) {
  const text = String(citation ?? "");
  const marked = text.match(/§\s*(R?\d+(?:\.\d+)?)/i);
  if (marked) return `§${marked[1].toUpperCase()}`;
  const bare = text.match(/^\s*(?:section\s*|appendix\s*r\s*,?\s*)?(R?\d+(?:\.\d+)?)\s*$/i);
  return bare ? `§${bare[1].toUpperCase()}` : null;
}

/** An answer as comparable text: a word (yes, not_addressed), a whole number, or a date as YYYY-MM-DD. */
function normalize(value) {
  if (typeof value === "number") return String(value);
  const text = String(value ?? "").trim();
  if (/^\d+$/.test(text)) return String(Number(text));
  const date = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : `${text} UTC`);
  if (/\d{4}/.test(text) && !Number.isNaN(date)) return new Date(date).toISOString().slice(0, 10);
  return text.toLowerCase().replace(/[\s-]+/g, "_");
}

/** A citation is real when the policy has it, or it is the parent of a section it has (§4 for §4.1). */
const isReal = (cited, sections) => sections.some((s) => s === cited || s.startsWith(`${cited}.`));

const meta = JSON.parse(readOr("meta.json", "{}"));
const key = firstJsonObject(readOr(path.join(REFERENCES, `${meta.input}.txt`), ""));
if (key === null) bail(`no answer key for input "${meta.input}" in references/`);
const item = JSON.parse(readOr(path.join(HERE, "manifest.json"), "{}"))[meta.input];
const label = item ? `[${item.split}; ${item.tags.join(", ")}] ` : "";

const output = readOr("output.txt", "");
const answer = firstJsonObject(output);
if (answer === null) {
  say(`${label}${output.trim() === "" ? "output.txt is empty" : "no JSON object in the answer"}`, "no answer to grade");
  process.exit(1);
}

const given = normalize(answer.answer);
const cited = (Array.isArray(answer.citations) ? answer.citations : []).map((c) => ({ raw: String(c), sec: section(c) }));
const problems = [
  ...((key.accepted ?? [key.answer]).some((a) => normalize(a) === given) ? [] : [`answer "${answer.answer ?? ""}", expected "${(key.accepted ?? [key.answer]).join('" or "')}"`]),
  ...key.required_citations
    .map((need) => (Array.isArray(need) ? need : [need]))
    .filter((options) => !options.some((o) => cited.some((c) => c.sec === o)))
    .map((options) => `missing citation ${options.join(" or ")}`),
  ...cited.filter((c) => c.sec === null || !isReal(c.sec, key.policy_sections)).map((c) => `cites "${c.raw}", which the policy does not have`),
];
if (problems.length > 0) {
  say(`${label}${problems.join(" | ")}`, problems[0]);
  process.exit(1);
}
say(`${label}${key.answer}, citing ${cited.map((c) => c.sec).join(", ") || "nothing"}`, "pass");
