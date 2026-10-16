#!/usr/bin/env node
/**
 * Required check: right root cause, right next step, right deadline?
 *
 * Reads `output.txt` (the candidate's JSON) and `meta.json` (which input)
 * from the work dir, and the answer key from references/<input>.txt. Graded
 * exactly: root_cause, correctable, next_action, deadline (null when the key
 * says null). Not graded here: action_note, which is the judge's.
 *
 * Exit 0 = pass, 1 = fail, 3 = evaluator error (never blamed on the candidate).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFERENCES = process.env.EVAL_REFERENCES_DIR ?? path.join(HERE, "..", "references");
const FIELDS = ["root_cause", "correctable", "next_action", "deadline"];

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

const norm = (v) => (v === null || v === undefined ? null : String(v).trim().toLowerCase());
const show = (v) => (v === undefined ? "missing" : JSON.stringify(v));

const meta = JSON.parse(readOr("meta.json", "{}"));
const expected = firstJsonObject(readOr(path.join(REFERENCES, `${meta.input}.txt`), ""));
if (expected === null) bail(`no answer key for input "${meta.input}" in references/`);
const item = JSON.parse(readOr(path.join(HERE, "manifest.json"), "{}"))[meta.input];
const label = item ? `[${item.split}; ${item.tags.join(", ")}] ` : "";

const output = readOr("output.txt", "");
const answer = firstJsonObject(output);
if (answer === null) {
  say(`${label}${output.trim() === "" ? "output.txt is empty" : "no JSON object in the answer"}`, "no answer to grade");
  process.exit(1);
}

const wrong = FIELDS.filter((f) => norm(answer[f]) !== norm(expected[f]));
if (wrong.length > 0) {
  const detail = wrong.map((f) => `${f}: got ${show(answer[f])}, want ${show(expected[f])}`);
  say(`${label}${FIELDS.length - wrong.length}/${FIELDS.length} fields right | ${detail.join(" | ")}`, detail[0]);
  process.exit(1);
}
say(`${label}all ${FIELDS.length} fields right`, "pass");
