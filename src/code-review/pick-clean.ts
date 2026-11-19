/**
 * `code-review pick-clean`: control PRs for the escaped set.
 *
 * "Clean" means only that no fix `mine` scanned blamed a line the PR wrote.
 * That is weaker than proof of no defect, so a measure built on these PRs is
 * "defect claims per clean PR", not a false-positive rate.
 *
 * From the PRs merged in the window (or, with no GitHub, the first-parent
 * commits): drop bots and housekeeping, drop anything any blamed commit
 * belongs to, then draw at random with a fixed seed, size-matched by changed
 * lines to the confirmed escaped PRs.
 */

import { changedLines, logCommits } from "./git.js";
import { checkMinedShas } from "./candidates-file.js";
import type { GitHub } from "./github.js";
import { resolveRange } from "./pr-range.js";
import { unitId, type CleanFile, type CleanPick, type MinedFile, type Unit } from "./types.js";

export const DEFAULT_SEED = 20261119;

/** Changed-line bins: [lo, hi). */
export const SIZE_EDGES = [1, 50, 200, 1000, 5000] as const;

export const NOT_A_CHANGE = /^(chore|build|ci|deps|release|revert|docs|test)s?\b|^merge (branch|remote)|\bbump\b|renovate|dependabot|\brelease\b/i;

export interface PickOptions {
  repo: string;
  mined: MinedFile;
  count: number;
  seed: number;
  since: string;
  until: string | null;
  github: GitHub | null;
  log?: (line: string) => void;
}

/** mulberry32: small, seedable, the same sequence on every platform. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rnd = seededRandom(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function binOf(lines: number): number {
  let b = 0;
  while (b + 1 < SIZE_EDGES.length && lines >= SIZE_EDGES[b + 1]) b++;
  return b;
}

function binLabel(b: number): string {
  const hi = SIZE_EDGES[b + 1];
  return hi === undefined ? `${SIZE_EDGES[b]}+` : `${SIZE_EDGES[b]}-${hi}`;
}

/** `count` split across bins in proportion to `weights`, largest remainder first. */
export function apportion(count: number, weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / total) * count);
  const out = exact.map(Math.floor);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; out.reduce((a, b) => a + b, 0) < count; k++) out[order[k % order.length].i] += 1;
  return out;
}

interface Pool {
  units: Unit[];
  rejected: { unit: string; reason: string }[];
  /** GitHub's changed-line counts, to pass over a PR whose bin is full without asking for it. */
  hints: Map<string, number>;
}

async function pool(opts: PickOptions, branch: string): Promise<Pool> {
  const rejected: { unit: string; reason: string }[] = [];
  const units: Unit[] = [];
  const hints = new Map<string, number>();
  if (opts.github) {
    for (const p of await opts.github.mergedPulls(branch, opts.since, opts.until)) {
      const unit: Unit = { kind: "pr", number: p.number, title: p.title, merged_at: p.mergedAt };
      if (p.isBot) rejected.push({ unit: unitId(unit), reason: `bot (${p.author})` });
      else if (NOT_A_CHANGE.test(p.title.trim())) rejected.push({ unit: unitId(unit), reason: "housekeeping title" });
      else {
        units.push(unit);
        if (p.changedLines !== undefined) hints.set(unitId(unit), p.changedLines);
      }
    }
    return { units, rejected, hints };
  }
  const window = [`--since=${opts.since}`, ...(opts.until ? [`--until=${opts.until}`] : [])];
  for (const c of await logCommits(opts.repo, ["--first-parent", ...window, "--end-of-options", opts.mined.repo.head])) {
    const unit: Unit = { kind: "commit", sha: c.sha, title: c.subject };
    if (/\bbot\b|\[bot\]/i.test(`${c.authorName} ${c.authorEmail}`)) rejected.push({ unit: unitId(unit), reason: `bot (${c.authorName})` });
    else if (NOT_A_CHANGE.test(c.subject.trim())) rejected.push({ unit: unitId(unit), reason: "housekeeping subject" });
    else units.push(unit);
  }
  return { units, rejected, hints };
}

/** Changed lines of each escaped unit, the set clean picks are matched to. */
async function escapedSizes(opts: PickOptions): Promise<{ sizes: number[]; matchedTo: string }> {
  const confirmed = opts.mined.candidates.filter((c) => c.confirmed === true);
  const basis = confirmed.length > 0 ? confirmed : opts.mined.candidates.filter((c) => c.confirmed !== false);
  const units = new Map(basis.map((c) => [unitId(c.introducing.unit), c.introducing.unit]));
  const sizes: number[] = [];
  for (const unit of units.values()) {
    const r = await resolveRange(opts.repo, unit, opts.github);
    if ("range" in r) sizes.push((await changedLines(opts.repo, r.range.base, r.range.head)).lines);
  }
  const what = confirmed.length > 0 ? "confirmed escaped" : "unreviewed escaped (none confirmed yet)";
  return { sizes, matchedTo: `${sizes.length} ${what} ${opts.github ? "PRs" : "commits"} of ${units.size}` };
}

export async function pickClean(opts: PickOptions): Promise<CleanFile> {
  checkMinedShas(opts.mined);
  const branch = opts.mined.repo.branch;
  const introducers = new Set(opts.mined.introducers);
  const escaped = new Set(opts.mined.candidates.map((c) => unitId(c.introducing.unit)));
  const { sizes, matchedTo } = await escapedSizes(opts);
  const weights = SIZE_EDGES.map((_, b) => sizes.filter((s) => binOf(s) === b).length);
  // With nothing to match, draw evenly over the bins.
  const want = apportion(opts.count, sizes.length > 0 ? weights : SIZE_EDGES.map(() => 1));
  const got = SIZE_EDGES.map(() => 0);

  const { units, rejected, hints } = await pool(opts, branch);
  const sorted = [...units].sort((a, b) => unitId(a).localeCompare(unitId(b)));
  const picked: CleanPick[] = [];
  for (const unit of shuffled(sorted, opts.seed)) {
    if (got.every((g, b) => g >= want[b])) break;
    const id = unitId(unit);
    const hint = hints.get(id);
    if (hint !== undefined && hint > 0 && got[binOf(hint)] >= want[binOf(hint)]) continue;
    if (escaped.has(id)) {
      rejected.push({ unit: id, reason: "an escaped-defect candidate" });
      continue;
    }
    const r = await resolveRange(opts.repo, unit, opts.github);
    if ("skip" in r) {
      rejected.push({ unit: id, reason: r.skip });
      continue;
    }
    if (r.range.members.some((s) => introducers.has(s))) {
      rejected.push({ unit: id, reason: "a later fix blamed a line it wrote" });
      continue;
    }
    const size = await changedLines(opts.repo, r.range.base, r.range.head);
    if (size.lines === 0) {
      rejected.push({ unit: id, reason: "changes no lines" });
      continue;
    }
    const b = binOf(size.lines);
    if (got[b] >= want[b]) continue;
    got[b] += 1;
    picked.push({ unit, lines: size.lines, files: size.files, commits: r.range.replay.length, bin: binLabel(b) });
    opts.log?.(`pick ${id} (${size.lines} lines) ${unit.title.slice(0, 60)}`);
  }
  return {
    version: 1,
    seed: opts.seed,
    repo: { github: opts.mined.repo.github, branch },
    window: { since: opts.since, until: opts.until },
    matched_to: matchedTo,
    bins: SIZE_EDGES.map((lo, b) => ({ lo, hi: SIZE_EDGES[b + 1] ?? null, escaped: weights[b], want: want[b], got: got[b] })),
    picked: picked.sort((a, b) => a.lines - b.lines || unitId(a.unit).localeCompare(unitId(b.unit))),
    rejected: rejected.sort((a, b) => a.unit.localeCompare(b.unit)),
  };
}
