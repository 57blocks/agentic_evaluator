/**
 * The split files every v3 generator writes, and the sealed holdout.
 *
 *   <name>.dev.jsonl                   the dev split (a spec's items_file)
 *   <name>.calibration.jsonl           the judge-calibration split
 *   holdout/<name>.holdout.jsonl       only when the holdout seed is present; never committed
 *   holdout.sha256                     the holdout file's hash (committed)
 *
 * Dev and calibration come from a seed in the generator, so anyone can
 * rebuild them byte for byte. The holdout comes from a seed kept out of the
 * repo (holdout/SEED, or the environment variable the generator names): the
 * generators are public, so a public holdout seed would publish the holdout.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The holdout seed, or null when this machine does not have it. */
export function holdoutSeed(task, envName) {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv.trim();
  const file = path.join(task, "holdout", "SEED");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf-8").trim() : null;
}

/** Stops on two items with the same input, in any splits. */
export function assertDistinct(items) {
  const seen = new Map();
  for (const item of items) {
    if (seen.has(item.input)) throw new Error(`${item.id} has the same input as ${seen.get(item.input)}`);
    seen.set(item.input, item.id);
  }
}

export const jsonl = (items) => items.map((i) => JSON.stringify(i)).join("\n") + "\n";

/** Writes the split files; returns one line saying what was written. */
export function writeSplits(task, name, { dev, calibration, holdout }, envName) {
  assertDistinct([...dev, ...(calibration ?? []), ...(holdout ?? [])]);
  fs.writeFileSync(path.join(task, `${name}.dev.jsonl`), jsonl(dev));
  // A set without a calibration split (the attack sets) writes no calibration file.
  if (calibration) fs.writeFileSync(path.join(task, `${name}.calibration.jsonl`), jsonl(calibration));
  const head = `${dev.length} dev${calibration ? `, ${calibration.length} calibration` : ""}`;
  if (!holdout) return `${head}; holdout skipped: no holdout seed (holdout/SEED or $${envName})`;
  const text = jsonl(holdout);
  fs.mkdirSync(path.join(task, "holdout"), { recursive: true });
  fs.writeFileSync(path.join(task, "holdout", `${name}.holdout.jsonl`), text);
  const digest = crypto.createHash("sha256").update(text).digest("hex");
  fs.writeFileSync(path.join(task, "holdout.sha256"), `${digest}  holdout/${name}.holdout.jsonl\n`);
  return `${head}, ${holdout.length} holdout (sha256 ${digest.slice(0, 12)}…)`;
}
