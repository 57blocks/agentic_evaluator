#!/usr/bin/env node
/**
 * Required check: are these the right beneficial owners, on the right basis?
 *
 * Reads `output.txt` (the candidate's answer) and `meta.json` (which input)
 * from the work dir, and the answer key from references/<input>.txt. Graded:
 * the set of owners as {name, basis}, the fallback flag, and the managing
 * directors recorded under the fallback. Not graded here: the reasoning,
 * which is the judge's.
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
/** Compared case-insensitively; shown as written. */
const entry = (shown) => ({ shown, key: shown.toLowerCase() });
const ownerKeys = (owners) => (Array.isArray(owners) ? owners : []).map((o) => entry(`${tidy(o?.name)} (${tidy(o?.basis)})`));
const nameKeys = (names) => (Array.isArray(names) ? names : []).map((n) => entry(tidy(typeof n === "string" ? n : n?.name)));
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
  ...difference("owner", ownerKeys(answer.beneficial_owners), ownerKeys(expected.beneficial_owners)),
  ...(answer.fallback === expected.fallback ? [] : [`fallback is ${answer.fallback}, should be ${expected.fallback}`]),
  ...difference("recorded under fallback", nameKeys(answer.recorded_under_fallback), nameKeys(expected.recorded_under_fallback)),
];
if (problems.length > 0) {
  say(`${label}${problems.join(" | ")}`, problems[0]);
  process.exit(1);
}
say(`${label}${expected.fallback ? `fallback: ${shown(nameKeys(expected.recorded_under_fallback))}` : `owners: ${shown(ownerKeys(expected.beneficial_owners))}`}`, "pass");
