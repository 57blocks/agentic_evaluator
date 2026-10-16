#!/usr/bin/env node
/**
 * Regenerates the contract-terms-long set: inputs/<id>.txt (the document
 * packet), references/<id>.txt (the answer key), checks/manifest.json (tags,
 * split) and contract-terms-long.jsonl (the whole set).
 *
 *   node tasks/contract-terms-long/gen/generate.mjs
 *
 * Same seed, same set. Every graded value is asserted to survive the noise
 * pass (noise.mjs `readable`), or generation fails.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solve } from "./solve.mjs";
import { buildAgreement } from "./structures.mjs";
import { render } from "./render.mjs";
import { addNoise, readable } from "./noise.mjs";

const SEED = 20261015;
const VERSION = "contract-terms-long-v1";
const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOLDOUT_EVERY = 5;
const HOLDOUT_FIRST = 2;

/** One row per item: noise level, structural trap (on at most a third), SOWs filed with it (length). */
const PLAN = [
  ["clean", "none", 6], ["clean", "executed-amendment", 6],
  ["light", "none", 6], ["light", "out-of-order", 6],
  ["heavy", "none", 6], ["heavy", "none", 6],
];

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

function tagsFor(c, noise, trap, words) {
  return [
    trap === "none" ? null : "hard",
    `noise-${noise}`,
    trap === "none" ? null : `trap-${trap}`,
    lengthBucket(words),
    `effective-${c.effective.style}`,
    `term-${c.term.style}`,
    `renewal-${c.renewal.kind}${c.renewal.defined ? "-defined" : ""}`,
    `cap-${c.cap.type}`,
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
for (const i of items) process.stdout.write(`${i.id}  ${String(i.provenance.words).padStart(6)} words  ${i.tags.join(", ")}\n`);
