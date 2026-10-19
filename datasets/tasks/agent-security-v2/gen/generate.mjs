#!/usr/bin/env node
/**
 * Regenerates the agent-security-v2 set: inputs/<id>.txt (the scenario the
 * agent reads: system prompt, request, tools with canned results, files),
 * references/<id>/ (key.json, the rules the check applies, and one trace
 * that passes them), checks/manifest.json (tags, split) and
 * agent-security-v2.jsonl (the whole set, one item per line).
 *
 *   node datasets/tasks/agent-security-v2/gen/generate.mjs
 *
 * Same seed, same set. Changing the seed, a builder or a rule is a new version.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ATTACKS } from "./attacks.mjs";
import { BENIGN } from "./benign.mjs";
import { values } from "./names.mjs";
import { grade } from "../checks/trace-rules.mjs";

const SEED = 20261020;
const VERSION = "agent-security-v2";
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

/** A reference that fails its own rules, or rules an empty trace passes, is a broken item. */
function assertGradable(id, key, reference) {
  const own = grade(key, reference.calls);
  if (own.length > 0) throw new Error(`${id}: the reference trace fails its own key: ${own.join("; ")}`);
  if (grade(key, []).length === 0) throw new Error(`${id}: an empty trace passes`);
}

function buildSet() {
  const rng = seeded(SEED);
  const items = [];
  for (const [kind, families] of [["attack", ATTACKS], ["benign", BENIGN]]) {
    for (const [family, [build, count]] of Object.entries(families)) {
      for (let k = 0; k < count; k++) {
        const id = `sec2-${String(items.length + 1).padStart(3, "0")}`;
        const built = build(rng, values(rng), k);
        assertGradable(id, built.key, built.reference);
        items.push({
          id,
          input: built.scenario,
          expected: built.key,
          reference: built.reference,
          tags: [...new Set([kind, family, ...built.tags])],
          split: items.length % HOLDOUT_EVERY < HOLDOUT_FIRST ? "holdout" : "dev",
          provenance: { source: "synthetic", generator: `gen/generate.mjs seed ${SEED}`, rules: "RULES.md", family, version: VERSION },
        });
      }
    }
  }
  return items;
}

function clearGenerated(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith("sec2-")) fs.rmSync(path.join(dir, f), { recursive: true });
}

function write(items) {
  clearGenerated(path.join(TASK, "inputs"));
  clearGenerated(path.join(TASK, "references"));
  fs.mkdirSync(path.join(TASK, "checks"), { recursive: true });
  for (const item of items) {
    fs.writeFileSync(path.join(TASK, "inputs", `${item.id}.txt`), `${JSON.stringify(item.input, null, 2)}\n`);
    const ref = path.join(TASK, "references", item.id);
    fs.mkdirSync(ref, { recursive: true });
    fs.writeFileSync(path.join(ref, "key.json"), `${JSON.stringify(item.expected, null, 2)}\n`);
    fs.writeFileSync(path.join(ref, "calls.jsonl"), item.reference.calls.map((c) => JSON.stringify(c)).join("\n") + "\n");
    fs.writeFileSync(path.join(ref, "final.txt"), `${item.reference.final}\n`);
  }
  const manifest = Object.fromEntries(items.map(({ id, tags, split, provenance }) => [id, { tags, split, family: provenance.family }]));
  fs.writeFileSync(path.join(TASK, "checks", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(TASK, `${VERSION}.jsonl`), items.map((i) => JSON.stringify(i)).join("\n") + "\n");
}

const items = buildSet();
write(items);
const count = (pred) => items.filter(pred).length;
process.stdout.write(
  `${items.length} items (${count((i) => i.split === "holdout")} holdout): ${count((i) => i.tags.includes("attack"))} attacks, ${count((i) => i.tags.includes("benign"))} benign controls, ids ${items[0].id}…${items.at(-1).id}\n`,
);
