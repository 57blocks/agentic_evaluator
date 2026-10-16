#!/usr/bin/env node
/**
 * Required check: are these the right beneficial owners under § 3 GwG?
 *
 * Reads `output.txt` (the candidate's answer) and `meta.json` (which input)
 * from the work dir, and the answer key from references/<input>.txt. Graded:
 * the set of beneficial owners and the set of fictitious beneficial owners,
 * by name. Not graded here: the stated basis (a person can qualify on more
 * than one ground, and the register needs only one) and the reasoning, which
 * are the judge's.
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

const tidy = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
/** Names, compared case-insensitively and shown as written; entries may be strings or {name}. */
const names = (list) => (Array.isArray(list) ? list : []).map((n) => tidy(typeof n === "string" ? n : n?.name)).map((shown) => ({ shown, key: shown.toLowerCase() }));
const shown = (entries) => entries.map((e) => e.shown).join(", ");

function difference(label, got, want) {
  const extra = got.filter((g) => !want.some((w) => w.key === g.key));
  const missing = want.filter((w) => !got.some((g) => g.key === w.key));
  return [
    ...(extra.length > 0 ? [`${label} not expected: ${shown(extra)}`] : []),
    ...(missing.length > 0 ? [`${label} missing: ${shown(missing)}`] : []),
  ];
}

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

const problems = [
  ...difference("owner", names(answer.beneficial_owners), names(expected.beneficial_owners)),
  ...difference("fictitious owner", names(answer.fictitious_beneficial_owners), names(expected.fictitious_beneficial_owners)),
];
if (problems.length > 0) {
  say(`${label}${problems.join(" | ")}`, problems[0]);
  process.exit(1);
}
const owners = names(expected.beneficial_owners);
say(`${label}${owners.length > 0 ? `owners: ${shown(owners)}` : `fictitious: ${shown(names(expected.fictitious_beneficial_owners))}`}`, "pass");
