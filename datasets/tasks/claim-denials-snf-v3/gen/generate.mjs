#!/usr/bin/env node
/**
 * Builds claim-denials-snf-v3: v2's rules and case builders, a stratified
 * split, per-item seeds, noisy claim files, and a key for every step.
 *
 *   node datasets/tasks/claim-denials-snf-v3/gen/generate.mjs
 *
 * Writes the split files and the sealed holdout as datasets/gen-kit/splits.mjs
 * describes; the holdout seed is holdout/SEED or $CLAIM_DENIALS_V3_HOLDOUT_SEED.
 *
 * Every item has its own seed, from (set seed, split, archetype, index), so
 * changing one split's quota adds or drops items at the end of that split
 * and leaves every other item byte for byte as it was.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHETYPES } from "../../claim-denials-snf-v2/gen/structures.mjs";
import { filingDeadline, redeterminationDeadline } from "../../claim-denials-snf-v2/gen/rules.mjs";
import { itemStreams } from "../../../gen-kit/seeding.mjs";
import { holdoutSeed, writeSplits } from "../../../gen-kit/splits.mjs";
import { render } from "./render.mjs";

export const VERSION = "claim-denials-snf-v3.0";
export const SEED = 20261119;
const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOLDOUT_ENV = "CLAIM_DENIALS_V3_HOLDOUT_SEED";

/** Items per archetype in each split: 7 archetypes × (30 + 10 + 75) = 805. */
export const QUOTA = { dev: 30, calibration: 10, holdout: 75 };

/** The archetype's short name in ids, and the rule that decides it (RULES.md in v2). */
export const KINDS = {
  "duplicate-paid": { short: "dup", family: "R6" },
  "late-filing": { short: "late", family: "R1" },
  unprocessable: { short: "ma130", family: "R3" },
  "filing-through-date": { short: "ftd", family: "R1" },
  "new-benefit-period": { short: "nbp", family: "R5" },
  "benefit-exhausted": { short: "exh", family: "R5" },
  "qualifying-stay": { short: "qstay", family: "R4" },
};

/** R7 moved the deadline off a nonworkday (or, for a reopening, also accepts the next workday). */
function rolled(c) {
  const e = c.expected;
  if (e.deadline === null) return false;
  if (e.deadline_also_accepted) return true;
  if (e.next_action === "appeal") return e.deadline !== redeterminationDeadline(c.remit.date);
  if (e.next_action === "corrected_claim") return e.deadline !== filingDeadline(c.claim.through);
  return false;
}

/** The item, plus the case it was rendered from (the review explains the key from it). */
export function buildCase(setSeed, split, archetype, index) {
  const { short, family } = KINDS[archetype];
  const streams = itemStreams(setSeed, split, archetype, index);
  const c = { ...ARCHETYPES[archetype].build(streams.facts), claimNo: String(80000 + Math.floor(streams.facts() * 19999)) };
  const file = render(streams.facts, streams.noise, c);
  const archetypeTags = ARCHETYPES[archetype].tags;
  const difficulty = archetypeTags.includes("hard") ? "hard" : "normal";
  const triage = c.expected;
  const item = {
    id:`cd3-${split === "holdout" ? "h" : split === "calibration" ? "c" : "d"}-${short}-${String(index + 1).padStart(2, "0")}`,
    input: file.text,
    // The triage step's key at the top, as v2's check reads it; each earlier step's key under steps.
    expected: {
      ...triage,
      steps: {
        parse: file.parsed,
        records: file.records,
        facts: file.facts,
      },
    },
    tags: [...new Set([difficulty, archetype, family, ...archetypeTags.filter((t) => t !== "hard" && t !== "normal"), ...(rolled(c) ? ["R7-rollover"] : []), ...(file.noise.length === 0 ? ["clean"] : file.noise.map((n) => `noise:${n.split(":")[0]}`))])],
    split,
    metadata: {
      rule_family: family,
      difficulty,
      hard_case_type: difficulty === "hard" ? archetype : null,
      noise: file.noise,
      seed: streams.seed,
      generator_version: VERSION,
      source: "synthetic",
    },
  };
  return { item, c };
}

export const buildItem = (setSeed, split, archetype, index) => buildCase(setSeed, split, archetype, index).item;

export function buildSplit(setSeed, split) {
  return Object.keys(KINDS).flatMap((archetype) => Array.from({ length: QUOTA[split] }, (_, i) => buildItem(setSeed, split, archetype, i)));
}

function main() {
  const secret = holdoutSeed(TASK, HOLDOUT_ENV);
  const splits = {
    dev: buildSplit(SEED, "dev"),
    calibration: buildSplit(SEED, "calibration"),
    holdout: secret ? buildSplit(`holdout:${secret}`, "holdout") : null,
  };
  process.stdout.write(`${writeSplits(TASK, "claim-denials-snf-v3", splits, HOLDOUT_ENV)}\n`);
}

// Run as a script; imported (by the tests), only export.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
