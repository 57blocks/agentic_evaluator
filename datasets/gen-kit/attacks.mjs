/**
 * What both attack-set generators share: reading the authored corpus, filling
 * its placeholders, the ids, and the per-pair stream that picks a base case.
 * The texts and their rules are in ATTACK-AUTHORING.md.
 */

import fs from "node:fs";
import path from "node:path";
import { hash32, seeded, int } from "./seeding.mjs";

export const FAMILIES = { "answer-override": "ovr", "rule-change": "rule", "secret-exfil": "sec", "url-beacon": "url", "output-hijack": "hij" };
export const CHANNELS = { newsletter: "nl", "web-page": "web", "record-field": "rec", "code-comment": "code" };

/** Every authored pair in dir/<family>.json, in family, channel, n order; families without a file are reported, not invented. */
export function loadCorpus(dir) {
  const pairs = [];
  const missing = [];
  for (const family of Object.keys(FAMILIES)) {
    const file = path.join(dir, `${family}.json`);
    if (!fs.existsSync(file)) {
      missing.push(family);
      continue;
    }
    const list = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const pair of list) {
      if (pair.family !== family) throw new Error(`${file}: n=${pair.n} says family ${pair.family}`);
      if (!(pair.channel in CHANNELS)) throw new Error(`${file}: n=${pair.n} has unknown channel ${pair.channel}`);
      for (const k of ["attack", "mirror", "target"]) if (!pair[k]) throw new Error(`${file}: ${pair.channel} n=${pair.n} has no ${k}`);
      pairs.push(pair);
    }
  }
  return { pairs, missing };
}

/** Fills {name} placeholders from values; {{ and }} are literal braces. An unknown or empty placeholder stops the build. */
export function fill(text, values, where) {
  return text
    .replace(/\{\{|\}\}|\{([a-z_]+)\}/g, (match, name) => {
      if (match === "{{") return "{";
      if (match === "}}") return "}";
      if (values[name] === undefined || values[name] === null) throw new Error(`${where}: no value for {${name}}`);
      return values[name];
    });
}

/** The placeholders a text uses. */
export const placeholders = (text) => [...text.replace(/\{\{|\}\}/g, "").matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);

export const pairId = (prefix, split, pair, kind) =>
  `${prefix}-${split === "holdout" ? "h" : "d"}-${FAMILIES[pair.family]}-${CHANNELS[pair.channel]}-${pair.n}-${{ attack: "a", mirror: "m", control: "c" }[kind]}`;

/** The pair's own stream: which base case it lands on, the secret, the record date. */
export const pairStream = (setSeed, pair) => seeded(hash32(`${setSeed}:attack:${pair.family}:${pair.channel}:${pair.n}`));

/** A secret value in the given shape, e.g. "PX-####-9999": # a letter or digit, 9 a digit. */
export function secretValue(rng, shape) {
  const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return shape.replace(/[#9]/g, (c) => (c === "9" ? String(int(rng, 0, 9)) : ALNUM[int(rng, 0, ALNUM.length - 1)]));
}

/** Text for one line of a record: no line breaks. */
export const oneLine = (text) => text.replace(/\s*\n\s*/g, " ").trim();
