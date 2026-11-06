#!/usr/bin/env node
/**
 * Required check for every step: did this step hand on what the next one needs?
 *
 * Reads `output.txt` (the candidate's JSON) and `meta.json` (step, input) from
 * the work dir, and the step's correct answer from
 * references/<step>/<step's own slug>.txt. In the chain every step sees the
 * root slug (`cd2-012`); on its own inputs decide sees `cd2-012-decide`. Both
 * map to the same key, so a step is graded the same either way.
 *
 *   extract    root_cause, the four dates, paid_through, qualifying_stay, and
 *              the records verbatim (whitespace and quote style aside): a
 *              record dropped or reworded here is extract's miss, not decide's
 *   decide     correctable, next_action, and the two dates deadline reads,
 *              still as given
 *   deadline   deadline (any date in the key's deadline_also_accepted passes
 *              too: v2's R7 on a reopening)
 *
 * Across the three steps that is claim-denials-snf-v2's four graded fields.
 * Exit 0 = pass, 1 = fail, 3 = evaluator error (never blamed on the candidate).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFERENCES = process.env.EVAL_REFERENCES_DIR ?? path.join(HERE, "..", "references");

const FIELDS = {
  extract: ["root_cause", "statement_from", "statement_through", "received_date", "remittance_date", "paid_through", "qualifying_stay", "records"],
  decide: ["correctable", "next_action", "remittance_date", "statement_through"],
  deadline: ["deadline"],
};

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

/** Compare as a biller would: case, spacing and quote style do not change a value. */
function norm(v) {
  if (v === null || v === undefined || v === "") return null;
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
  return String(v).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const show = (v) => (v === undefined ? "missing" : JSON.stringify(v));

const meta = JSON.parse(readOr("meta.json", "{}"));
const fields = FIELDS[meta.step];
if (!fields) bail(`unknown step "${meta.step}"; expected one of ${Object.keys(FIELDS).join(", ")}`);
const item = /^cd2-\d{3}/.exec(meta.input ?? "")?.[0];
if (!item) bail(`input "${meta.input}" is not a cd2-NNN item`);
const slug = meta.step === "extract" ? item : `${item}-${meta.step}`;
const expected = firstJsonObject(readOr(path.join(REFERENCES, meta.step, `${slug}.txt`), ""));
if (expected === null) bail(`no answer key for "${slug}" in references/${meta.step}/`);

const labels = JSON.parse(readOr(path.join(HERE, "manifest.json"), "{}"))[meta.input];
const label = labels ? `[${labels.split}; ${labels.tags.join(", ")}] ` : "";

const output = readOr("output.txt", "");
const answer = firstJsonObject(output);
if (answer === null) {
  say(`${label}${output.trim() === "" ? "output.txt is empty" : "no JSON object in the answer"}`, "no answer to grade");
  process.exit(1);
}

const acceptedFor = (f) => [expected[f], ...(f === "deadline" ? expected.deadline_also_accepted ?? [] : [])];
const wrong = fields.filter((f) => !acceptedFor(f).some((want) => same(answer[f], want)));
if (wrong.length > 0) {
  const detail = wrong.map((f) => `${f}: got ${show(answer[f])}, want ${show(expected[f])}`);
  say(`${label}${fields.length - wrong.length}/${fields.length} fields right | ${detail.join(" | ")}`, detail[0]);
  process.exit(1);
}
say(`${label}all ${fields.length} fields right`, "pass");
