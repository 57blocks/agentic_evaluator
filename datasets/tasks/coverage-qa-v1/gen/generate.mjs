#!/usr/bin/env node
/**
 * Regenerates the coverage-qa-v1 set from gen/policies.mjs and gen/items.mjs:
 * inputs/<id>.txt (the policy and the question), references/<id>.txt (the
 * answer key), checks/manifest.json (tags, split) and coverage-qa-v1.jsonl
 * (the whole set, one item per line).
 *
 *   node datasets/tasks/coverage-qa-v1/gen/generate.mjs
 *
 * The items are written by hand; this only renders them, so the same files
 * come out every time. Changing a policy, a question or a key is a new version.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ITEMS } from "./items.mjs";
import { POLICIES, renderPolicy, sectionsOf } from "./policies.mjs";

const VERSION = "coverage-qa-v1";
const HOLDOUT_EVERY = 5; // items 0 and 1 of every 5 in the set are holdout: 40%
const HOLDOUT_FIRST = 2;
const ANSWERS = new Set(["yes", "no", "not_addressed"]);
const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A key that cites a section the policy does not have, or a not-addressed item that requires one it should not, is broken. */
function assertWellFormed(id, item) {
  if (!POLICIES[item.policy]) throw new Error(`${id}: unknown policy ${item.policy}`);
  if (!ANSWERS.has(item.answer)) throw new Error(`${id}: answer must be one of ${[...ANSWERS].join(", ")}`);
  const known = new Set(sectionsOf(item.policy));
  for (const s of item.cite.flat()) if (!known.has(s)) throw new Error(`${id}: cites ${s}, which ${item.policy} does not have`);
  if (item.answer === "not_addressed" && item.tags.includes("not-addressed") && item.cite.length > 0) throw new Error(`${id}: a silent policy has nothing to cite`);
}

function buildSet() {
  return ITEMS.map((item, i) => {
    const id = `cq-${String(i + 1).padStart(3, "0")}`;
    assertWellFormed(id, item);
    return {
      id,
      input: `${renderPolicy(item.policy)}\n\nQuestion: ${item.q}`,
      // The key doubles as a correct answer (answer + citations), which is what check-task feeds the check.
      expected: { answer: item.answer, citations: item.cite.map((c) => (Array.isArray(c) ? c[0] : c)), required_citations: item.cite, policy_sections: sectionsOf(item.policy) },
      tags: [item.tags.includes("normal") ? "normal" : "hard", ...item.tags.filter((t) => t !== "normal"), item.policy],
      split: i % HOLDOUT_EVERY < HOLDOUT_FIRST ? "holdout" : "dev",
      provenance: { source: "synthetic", written_by: "hand, gen/items.mjs", policy: item.policy, version: VERSION },
    };
  });
}

function clearGenerated(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith("cq-")) fs.rmSync(path.join(dir, f));
}

function write(items) {
  clearGenerated(path.join(TASK, "inputs"));
  clearGenerated(path.join(TASK, "references"));
  fs.mkdirSync(path.join(TASK, "checks"), { recursive: true });
  for (const item of items) {
    fs.writeFileSync(path.join(TASK, "inputs", `${item.id}.txt`), `${item.input}\n`);
    fs.writeFileSync(path.join(TASK, "references", `${item.id}.txt`), `${JSON.stringify(item.expected, null, 2)}\n`);
  }
  const manifest = Object.fromEntries(items.map(({ id, tags, split }) => [id, { tags, split }]));
  fs.writeFileSync(path.join(TASK, "checks", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(TASK, `${VERSION}.jsonl`), items.map((i) => JSON.stringify(i)).join("\n") + "\n");
}

const items = buildSet();
write(items);
const count = (pred) => items.filter(pred).length;
process.stdout.write(`${items.length} items (${count((i) => i.split === "holdout")} holdout, ${count((i) => i.tags.includes("hard"))} hard), ids ${items[0].id}…${items.at(-1).id}\n`);
