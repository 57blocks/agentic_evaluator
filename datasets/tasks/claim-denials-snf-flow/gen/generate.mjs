#!/usr/bin/env node
/**
 * Builds claim-denials-snf-flow from claim-denials-snf-v2's own generator: the
 * same 300 claim files, byte for byte, split into three steps.
 *
 *   extract    claim file           → root cause, the dates, the records verbatim
 *   decide     extract's answer     → + correctable, next_action
 *   deadline   decide's answer      → deadline
 *
 * Writes, per item:
 *   inputs/<id>.txt            the v2 claim file (extract's input, the chain's root)
 *   inputs/<id>-decide.txt     the correct extract answer (decide's own input)
 *   inputs/<id>-deadline.txt   the correct decide answer (deadline's own input)
 *   references/<step>/<slug>.txt   that step's correct answer, under its own
 *                                  input's slug (what check-task feeds the check)
 * and checks/manifest.json (tags, split, archetype for every input slug).
 *
 *   node datasets/tasks/claim-denials-snf-flow/gen/generate.mjs
 *
 * v2's builders are imported, not copied, and called in v2's order with v2's
 * seed; each claim file is compared with v2's inputs/ and the run stops on the
 * first difference, so the two tasks can never drift apart silently.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHETYPES, QUOTA } from "../../claim-denials-snf-v2/gen/structures.mjs";
import { render } from "../../claim-denials-snf-v2/gen/render.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TASK = path.resolve(HERE, "..");
const V2 = path.resolve(TASK, "..", "claim-denials-snf-v2");

// v2's constants (gen/generate.mjs there); changing any of them is a different set.
const SEED = 20261016;
const EXTRA_PASSES = 9;
const HOLDOUT_EVERY = 5;
const HOLDOUT_FIRST = 2;

/** mulberry32, as in v2. */
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

/** What extract must hand on: what the claim file says, nothing the rules decide. */
function extractAnswer(c) {
  const q = c.claim.qualifying;
  return {
    root_cause: c.expected.root_cause,
    statement_from: c.claim.from,
    statement_through: c.claim.through,
    received_date: c.claim.filed,
    remittance_date: c.remit.date,
    paid_through: c.remit.partial?.paidThrough ?? null,
    qualifying_stay: q ? { admit_order: q.admitOrder, discharge: q.discharge } : null,
    records: c.history,
  };
}

function buildSet() {
  const rng = seeded(SEED);
  const items = [];
  const passes = Array.from({ length: 1 + EXTRA_PASSES }, () => Object.entries(QUOTA)).flat();
  for (const [archetype, count] of passes) {
    for (let k = 0; k < count; k++) {
      const id = `cd2-${String(items.length + 1).padStart(3, "0")}`;
      // The same calls in the same order as v2: build, claim number, render.
      const c = { ...ARCHETYPES[archetype].build(rng), claimNo: String(80000 + Math.floor(rng() * 19999)) };
      const input = render(rng, c);
      const extract = extractAnswer(c);
      const decide = { ...extract, correctable: c.expected.correctable, next_action: c.expected.next_action };
      items.push({
        id,
        input,
        extract,
        decide,
        // { deadline, deadline_also_accepted? }: v2's key, as its check reads it (R7)
        deadline: { deadline: c.expected.deadline, ...(c.expected.deadline_also_accepted ? { deadline_also_accepted: c.expected.deadline_also_accepted } : {}) },
        tags: ARCHETYPES[archetype].tags,
        split: items.length % HOLDOUT_EVERY < HOLDOUT_FIRST ? "holdout" : "dev",
        archetype,
      });
    }
  }
  return items;
}

function assertSameAsV2(items) {
  for (const item of items) {
    const v2 = fs.readFileSync(path.join(V2, "inputs", `${item.id}.txt`), "utf-8");
    if (v2 !== `${item.input}\n`) throw new Error(`${item.id}: claim file differs from claim-denials-snf-v2's`);
    const key = JSON.parse(fs.readFileSync(path.join(V2, "references", `${item.id}.txt`), "utf-8"));
    const mine = { root_cause: item.extract.root_cause, correctable: item.decide.correctable, next_action: item.decide.next_action, ...item.deadline };
    if (JSON.stringify(key) !== JSON.stringify(mine)) throw new Error(`${item.id}: answer key differs from claim-denials-snf-v2's`);
  }
}

const STEPS = ["extract", "decide", "deadline"];
/** A step's own input slug for an item: the claim file for extract, the previous answer after. */
const slugOf = (id, step) => (step === "extract" ? id : `${id}-${step}`);

function clearGenerated(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith("cd2-")) fs.rmSync(path.join(dir, f));
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function write(items) {
  clearGenerated(path.join(TASK, "inputs"));
  for (const step of STEPS) clearGenerated(path.join(TASK, "references", step));
  fs.mkdirSync(path.join(TASK, "checks"), { recursive: true });
  for (const item of items) {
    const answers = { extract: item.extract, decide: item.decide, deadline: item.deadline };
    const inputs = { extract: `${item.input}\n`, decide: json(item.extract), deadline: json(item.decide) };
    for (const step of STEPS) {
      fs.writeFileSync(path.join(TASK, "inputs", `${slugOf(item.id, step)}.txt`), inputs[step]);
      fs.writeFileSync(path.join(TASK, "references", step, `${slugOf(item.id, step)}.txt`), json(answers[step]));
    }
  }
  const label = ({ tags, split, archetype }) => ({ tags, split, archetype });
  const manifest = Object.fromEntries(
    items.flatMap((item) => STEPS.map((step) => [slugOf(item.id, step), label(item)])),
  );
  fs.writeFileSync(path.join(TASK, "checks", "manifest.json"), json(manifest));
}

const items = buildSet();
assertSameAsV2(items);
write(items);
process.stdout.write(`${items.length} items × 3 steps, claim files and keys identical to claim-denials-snf-v2\n`);
