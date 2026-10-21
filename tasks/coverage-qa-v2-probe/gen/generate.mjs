#!/usr/bin/env node
/**
 * Writes the probe from gen/items.mjs: inputs/<id>.txt (the policy and the
 * question), references/<id>.txt (the key, which doubles as a correct
 * answer) and checks/manifest.json.
 *
 *   node tasks/coverage-qa-v2-probe/gen/generate.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ITEMS, POLICY_ID, SECTIONS } from "./items.mjs";

const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const known = new Set(SECTIONS.map(([no]) => no));
const policy = [`Sample Health Plan · Medical Policy ${POLICY_ID} · Outpatient Therapy`, "Effective 2026-04-01", "", ...SECTIONS.map(([no, text]) => `${no} ${text}`)].join("\n");

const items = ITEMS.map((item, i) => {
  const id = `cq2p-${String(i + 1).padStart(3, "0")}`;
  for (const s of item.cite.flat()) if (!known.has(s)) throw new Error(`${id}: cites ${s}, which the policy does not have`);
  return {
    id,
    input: `${policy}\n\nQuestion: ${item.q}`,
    // The key doubles as a correct answer; with several accepted answers, the first stands in for check-task.
    expected: { answer: [item.answer].flat()[0], accepted: [item.answer].flat(), citations: item.cite.map((c) => (Array.isArray(c) ? c[0] : c)), required_citations: item.cite, policy_sections: [...known] },
    tags: item.tags,
  };
});

for (const dir of ["inputs", "references"]) {
  fs.mkdirSync(path.join(TASK, dir), { recursive: true });
  for (const f of fs.readdirSync(path.join(TASK, dir))) if (f.startsWith("cq2p-")) fs.rmSync(path.join(TASK, dir, f));
}
for (const item of items) {
  fs.writeFileSync(path.join(TASK, "inputs", `${item.id}.txt`), `${item.input}\n`);
  fs.writeFileSync(path.join(TASK, "references", `${item.id}.txt`), `${JSON.stringify(item.expected, null, 2)}\n`);
}
fs.writeFileSync(path.join(TASK, "checks", "manifest.json"), `${JSON.stringify(Object.fromEntries(items.map(({ id, tags }) => [id, { tags, split: "probe" }])), null, 2)}\n`);
process.stdout.write(`${items.length} items: ${items.map((i) => `${i.id}=${i.expected.answer}`).join(", ")}\n`);
