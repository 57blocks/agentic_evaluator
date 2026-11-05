#!/usr/bin/env node
/**
 * Regenerates the contract-terms-long set: inputs/<id>.txt (the document
 * packet), references/<id>.txt (the answer key), checks/manifest.json (tags,
 * split) and contract-terms-long.jsonl (the whole set).
 *
 *   node datasets/tasks/contract-terms-long/gen/generate.mjs
 *
 * Same seed, same set. The first six rows are the 2026-10-15 first cut and
 * regenerate byte for byte; ct-007..060 are drawn from QUOTA after them and
 * ct-061..100 from THIRD_CUT_QUOTA after those, each cut consuming the rng
 * stream only after the cut before it, so an earlier cut never changes.
 * Every graded value is asserted to survive the noise pass (noise.mjs
 * `readable`), or generation fails.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solve } from "./solve.mjs";
import { buildAgreement } from "./structures.mjs";
import { render } from "./render.mjs";
import { addNoise, readable } from "./noise.mjs";

const SEED = 20261015;
const VERSION = "contract-terms-long-v3";
const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOLDOUT_EVERY = 5;
const HOLDOUT_FIRST = 2;

/** The first cut, kept as it was: noise level, structural trap, SOWs filed with it (length). */
const FIRST_CUT = [
  ["clean", "none", 6], ["clean", "executed-amendment", 6],
  ["light", "none", 6], ["light", "out-of-order", 6],
  ["heavy", "none", 6], ["heavy", "none", 6],
];

/** How many more items of each trap kind follow the first cut (54 in all; 16 of the 60 are ordinary). */
const QUOTA = {
  none: 12,
  "executed-amendment": 4,
  "out-of-order": 4,
  "draft-amendment": 4,
  "future-amendment": 4,
  "one-party": 4,
  chain: 6,
  restated: 6,
  absent: 6,
  "renewal-amendment": 4,
};
/**
 * The third cut (ct-061..100), appended after the 60 so they regenerate
 * unchanged. The 8-model run of the 60 separated the candidates on two traps
 * only — an amendment one party never signed, and a chain filed out of order
 * — and every other trap was 100% for every model, so this cut is those two
 * plus ordinary controls, spread over the three noise levels (the first 60
 * had every one-party packet at heavy noise).
 */
const THIRD_CUT_QUOTA = { "one-party": 16, chain: 16, none: 8 };
const NOISE_CYCLE = ["clean", "light", "heavy"];
const SOW_CYCLE = [6, 12, 4, 16, 8];

/** The quota rows, each kind spread evenly through the sequence so every split and noise level sees every trap. */
function quotaRows(quota, offset) {
  const kinds = Object.keys(quota);
  const emitted = Object.fromEntries(kinds.map((k) => [k, 0]));
  const total = Object.values(quota).reduce((a, b) => a + b, 0);
  return Array.from({ length: total }, (_, i) => {
    const j = offset + i;
    const next = kinds.filter((k) => emitted[k] < quota[k]).sort((a, b) => emitted[a] / quota[a] - emitted[b] / quota[b])[0];
    emitted[next] += 1;
    return [NOISE_CYCLE[j % NOISE_CYCLE.length], next, SOW_CYCLE[j % SOW_CYCLE.length]];
  });
}

const SECOND_CUT = quotaRows(QUOTA, 0);
const PLAN = [...FIRST_CUT, ...SECOND_CUT, ...quotaRows(THIRD_CUT_QUOTA, SECOND_CUT.length)];

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function assertDerivable(id, text, strings) {
  const flat = readable(text);
  const lost = strings.filter((s) => !flat.includes(s));
  if (lost.length > 0) throw new Error(`${id}: graded text lost to noise: ${lost.join(" | ")}`);
}

const lengthBucket = (words) => (words < 8000 ? "under-8k-words" : words < 12000 ? "8k-12k-words" : "over-12k-words");

function amendmentTags(c) {
  const a = c.amendments;
  if (a.length === 0) return [];
  return [
    `amendments-${a.length}`,
    a.some((x) => x.restates) ? "restated" : null,
    a.some((x) => x.draft) ? "has-draft" : null,
    a.some((x) => x.signedBy !== undefined) ? "has-one-party" : null,
    a.some((x) => x.signed && x.effective > c.statusDate) ? "has-future" : null,
    a.some((x) => x.changes.renewal !== undefined) ? "amends-renewal" : null,
    a.some((x) => x.changes.termMonths !== undefined) ? "amends-term" : null,
  ];
}

function tagsFor(c, noise, trap, words) {
  return [
    trap === "none" ? null : "hard",
    `noise-${noise}`,
    trap === "none" ? null : `trap-${trap}`,
    ...c.missing.map((m) => `absent-${m}`),
    ...amendmentTags(c),
    lengthBucket(words),
    `effective-${c.effective.style}`,
    `term-${c.term ? c.term.style : "absent"}`,
    `renewal-${c.renewal.kind}${c.renewal.defined ? "-defined" : ""}`,
    `cap-${c.cap ? c.cap.type : "absent"}`,
    c.law === null ? "law-absent" : null,
    c.venue !== c.law ? "venue-differs" : null,
  ].filter(Boolean);
}

function buildSet() {
  const rng = seeded(SEED);
  return PLAN.map(([noise, trap, sowCount], i) => {
    const id = `ct-${String(i + 1).padStart(3, "0")}`;
    const c = buildAgreement(rng, trap, noise, sowCount);
    const { text, protected: strings } = render(rng, c);
    const noised = addNoise(rng, text, strings, noise, c.kind);
    assertDerivable(id, noised, strings);
    const words = text.split(/\s+/).length;
    return {
      id,
      input: noised,
      expected: solve(c),
      tags: tagsFor(c, noise, trap, words),
      split: i % HOLDOUT_EVERY < HOLDOUT_FIRST ? "holdout" : "dev",
      provenance: { source: "synthetic", generator: `gen/generate.mjs seed ${SEED}`, version: VERSION, words },
    };
  });
}

function clearGenerated(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith("ct-")) fs.rmSync(path.join(dir, f));
}

function write(items) {
  clearGenerated(path.join(TASK, "inputs"));
  clearGenerated(path.join(TASK, "references"));
  fs.mkdirSync(path.join(TASK, "checks"), { recursive: true });
  for (const item of items) {
    fs.writeFileSync(path.join(TASK, "inputs", `${item.id}.txt`), `${item.input}\n`);
    fs.writeFileSync(path.join(TASK, "references", `${item.id}.txt`), `${JSON.stringify(item.expected, null, 2)}\n`);
  }
  const manifest = Object.fromEntries(items.map(({ id, tags, split, provenance }) => [id, { tags, split, words: provenance.words }]));
  fs.writeFileSync(path.join(TASK, "checks", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(TASK, "contract-terms-long.jsonl"), items.map((i) => JSON.stringify(i)).join("\n") + "\n");
}

const items = buildSet();
write(items);
for (const i of items) process.stdout.write(`${i.id}  ${i.split.padEnd(7)} ${String(i.provenance.words).padStart(6)} words  ${i.tags.join(", ")}\n`);
const count = (pred) => items.filter(pred).length;
process.stdout.write(`${items.length} items: ${count((i) => i.tags.includes("hard"))} hard, ${count((i) => i.split === "holdout")} holdout, ${count((i) => i.tags.includes("over-12k-words"))} over 12k words\n`);
process.stdout.write(`spec inputs: [${items.map((i) => i.id).join(", ")}]\n`);
