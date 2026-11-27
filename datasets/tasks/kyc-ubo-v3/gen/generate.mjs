#!/usr/bin/env node
/**
 * Builds kyc-ubo-v3: v2's structures, rules and solver, a stratified split,
 * per-item seeds, roughened register extracts, and the ownership the answer
 * follows from stored beside the answer.
 *
 *   node datasets/tasks/kyc-ubo-v3/gen/generate.mjs
 *
 * Writes the split files and the sealed holdout as datasets/gen-kit/splits.mjs
 * describes; the holdout seed is holdout/SEED or $KYC_UBO_V3_HOLDOUT_SEED.
 *
 * Every item has its own seed, from (set seed, split, archetype, index), so
 * changing one split's quota adds or drops items at the end of that split
 * and leaves every other item byte for byte as it was.
 *
 * Not in v3.0, by decision: near-match screening names and missing documents.
 * Their rules come after the Upmarket session; v3 adds them as archetypes.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { solve } from "../../kyc-ubo-v2/gen/solve.mjs";
import { QUOTA as V2_QUOTA, buildStructure } from "../../kyc-ubo-v2/gen/structures.mjs";
import { nameSource, render } from "../../kyc-ubo-v2/gen/render.mjs";
import { itemStreams } from "../../../gen-kit/seeding.mjs";
import { holdoutSeed, writeSplits } from "../../../gen-kit/splits.mjs";
import { roughen } from "./noise.mjs";

export const VERSION = "kyc-ubo-v3.0";
export const SEED = 20261120;
const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOLDOUT_ENV = "KYC_UBO_V3_HOLDOUT_SEED";

/** Items per archetype in each split: 8 archetypes × (25 + 10 + 65) = 800. */
export const QUOTA = { dev: 25, calibration: 10, holdout: 65 };

/** The archetype's short name in ids. */
export const KINDS = {
  normal: "norm",
  "nominal-boundary": "bound",
  aggregation: "aggr",
  "two-vehicles": "twoveh",
  "voting-rights": "vote",
  "own-shares": "own",
  kg: "kg",
  "no-control": "noctl",
};
if (Object.keys(KINDS).join() !== Object.keys(V2_QUOTA).join()) throw new Error("kyc-ubo-v2's archetypes changed; update KINDS");

/** Every entity's shares add up to its capital, in whole positive euros (as v2 checks). */
function assertWellFormed(id, { entities }) {
  for (const [name, e] of Object.entries(entities)) {
    const sum = e.holders.reduce((n, h) => n + h.nominal, 0) + (e.ownShares ?? 0);
    if (e.capital !== undefined && sum !== e.capital) throw new Error(`${id}: shares of ${name} add up to ${sum}, capital is ${e.capital}`);
    if (e.holders.some((h) => !Number.isInteger(h.nominal) || h.nominal <= 0)) throw new Error(`${id}: ${name} has a share that is not a whole positive euro amount`);
  }
}

/** Who holds what, as the extract states it: the key for reading the register before applying the rules. */
function ownership({ target, legalReps, entities }) {
  return {
    target,
    legal_representatives: legalReps,
    entities: Object.fromEntries(Object.entries(entities).map(([name, e]) => [name, {
      capital_eur: e.capital,
      ...(e.ownShares ? { own_shares_eur: e.ownShares } : {}),
      ...(e.generalPartner ? { general_partner: e.generalPartner } : {}),
      holders: e.holders.map((h) => ({ holder: h.holder, kind: h.person ? "person" : "company", nominal_eur: h.nominal, ...(h.voting === false ? { voting: false } : {}) })),
    }])),
  };
}

/**
 * v2's render gives a KG's general partner one seat and HRB number where the
 * KG names it and another in the partner's own register block (found by the
 * 2026-11-19 probe: a model declined to treat the two as one company). The
 * KG's line is rewritten to the seat and number of the partner's own block.
 * v2 is published and keeps its rendering.
 */
function alignGeneralPartner(text) {
  const named = text.match(/^Persönlich haftende Gesellschafterin: (.+?), Sitz [^,]+, HRB \d+, ohne Kapitalanteil$/m);
  if (!named) return text;
  const own = text.match(new RegExp(`^Handelsregister B des Amtsgerichts (.+?), HRB (\\d+)\\nFirma: ${named[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  if (!own) throw new Error(`no register block for the general partner ${named[1]}`);
  const seat = own[1].replace(/ \(.*\)$/, "");
  return text.replace(named[0], `Persönlich haftende Gesellschafterin: ${named[1]}, Sitz ${seat}, HRB ${own[2]}, ohne Kapitalanteil`);
}

/** The item, plus the register (Geschäftsführer, Prokuristen) it was rendered from: the attack sets plant by role. */
export function buildCase(setSeed, split, archetype, index) {
  const id =`ubo3-${split === "holdout" ? "h" : split === "calibration" ? "c" : "d"}-${KINDS[archetype]}-${String(index + 1).padStart(2, "0")}`;
  const streams = itemStreams(setSeed, split, archetype, index);
  const { structure, register, tags } = buildStructure(streams.facts, nameSource(streams.facts), archetype);
  assertWellFormed(id, structure);
  const answer = solve(structure);
  const file = roughen(streams.noise, alignGeneralPartner(render(streams.facts, structure, register)));
  const difficulty = tags.includes("hard") ? "hard" : "normal";
  const derived = [...(answer.fictitious_beneficial_owners.length > 0 ? ["fallback"] : []), ...(register.prokura.length > 0 ? ["prokurist"] : [])];
  const item = {
    id,
    input: file.text,
    expected: { ...answer, steps: { ownership: ownership(structure) } },
    tags: [...new Set([difficulty, archetype, ...tags.filter((t) => t !== "hard" && t !== "normal"), ...derived, ...(file.noise.length === 0 ? ["clean"] : file.noise.map((n) => `noise:${n.split(":")[0]}`))])],
    split,
    metadata: {
      rule_family: archetype,
      difficulty,
      hard_case_type: difficulty === "hard" ? archetype : null,
      noise: file.noise,
      seed: streams.seed,
      generator_version: VERSION,
      source: "synthetic",
    },
  };
  return { item, register, structure };
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
  process.stdout.write(`${writeSplits(TASK, "kyc-ubo-v3", splits, HOLDOUT_ENV)}\n`);
}

// Run as a script; imported (by the tests), only export.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
