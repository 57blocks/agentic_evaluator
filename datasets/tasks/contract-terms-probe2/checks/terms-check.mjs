#!/usr/bin/env node
/**
 * Required check: are the extracted contract terms right, field by field?
 *
 * Reads `output.txt` (the candidate's JSON) and `meta.json` (which input)
 * from the work dir, and the answer key from references/<input>.txt. Every
 * field must match: parties as a set of legal names (case and punctuation
 * ignored), dates and numbers exactly, governing law by place name, the
 * liability cap by type and amounts. A null in the key means the term is not
 * in the agreement; any value there is an invented one.
 *
 * Exit 0 = pass, 1 = fail, 3 = evaluator error (never blamed on the candidate).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFERENCES = process.env.EVAL_REFERENCES_DIR ?? path.join(HERE, "..", "references");
const FIELDS = ["parties", "effective_date", "initial_term_months", "auto_renewal", "renewal_term_months", "non_renewal_notice_days", "governing_law", "liability_cap"];

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

/** "Northwind Analytics, Inc." and "northwind analytics inc" are the same name. */
const nameKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9&]+/g, " ").trim();
/** "the State of Delaware" and "Delaware" are the same place. */
const placeKey = (s) => String(s).toLowerCase().replace(/\b(the|state|commonwealth|of|laws?)\b/g, " ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

function sameParties(got, want) {
  if (!Array.isArray(got)) return false;
  const g = [...new Set(got.map(nameKey))].sort();
  const w = [...new Set(want.map(nameKey))].sort();
  return g.length === w.length && g.every((k, i) => k === w[i]);
}

function sameCap(got, want) {
  if (want === null || got === null || got === undefined) return want === (got ?? null);
  return ["type", "amount_usd", "months"].every((k) => (got[k] ?? null) === (want[k] ?? null));
}

function same(field, got, want) {
  if (field === "parties") return sameParties(got, want);
  if (field === "liability_cap") return sameCap(got, want);
  if (want === null) return got === null || got === undefined;
  if (field === "governing_law") return typeof got === "string" && placeKey(got) === placeKey(want);
  return got === want;
}

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

const wrong = FIELDS.filter((f) => !same(f, answer[f], expected[f]));
if (wrong.length > 0) {
  const detail = wrong.map((f) => `${f}: got ${show(answer[f])}, want ${show(expected[f])}`);
  say(`${label}${FIELDS.length - wrong.length}/${FIELDS.length} fields right | ${detail.join(" | ")}`, detail[0]);
  process.exit(1);
}
say(`${label}all ${FIELDS.length} fields right`, "pass");
