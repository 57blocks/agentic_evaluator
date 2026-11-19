/**
 * SZZ primitives: which commits are fixes, which lines a fix removed, and
 * which commits blame names for them. Read-only on the repository.
 */

import { assertNotOption, git } from "./git.js";
import type { BlamedLine } from "./types.js";

/** Conventional-commit fixes: `fix:`, `fix(scope):`, `fix!:`. */
export const CONVENTIONAL_FIX = /^fix(\(|:|!)/;

/** Introducers whose own subject says they changed no behaviour on purpose. */
export const HOUSEKEEPING = /^(chore|style|ci)(\([^)]*\))?!?:/i;

/**
 * Paths that are not product code: tests, docs, translations, data and
 * lockfiles, images. Their removed lines are not where a reviewer misses a bug.
 */
export const NOT_CODE = /(^|\/)(test|tests|__tests__|__mocks__|e2e|cypress|docs?|\.github|locales?|i18n)\/|\.(test|spec)\.|\.md$|\.mdx$|\.snap$|\.json$|lock|\.ya?ml$|\.svg$|\.png$|\.jpe?g$|\.gif$|\.ico$|\.txt$|\.csv$/i;

export const DEFAULT_BLAME = ["-w", "-M", "-C"] as const;

export function isFix(subject: string, body: string, isMerge: boolean, extra: RegExp | null): boolean {
  const texts = isMerge ? [subject, body.split("\n")[0] ?? ""] : [subject];
  return texts.some((t) => CONVENTIONAL_FIX.test(t) || (extra !== null && extra.test(t)));
}

export interface Range {
  start: number;
  end: number;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

/** Line ranges of `parent:file` that `parent..fix` removed or changed. */
export async function removedRanges(repo: string, parent: string, fix: string, file: string): Promise<Range[]> {
  const diff = await git(repo, ["diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames", "--end-of-options", parent, fix, "--", file]);
  const out: Range[] = [];
  for (const line of diff.split("\n")) {
    const m = HUNK.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const n = m[2] === undefined ? 1 : Number(m[2]);
    if (n > 0) out.push({ start, end: start + n - 1 });
  }
  return out;
}

/** Files a fix removed lines from, minus the ones that are not code. */
export async function fixedFiles(repo: string, parent: string, fix: string): Promise<string[]> {
  const raw = await git(repo, ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=MD", "--end-of-options", parent, fix]);
  return raw.split("\0").filter((p) => p !== "" && !NOT_CODE.test(p)).sort();
}

/**
 * `git blame --porcelain` over several ranges of one file at one revision.
 * Each line group's header is `<sha> <orig> <final> [<n>]`; the `filename`
 * header names the path in that commit (it differs after a move with -M/-C).
 */
export async function blameLines(repo: string, rev: string, file: string, ranges: readonly Range[], opts: readonly string[]): Promise<BlamedLine[]> {
  if (ranges.length === 0) return [];
  // blame misreads --end-of-options (it then takes the path for a revision),
  // so the revision is checked instead.
  assertNotOption(rev, "blame revision");
  const args = ["blame", "--porcelain", ...opts, ...ranges.flatMap((r) => ["-L", `${r.start},${r.end}`]), rev, "--", file];
  const raw = await git(repo, args);
  const out: BlamedLine[] = [];
  const fileOf = new Map<string, string>();
  let current: { sha: string; orig: number; final: number } | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("\t")) {
      if (current) out.push({ file, line: current.final, sha: current.sha, orig_file: fileOf.get(current.sha) ?? file, orig_line: current.orig });
      current = null;
      continue;
    }
    const head = /^([0-9a-f]{40}) (\d+) (\d+)/.exec(line);
    if (head) {
      current = { sha: head[1], orig: Number(head[2]), final: Number(head[3]) };
      continue;
    }
    if (current && line.startsWith("filename ")) fileOf.set(current.sha, line.slice("filename ".length));
  }
  return out;
}
