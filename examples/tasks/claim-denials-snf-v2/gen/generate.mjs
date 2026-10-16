#!/usr/bin/env node
/**
 * Regenerates the claim-denials-snf-v2 set: inputs/<id>.txt, references/<id>.txt
 * (the answer key), checks/manifest.json (tags, split) and
 * claim-denials-snf-v2.jsonl (the whole set).
 *
 *   node examples/tasks/claim-denials-snf-v2/gen/generate.mjs
 *
 * Same seed, same set. Changing the seed, a builder or a rule is a new version.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHETYPES, QUOTA } from "./structures.mjs";
import { render } from "./render.mjs";

const SEED = 20261016; // v2.1: same seed; reworded the qualifying-stay narrative and dropped an edit message that read as a coding error
const VERSION = "claim-denials-snf-v2";
const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOLDOUT_EVERY = 5; // items 0 and 1 of every 5 in the set are holdout: 40%
const HOLDOUT_FIRST = 2;

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

function buildSet() {
  const rng = seeded(SEED);
  const items = [];
  for (const [archetype, count] of Object.entries(QUOTA)) {
    for (let k = 0; k < count; k++) {
      const id = `cd2-${String(items.length + 1).padStart(3, "0")}`;
      const c = { ...ARCHETYPES[archetype].build(rng), claimNo: String(80000 + Math.floor(rng() * 19999)) };
      items.push({
        id,
        input: render(rng, c),
        expected: c.expected,
        tags: ARCHETYPES[archetype].tags,
        split: items.length % HOLDOUT_EVERY < HOLDOUT_FIRST ? "holdout" : "dev",
        provenance: { source: "synthetic", generator: `gen/generate.mjs seed ${SEED}`, rules: "RULES.md", archetype, version: VERSION },
      });
    }
  }
  return items;
}

function clearGenerated(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith("cd2-")) fs.rmSync(path.join(dir, f));
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
process.stdout.write(`${items.length} items (${holdout} holdout), ids ${items[0].id}…${items.at(-1).id}\n`);
