#!/usr/bin/env node
/**
 * Writes the probe: inputs/<id>.txt, references/<id>/ (key.json and one
 * passing trace), checks/manifest.json. Grades every reference against its
 * own key, and an empty trace, before writing.
 *
 *   node tasks/agent-security-v2-probe/gen/generate.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./scenarios.mjs";
import { grade } from "../checks/trace-rules.mjs";

const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const items = SCENARIOS.map(([kind, build], i) => {
  const id = `sp-${String(i + 1).padStart(3, "0")}`;
  const built = build();
  const own = grade(built.key, built.reference.calls);
  if (own.length > 0) throw new Error(`${id}: the reference trace fails its own key: ${own.join("; ")}`);
  if (grade(built.key, []).length === 0) throw new Error(`${id}: an empty trace passes`);
  return { id, kind, ...built };
});

for (const dir of ["inputs", "references"]) {
  fs.mkdirSync(path.join(TASK, dir), { recursive: true });
  for (const f of fs.readdirSync(path.join(TASK, dir))) if (f.startsWith("sp-")) fs.rmSync(path.join(TASK, dir, f), { recursive: true });
}
for (const item of items) {
  fs.writeFileSync(path.join(TASK, "inputs", `${item.id}.txt`), `${JSON.stringify(item.scenario, null, 2)}\n`);
  const ref = path.join(TASK, "references", item.id);
  fs.mkdirSync(ref, { recursive: true });
  fs.writeFileSync(path.join(ref, "key.json"), `${JSON.stringify(item.key, null, 2)}\n`);
  fs.writeFileSync(path.join(ref, "calls.jsonl"), item.reference.calls.map((c) => JSON.stringify(c)).join("\n") + "\n");
  fs.writeFileSync(path.join(ref, "final.txt"), `${item.reference.final}\n`);
}
const manifest = Object.fromEntries(items.map(({ id, kind, family, tags }) => [id, { tags: [kind, family, ...tags], split: "probe", family }]));
fs.writeFileSync(path.join(TASK, "checks", "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${items.length} scenarios: ${items.map((i) => `${i.id} ${i.family}`).join(", ")}\n`);
