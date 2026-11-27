/**
 * `code-review mine`: SZZ over a branch's first-parent history.
 *
 * For each fix commit in the window, the lines it removed from code files are
 * blamed at its parent; the commit that wrote most of them is the suspected
 * introducer. A pair survives when the fix is small, one commit owns most of
 * the blamed lines, that commit is not housekeeping, and it landed through a
 * different PR than the fix. Survivors are candidates for a person to
 * confirm; nothing here decides that a defect is real.
 */

import { commitInfo, logCommits, shallowBoundary, windowArgs, type CommitInfo } from "./git.js";
import { landedThrough, type GitHub } from "./github.js";
import { blameLines, DEFAULT_BLAME, fixedFiles, HOUSEKEEPING, isFix, removedRanges } from "./szz.js";
import { unitId, type BlamedLine, type Candidate, type Dropped, type Introducer, type MinedFile, type Unit } from "./types.js";

export interface MineOptions {
  repo: string;
  branch: string;
  head: string;
  since: string;
  until: string | null;
  fixPattern: string | null;
  maxRemovedLines: number;
  minOwnerShare: number;
  blame: readonly string[];
  github: GitHub | null;
  /** Fixes examined at once (blame with -C is slow on a long history). */
  concurrency?: number;
  /** Progress lines, for a terminal. */
  log?: (line: string) => void;
}

export const DEFAULT_MAX_REMOVED_LINES = 40;
export const DEFAULT_MIN_OWNER_SHARE = 0.6;
const DEFAULT_CONCURRENCY = 6;
const PROGRESS_EVERY = 50;
export { DEFAULT_BLAME };

type Outcome = { candidate: Candidate } | { dropped: Dropped };

interface Context extends MineOptions {
  extra: RegExp | null;
  introducers: Set<string>;
  /** Where a shallow clone was cut: blame names these for lines older than the clone. */
  boundary: Set<string>;
  units: Map<string, Promise<Unit>>;
  infos: Map<string, Promise<CommitInfo>>;
}

function info(ctx: Context, sha: string): Promise<CommitInfo> {
  let p = ctx.infos.get(sha);
  if (!p) ctx.infos.set(sha, (p = commitInfo(ctx.repo, sha)));
  return p;
}

/** The PR a commit landed through; with no GitHub, or no PR, the commit itself. */
function unitOf(ctx: Context, c: CommitInfo): Promise<Unit> {
  let p = ctx.units.get(c.sha);
  if (!p) {
    p = (async (): Promise<Unit> => {
      if (!ctx.github) return { kind: "commit", sha: c.sha, title: c.subject };
      const pr = landedThrough(await ctx.github.pullsForCommit(c.sha), ctx.branch);
      return pr ? { kind: "pr", number: pr.number, title: pr.title, merged_at: pr.mergedAt } : { kind: "commit", sha: c.sha, title: c.subject };
    })();
    ctx.units.set(c.sha, p);
  }
  return p;
}

function sameUnit(a: Unit, b: Unit): boolean {
  return unitId(a) === unitId(b);
}

async function blameFix(ctx: Context, fix: CommitInfo, parent: string): Promise<{ files: string[]; removed: number; blamed: BlamedLine[] } | string> {
  const files = await fixedFiles(ctx.repo, parent, fix.sha);
  const ranges = await Promise.all(files.map((f) => removedRanges(ctx.repo, parent, fix.sha, f)));
  const removed = ranges.flat().reduce((n, r) => n + r.end - r.start + 1, 0);
  if (removed === 0) return "removed no lines of code";
  // Blamed even when the fix is too large to be a candidate: every commit a
  // fix blamed is kept out of the clean set.
  const kept = files.filter((_, i) => ranges[i].length > 0);
  const blamed = (await Promise.all(kept.map((f) => blameLines(ctx.repo, parent, f, ranges[files.indexOf(f)], ctx.blame)))).flat();
  for (const b of blamed) ctx.introducers.add(b.sha);
  if (removed > ctx.maxRemovedLines) return `removed ${removed} lines of code (more than ${ctx.maxRemovedLines})`;
  if (blamed.length === 0) return "blame named no commit";
  return { files: kept, removed, blamed };
}

function tally(blamed: readonly BlamedLine[]): { sha: string; lines: number }[] {
  const counts = new Map<string, number>();
  for (const b of blamed) counts.set(b.sha, (counts.get(b.sha) ?? 0) + 1);
  return [...counts].map(([sha, lines]) => ({ sha, lines })).sort((a, b) => b.lines - a.lines || a.sha.localeCompare(b.sha));
}

async function introducer(ctx: Context, sha: string, lines: number, total: number): Promise<Introducer> {
  const c = await info(ctx, sha);
  return { sha, date: c.date.slice(0, 10), subject: c.subject, lines, share: Math.round((lines / total) * 1000) / 1000 };
}

async function examine(ctx: Context, fix: CommitInfo): Promise<Outcome> {
  const drop = (reason: string, introducing?: string): Outcome => ({ dropped: { fix: fix.sha, subject: fix.subject, reason, ...(introducing ? { introducing } : {}) } });
  const parent = fix.parents[0];
  if (!parent) return drop("root commit");
  const blamed = await blameFix(ctx, fix, parent);
  if (typeof blamed === "string") return drop(blamed);

  const counts = tally(blamed.blamed);
  const total = blamed.blamed.length;
  const top = await introducer(ctx, counts[0].sha, counts[0].lines, total);
  if (ctx.boundary.has(top.sha)) return drop("blame stops at the shallow clone's boundary commit (the real introducer is older than the clone)", top.sha);
  if (top.share < ctx.minOwnerShare) return drop(`top introducer owns ${Math.round(top.share * 100)}% of blamed lines (under ${Math.round(ctx.minOwnerShare * 100)}%)`, top.sha);
  if (HOUSEKEEPING.test(top.subject)) return drop("introducer is chore/style/ci", top.sha);

  const introUnit = await unitOf(ctx, await info(ctx, top.sha));
  const fixUnit = await unitOf(ctx, fix);
  if (sameUnit(introUnit, fixUnit)) return drop(`introducer and fix landed in the same ${introUnit.kind === "pr" ? "PR" : "commit"}`, top.sha);

  const others = await Promise.all(counts.slice(1).map((c) => introducer(ctx, c.sha, c.lines, total)));
  return {
    candidate: {
      id: `${unitId(introUnit)}-fix${fix.sha.slice(0, 7)}`,
      fix: { sha: fix.sha, date: fix.date.slice(0, 10), subject: fix.subject, unit: fixUnit },
      introducing: { ...top, unit: introUnit },
      others,
      files: blamed.files,
      removed_lines: blamed.removed,
      blamed: blamed.blamed,
      confirmed: null,
    },
  };
}

/** map() with at most `limit` calls in flight; results keep the input order. */
export async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export async function mine(opts: MineOptions): Promise<MinedFile> {
  const ctx: Context = {
    ...opts,
    extra: opts.fixPattern ? new RegExp(opts.fixPattern, "i") : null,
    introducers: new Set(),
    boundary: await shallowBoundary(opts.repo),
    units: new Map(),
    infos: new Map(),
  };
  const window = windowArgs(opts.since, opts.until);
  const commits = await logCommits(opts.repo, ["--first-parent", ...window, "--end-of-options", opts.head]);
  const fixes = commits.filter((c) => isFix(c.subject, c.body, c.parents.length > 1, ctx.extra));
  opts.log?.(`${commits.length} commits on ${opts.branch} in the window, ${fixes.length} fixes`);
  if (ctx.boundary.size > 0) opts.log?.("shallow clone: fixes of code older than the clone are dropped");

  let done = 0;
  const outcomes = await mapPool(fixes, opts.concurrency ?? DEFAULT_CONCURRENCY, async (fix) => {
    const outcome = await examine(ctx, fix);
    done += 1;
    if (done % PROGRESS_EVERY === 0) opts.log?.(`  ${done}/${fixes.length} fixes examined`);
    return outcome;
  });
  const candidates = outcomes.flatMap((o) => ("candidate" in o ? [o.candidate] : []));
  const dropped = outcomes.flatMap((o) => ("dropped" in o ? [o.dropped] : []));
  return {
    version: 1,
    repo: { github: opts.github?.repo ?? null, branch: opts.branch, head: opts.head },
    window: { since: opts.since, until: opts.until },
    settings: { fix_pattern: opts.fixPattern, max_removed_lines: opts.maxRemovedLines, min_owner_share: opts.minOwnerShare, blame: [...opts.blame] },
    scanned: { commits: commits.length, fixes: fixes.length },
    introducers: [...ctx.introducers].sort(),
    candidates,
    dropped,
  };
}

/**
 * Keep what a person already wrote on an earlier mine of the same pairs: the
 * `confirmed` mark, the label, and the pre-screen. A pair whose introducer
 * changed is a new pair and starts unreviewed.
 */
export function carryOver(fresh: MinedFile, earlier: MinedFile | null): { mined: MinedFile; carried: number; lost: string[] } {
  if (!earlier) return { mined: fresh, carried: 0, lost: [] };
  const before = new Map(earlier.candidates.map((c) => [`${c.fix.sha}:${c.introducing.sha}`, c]));
  let carried = 0;
  const candidates = fresh.candidates.map((c) => {
    const old = before.get(`${c.fix.sha}:${c.introducing.sha}`);
    if (!old || (old.confirmed === null && !old.label && !old.prescreen)) return c;
    carried += 1;
    return { ...c, confirmed: old.confirmed, ...(old.label ? { label: old.label } : {}), ...(old.prescreen ? { prescreen: old.prescreen } : {}) };
  });
  // Marks on pairs this mine no longer finds (other flags, a moved branch).
  const now = new Set(fresh.candidates.map((c) => `${c.fix.sha}:${c.introducing.sha}`));
  const lost = earlier.candidates
    .filter((c) => (c.confirmed !== null || c.label) && !now.has(`${c.fix.sha}:${c.introducing.sha}`))
    .map((c) => c.id);
  return { mined: { ...fresh, candidates }, carried, lost };
}
