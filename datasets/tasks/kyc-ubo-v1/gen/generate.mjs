#!/usr/bin/env node
/**
 * Regenerates the kyc-ubo-v1 set: inputs/<id>.txt, references/<id>.txt (the
 * answer key), checks/manifest.json (tags, split, provenance) and
 * kyc-ubo-v1.jsonl (the whole set, one item per line).
 *
 *   node datasets/tasks/kyc-ubo-v1/gen/generate.mjs
 *
 * Same seed, same set. Changing the seed, a builder or a rule is a new version.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solve, THRESHOLD } from "./solve.mjs";
import { QUOTA, buildStructure } from "./structures.mjs";
import { nameSource, render } from "./render.mjs";

const SEED = 20261015;
const VERSION = "kyc-ubo-v1";
const HOLDOUT_EVERY = 5; // items 0 and 1 of every 5 of a kind are holdout: about 40%
const HOLDOUT_FIRST = 2;
const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** mulberry32: small, seeded, the same on every machine. */
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

function assertWellFormed(id, { holdings }) {
  for (const [company, holders] of Object.entries(holdings)) {
    const sum = holders.reduce((n, s) => n + s.percent, 0);
    if (sum !== 100) throw new Error(`${id}: shareholders of ${company} add up to ${sum}%`);
  }
}

/** Tags from what the item contains, on top of the builder's own. */
function derivedTags(structure, answer) {
  const stakes = Object.values(structure.holdings).flat();
  const extra = [];
  if (structure.holdings[structure.target].some((s) => s.percent === THRESHOLD)) extra.push("threshold-boundary");
  if (answer.fallback) extra.push("fallback");
  if (structure.directors.some((d) => stakes.some((s) => s.holder === d))) extra.push("director-is-shareholder");
  return extra;
}

function buildSet() {
  const rng = seeded(SEED);
  const items = [];
  for (const [archetype, count] of Object.entries(QUOTA)) {
    for (let k = 0; k < count; k++) {
      const id = `ubo-${String(items.length + 1).padStart(3, "0")}`;
      const { structure, tags } = buildStructure(rng, nameSource(rng), archetype);
      assertWellFormed(id, structure);
      const answer = solve(structure);
      items.push({
        id,
        input: render(rng, structure),
        expected: answer,
        tags: [...new Set([...tags, ...derivedTags(structure, answer)])],
        split: k % HOLDOUT_EVERY < HOLDOUT_FIRST ? "holdout" : "dev",
        provenance: { source: "synthetic", generator: `gen/generate.mjs seed ${SEED}`, archetype, version: VERSION },
      });
    }
  }
  return items;
}

function clearGenerated(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith("ubo-")) fs.rmSync(path.join(dir, f));
}

function write(items) {
  clearGenerated(path.join(TASK, "inputs"));
  clearGenerated(path.join(TASK, "references"));
  for (const item of items) {
    fs.writeFileSync(path.join(TASK, "inputs", `${item.id}.txt`), `${item.input}\n`);
    fs.writeFileSync(path.join(TASK, "references", `${item.id}.txt`), `${JSON.stringify(item.expected, null, 2)}\n`);
  }
  const manifest = Object.fromEntries(items.map(({ id, tags, split, provenance }) => [id, { tags, split, archetype: provenance.archetype }]));
  fs.writeFileSync(path.join(TASK, "checks", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(TASK, `${VERSION}.jsonl`), items.map((i) => JSON.stringify(i)).join("\n") + "\n");
}

const items = buildSet();
write(items);
const holdout = items.filter((i) => i.split === "holdout").length;
const fallback = items.filter((i) => i.expected.fallback).length;
process.stdout.write(`${items.length} items (${holdout} holdout), ${fallback} fallback, ids ${items[0].id}…${items.at(-1).id}\n`);
