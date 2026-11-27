#!/usr/bin/env node
/**
 * Write mining/clean.json, the file `agenteval code-review build --clean`
 * reads, from the prototype's 14 clean control PRs
 * (mining/prototype/clean-candidates.json, a copy of review-mon-entreprise's
 * mining/clean-candidates.json, drawn by its select_clean.py with seed
 * 20261119), instead of a new `pick-clean` draw, so v1 and v2 results compare
 * on the same PRs.
 *
 *   node scripts/write-clean.mjs [<clone>]
 *
 * The window is the mined one (fixes from 2025-06-01 to the mined head):
 * build's clean note says "no fix mined from <window> blamed a line", which
 * is what was checked. Some PRs merged earlier than that; their merge dates
 * are in each unit. With <clone>, also checks each PR's commits against the
 * new mine's introducers and prints any a fix now blames (needs gh).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TASK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROTOTYPE = path.join(TASK, "mining", "prototype", "clean-candidates.json");
const MINED = path.join(TASK, "mining", "candidates.json");
const OUT = path.join(TASK, "mining", "clean.json");
// The prototype's bins (select_clean.py BINS): changed lines → how many it drew.
const BINS = [[1, 200, 4], [200, 1000, 6], [1000, 5000, 3], [5000, 20000, 1]];

const proto = JSON.parse(readFileSync(PROTOTYPE, "utf-8"));
const mined = JSON.parse(readFileSync(MINED, "utf-8"));

const picked = proto.picked.map((p) => ({
  unit: { kind: "pr", number: p.number, title: p.title, merged_at: p.mergedAt },
  lines: p.lines,
  files: p.files,
  commits: p.commits,
  bin: p.bin,
}));
const clean = {
  version: 1,
  seed: proto.seed,
  repo: { github: mined.repo.github, branch: mined.repo.branch },
  window: mined.window,
  matched_to: "the review-mon-entreprise prototype's 14 clean PRs (select_clean.py, seed 20261119: merged 2025-01-01 to 2026-09-10, rebase-merged, size-matched to its escaped PRs)",
  bins: BINS.map(([lo, hi, want]) => ({ lo, hi, escaped: 0, want, got: picked.filter((p) => p.bin === `${lo}-${hi}`).length })),
  picked,
  rejected: proto.rejected.map(([n, reason]) => ({ unit: `pr${n}`, reason })),
};
writeFileSync(OUT, `${JSON.stringify(clean, null, 1)}\n`);
console.log(`${picked.length} clean PRs → ${OUT}`);

const clone = process.argv[2];
if (clone) {
  const introducers = new Set(mined.introducers);
  const git = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf-8" });
  for (const p of picked) {
    const pr = JSON.parse(execFileSync("gh", ["pr", "view", String(p.unit.number), "-R", mined.repo.github, "--json", "commits,mergeCommit"], { encoding: "utf-8" }));
    const merge = pr.mergeCommit.oid;
    const shas = git("rev-list", `${merge}~${pr.commits.length}..${merge}`).split("\n").filter(Boolean);
    const hit = shas.filter((s) => introducers.has(s));
    console.log(`pr${p.unit.number}: ${hit.length === 0 ? "no fix in the new mine blames it" : `BLAMED (${hit.map((s) => s.slice(0, 9)).join(", ")})`}`);
  }
}
