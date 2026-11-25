#!/usr/bin/env node
/**
 * Mark mining/candidates.json (from `agenteval code-review mine`) with the
 * labels the review-mon-entreprise prototype kept, so v2 holds the same
 * escaped defects.
 *
 *   node scripts/mark-candidates.mjs
 *
 * A candidate is confirmed exactly when its (fix, introducer) pair is one the
 * prototype kept: verdict "defect" or "unsure" in
 * mining/prototype/prescreened.json (a copy of the prototype's
 * mining/prescreened.json, its LLM pre-screen; claude-opus-5.5). Its category,
 * severity and defect text become the candidate's label. Every other
 * candidate is marked confirmed: false. Idempotent; prints any kept pair the
 * mine did not produce.
 *
 * mining/label-review.json (a second model pass over the kept pairs, reading
 * the fix and introducing diffs; still not a human confirmation) then
 * overrules the prototype: a "not_defect" pair is marked confirmed: false, a
 * "not_knowable" one stays in with label.knowable: false (the rest true), a
 * description the review found wrong is replaced by the review's, and
 * label.confirmed_by names the review so `build` never writes "human-confirmed".
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATES = path.join(TASK, "mining", "candidates.json");
const PROTOTYPE = path.join(TASK, "mining", "prototype", "prescreened.json");
const REVIEW = path.join(TASK, "mining", "label-review.json");
const KEPT = new Set(["defect", "unsure"]);
const REVIEWED_BY = "model review 2026-11-24 (mining/label-review.json)";
const reviewed = new Map(JSON.parse(readFileSync(REVIEW, "utf-8")).entries.map((e) => [e.id, e]));

const mined = JSON.parse(readFileSync(CANDIDATES, "utf-8"));
const kept = new Map(
  JSON.parse(readFileSync(PROTOTYPE, "utf-8"))
    .filter((r) => KEPT.has(r.screen.verdict))
    .map((r) => [`${r.fix} ${r.introducing[0].sha}`, r]),
);

const seen = new Set();
const candidates = mined.candidates.map((c) => {
  const key = `${c.fix.sha} ${c.introducing.sha}`;
  const r = kept.get(key);
  const { label: _drop, ...rest } = c;
  if (!r) return { ...rest, confirmed: false };
  seen.add(key);
  const review = reviewed.get(c.id);
  if (review?.verdict === "not_defect") return { ...rest, confirmed: false };
  const label = {
    category: r.screen.category,
    severity: r.screen.severity,
    description: review?.description_differs_from_prescreen ? review.description : r.screen.defect,
    ...(review ? { knowable: review.verdict !== "not_knowable", confirmed_by: REVIEWED_BY } : {}),
  };
  return { ...rest, confirmed: true, label };
});

writeFileSync(CANDIDATES, `${JSON.stringify({ ...mined, candidates }, null, 1)}\n`);
const missing = [...kept.keys()].filter((k) => !seen.has(k));
const confirmed = candidates.filter((c) => c.confirmed).length;
console.log(`${seen.size} of ${kept.size} prototype pairs found; ${confirmed} confirmed after the label review, ${candidates.length - confirmed} marked false`);
for (const k of missing) console.log(`not mined: fix ${k.split(" ")[0].slice(0, 9)} introducer ${k.split(" ")[1].slice(0, 9)}`);
process.exit(missing.length > 0 ? 1 : 0);
