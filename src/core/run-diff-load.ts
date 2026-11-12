/**
 * A run directory read into one side of a diff (src/canon/run-diff.ts).
 *
 * Reads what the run recorded and writes nothing. A file an older run lacks
 * (recommendation.json, raw/) leaves that part of the side empty rather than
 * failing; only the rows and the manifest are required.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../canon/hash.js";
import { trialKey, type DiffManifest, type DiffRow, type RunSide } from "../canon/run-diff.js";
import type { Rate } from "../canon/rates.js";
import { safeName } from "./generate.js";

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function readRows(dir: string): Promise<DiffRow[]> {
  const raw = await fs.readFile(path.join(dir, "scores.jsonl"), "utf-8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") throw new Error(`${dir} has no scores.jsonl: not a finished run`);
    throw err;
  });
  return raw
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      try {
        return JSON.parse(line) as DiffRow;
      } catch {
        throw new Error(`${path.join(dir, "scores.jsonl")} line ${i + 1} is not JSON`);
      }
    });
}

/** A hash of each saved output; none when the run kept no raw/. */
async function readOutputs(dir: string, rows: readonly DiffRow[]): Promise<Map<string, string>> {
  const rawDir = path.join(dir, "raw");
  const present = new Set(await fs.readdir(rawDir).catch(() => [] as string[]));
  const entries = await Promise.all(
    rows.map(async (r): Promise<[string, string] | null> => {
      const file = `${safeName(r.candidate)}__${r.input}__t${r.trial}.txt`;
      if (!present.has(file)) return null;
      return [trialKey(r.candidate, r.input, r.trial), sha256(await fs.readFile(path.join(rawDir, file), "utf-8"))];
    }),
  );
  return new Map(entries.filter((e): e is [string, string] => e !== null));
}

export async function loadRunSide(dir: string): Promise<RunSide> {
  const manifest = await readJson<DiffManifest & { run_id?: string; step?: { id?: string } }>(path.join(dir, "manifest.json"));
  if (manifest === null) throw new Error(`${dir} has no manifest.json: not a run directory`);
  const rows = await readRows(dir);
  const summary = await readJson<{ candidates?: Array<{ candidate: string; task_success_rate: Rate }> }>(path.join(dir, "summary.json"));
  return {
    run: manifest.run_id ?? path.basename(dir),
    step: manifest.step?.id ?? path.basename(dir),
    manifest,
    recommendation: await readJson<RunSide["recommendation"]>(path.join(dir, "recommendation.json")),
    rates: summary?.candidates ?? [],
    rows,
    outputs: await readOutputs(dir, rows),
  };
}
