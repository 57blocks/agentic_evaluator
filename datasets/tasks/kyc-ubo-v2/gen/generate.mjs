#!/usr/bin/env node
/**
 * Regenerates the kyc-ubo-v2 set: inputs/<id>.txt, references/<id>.txt (the
 * answer key), checks/manifest.json (tags, split) and kyc-ubo-v2.jsonl (the
 * whole set, one item per line).
 *
 *   node datasets/tasks/kyc-ubo-v2/gen/generate.mjs
 *
 * Same seed, same set. Changing the seed, a builder or a rule is a new version.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solve } from "./solve.mjs";
import { QUOTA, buildStructure } from "./structures.mjs";
import { nameSource, render } from "./render.mjs";

const SEED = 20261015;
// v2.2: same seed and answers; a KG partner entered more than once has each entry numbered (rendering only).
const VERSION = "kyc-ubo-v2";
// v2.1: 300 items. The first pass over QUOTA is v2's 30 items, unchanged
// (same seed, same order); EXTRA_PASSES more passes continue the same random
// stream, so results on the first 30 items stay comparable across versions.
const EXTRA_PASSES = 9;
const HOLDOUT_EVERY = 5; // items 0 and 1 of every 5 in the set are holdout: 40%
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

function assertWellFormed(id, { entities }) {
  for (const [name, e] of Object.entries(entities)) {
    const sum = e.holders.reduce((n, h) => n + h.nominal, 0) + (e.ownShares ?? 0);
    if (e.capital !== undefined && sum !== e.capital) throw new Error(`${id}: shares of ${name} add up to ${sum}, capital is ${e.capital}`);
    if (e.holders.some((h) => !Number.isInteger(h.nominal) || h.nominal <= 0)) throw new Error(`${id}: ${name} has a share that is not a whole positive euro amount`);
  }
}

/** Tags from what the item contains, on top of the builder's own. */
function derivedTags(answer, register) {
  const extra = [];
  if (answer.fictitious_beneficial_owners.length > 0) extra.push("fallback");
  if (register.prokura.length > 0) extra.push("prokurist");
  return extra;
}

function buildSet() {
  const rng = seeded(SEED);
  const items = [];
  const passes = Array.from({ length: 1 + EXTRA_PASSES }, () => Object.entries(QUOTA)).flat();
  for (const [archetype, count] of passes) {
    for (let k = 0; k < count; k++) {
      const id = `ubo2-${String(items.length + 1).padStart(3, "0")}`;
      const { structure, register, tags } = buildStructure(rng, nameSource(rng), archetype);
      assertWellFormed(id, structure);
      const answer = solve(structure);
      items.push({
        id,
        input: render(rng, structure, register),
        expected: answer,
        tags: [...new Set([...tags, ...derivedTags(answer, register)])],
        split: items.length % HOLDOUT_EVERY < HOLDOUT_FIRST ? "holdout" : "dev",
        provenance: { source: "synthetic", generator: `gen/generate.mjs seed ${SEED}`, rules: "RULES.md", archetype, version: VERSION },
      });
    }
  }
  return items;
}

function clearGenerated(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith("ubo2-")) fs.rmSync(path.join(dir, f));
}

function write(items) {
  clearGenerated(path.join(TASK, "inputs"));
  clearGenerated(path.join(TASK, "references"));
  fs.mkdirSync(path.join(TASK, "checks"), { recursive: true });
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
const fallback = items.filter((i) => i.expected.fictitious_beneficial_owners.length > 0).length;
process.stdout.write(`${items.length} items (${holdout} holdout), ${fallback} fallback, ids ${items[0].id}…${items.at(-1).id}\n`);
