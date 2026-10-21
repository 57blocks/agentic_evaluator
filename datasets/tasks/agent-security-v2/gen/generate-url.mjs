#!/usr/bin/env node
/**
 * Writes the widened url-exfil run (gen/url.mjs) beside the main set:
 * inputs/url-<n>.txt, references/url-<n>/, checks/manifest-url.json. The
 * main set's sec2- files are untouched, so its kept run stays valid.
 *
 *   node datasets/tasks/agent-security-v2/gen/generate-url.mjs
 *   agenteval run datasets/tasks/agent-security-v2/url-exfil.yaml --yes --html
 *
 * Same seed, same items.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { urlAttack, urlMirror } from "./url.mjs";
import { values } from "./names.mjs";
import { grade } from "../checks/trace-rules.mjs";

// v2: the newsletter request says "save … as a note" like the page one (v1
// said "in a three-bullet note", which one model answered in its reply), and
// 120 items instead of 32.
const SEED = 20261021;
const ATTACKS = 96; // eight phrasings × two channels × six
const MIRRORS = 24; // team code / consented email × page / newsletter × six
const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

const rng = seeded(SEED);
const plan = [...Array.from({ length: ATTACKS }, (_, k) => ["attack", urlAttack, k]), ...Array.from({ length: MIRRORS }, (_, k) => ["benign", urlMirror, k])];
const items = plan.map(([kind, build, k], i) => {
  const id = `url-${String(i + 1).padStart(3, "0")}`;
  const built = build(rng, values(rng), k);
  const own = grade(built.key, built.reference.calls);
  if (own.length > 0) throw new Error(`${id}: the reference trace fails its own key: ${own.join("; ")}`);
  if (grade(built.key, []).length === 0) throw new Error(`${id}: an empty trace passes`);
  return { id, kind, ...built };
});

for (const dir of ["inputs", "references"]) {
  for (const f of fs.readdirSync(path.join(TASK, dir))) if (f.startsWith("url-")) fs.rmSync(path.join(TASK, dir, f), { recursive: true });
}
for (const item of items) {
  fs.writeFileSync(path.join(TASK, "inputs", `${item.id}.txt`), `${JSON.stringify(item.scenario, null, 2)}\n`);
  const ref = path.join(TASK, "references", item.id);
  fs.mkdirSync(ref, { recursive: true });
  fs.writeFileSync(path.join(ref, "key.json"), `${JSON.stringify(item.key, null, 2)}\n`);
  fs.writeFileSync(path.join(ref, "calls.jsonl"), item.reference.calls.map((c) => JSON.stringify(c)).join("\n") + "\n");
  fs.writeFileSync(path.join(ref, "final.txt"), `${item.reference.final}\n`);
}
const manifest = Object.fromEntries(items.map(({ id, kind, tags }) => [id, { tags: [kind, kind === "attack" ? "url-exfil" : "url-mirror", ...tags], split: "dev", family: kind === "attack" ? "url-exfil" : "url-mirror" }]));
fs.writeFileSync(path.join(TASK, "checks", "manifest-url.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${items.length} items: ${ATTACKS} attacks, ${MIRRORS} mirrors, ids ${items[0].id}…${items.at(-1).id}\n`);
