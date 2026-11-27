/**
 * Git, read the way the code-review builders need it.
 *
 * Every call sets `core.quotepath=false` (a non-ASCII path otherwise comes
 * back octal-escaped and in quotes, and then matches nothing) and returns raw
 * stdout. Nothing here writes into the repository it reads: fixture objects
 * go to a scratch object store (see fixture-bundle.ts).
 */

import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const MAX_BUFFER = 512 * 1024 * 1024;

export class GitError extends Error {}

/** A full or abbreviated object id: what a commit field read from a file must be. */
export const SHA = /^[0-9a-f]{7,64}$/i;

/** Refuse a value read from a file that is not an object id (it could be an option). */
export function assertSha(value: unknown, what: string): string {
  if (typeof value !== "string" || !SHA.test(value)) throw new GitError(`${what} is not a commit id: ${JSON.stringify(value)}`);
  return value;
}

/** Refuse a revision that git would parse as an option. */
export function assertNotOption(value: string, what: string): string {
  if (value.startsWith("-")) throw new GitError(`${what} must not start with "-": ${JSON.stringify(value)}`);
  return value;
}

export interface GitOptions {
  /** Extra environment, merged over process.env. */
  env?: Record<string, string>;
  /** Bytes for stdin. */
  input?: string | Buffer;
}

function gitArgv(repo: string, args: readonly string[]): string[] {
  return ["-c", "core.quotepath=false", "-C", repo, ...args];
}

/** Run git and return stdout as bytes; throws GitError with stderr on failure. */
export function gitBytes(repo: string, args: readonly string[], opts: GitOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", gitArgv(repo, args), { env: { ...process.env, ...opts.env }, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", (e) => reject(new GitError(`git ${args.slice(0, 2).join(" ")}: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new GitError(`git ${args.slice(0, 3).join(" ")}: ${Buffer.concat(err).toString("utf-8").trim() || `exit ${code}`}`));
    });
    child.stdin.end(opts.input ?? "");
  });
}

/** Run git and return stdout as UTF-8 text. */
export async function git(repo: string, args: readonly string[], opts: GitOptions = {}): Promise<string> {
  if (opts.input === undefined && opts.env === undefined) {
    return new Promise((resolve, reject) => {
      execFile("git", gitArgv(repo, args), { maxBuffer: MAX_BUFFER, encoding: "utf-8" }, (e, stdout, stderr) => {
        if (e) reject(new GitError(`git ${args.slice(0, 3).join(" ")}: ${String(stderr).trim() || e.message}`));
        else resolve(stdout);
      });
    });
  }
  return (await gitBytes(repo, args, opts)).toString("utf-8");
}

/** Like git(), but a failure is null (a missing path at a revision, say). */
export async function gitMaybe(repo: string, args: readonly string[]): Promise<string | null> {
  return git(repo, args).catch(() => null);
}

export async function revParse(repo: string, rev: string): Promise<string> {
  return (await git(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`])).trim();
}

/**
 * The commits a shallow clone was cut at (empty for a full clone). History
 * before them is missing, so blame credits them with every older line.
 */
export async function shallowBoundary(repo: string): Promise<Set<string>> {
  const file = (await git(repo, ["rev-parse", "--path-format=absolute", "--git-path", "shallow"])).trim();
  const text = await readFile(file, "utf-8").catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return "";
    throw new GitError(`cannot read ${file}: ${err.message}`);
  });
  return new Set(text.split("\n").map((l) => l.trim()).filter((l) => l !== ""));
}

export async function parentsOf(repo: string, sha: string): Promise<string[]> {
  const line = (await git(repo, ["show", "-s", "--format=%P", "--end-of-options", sha])).trim();
  return line === "" ? [] : line.split(" ");
}

export interface CommitInfo {
  sha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  /** ISO 8601 author date. */
  date: string;
  subject: string;
  /** The message's first line (`subject` joins the whole first paragraph). */
  headline: string;
  body: string;
}

const FIELD = "\x1f";
const RECORD = "\x1e";
const INFO_FORMAT = ["%H", "%P", "%an", "%ae", "%aI", "%s", "%b", "%B"].join("%x1f") + "%x1e";

function parseInfo(record: string): CommitInfo {
  const [sha, parents, authorName, authorEmail, date, subject, body, message] = record.replace(/^\n/, "").split(FIELD);
  const headline = (message ?? "").split("\n")[0];
  return { sha, parents: parents ? parents.split(" ") : [], authorName, authorEmail, date, subject, headline, body: (body ?? "").trim() };
}

/** Commits `git log <args>` lists, with their metadata. */
export async function logCommits(repo: string, args: readonly string[]): Promise<CommitInfo[]> {
  const raw = await git(repo, ["log", `--format=${INFO_FORMAT}`, ...args]);
  return raw.split(RECORD).filter((r) => r.trim() !== "").map(parseInfo);
}

export async function commitInfo(repo: string, sha: string): Promise<CommitInfo> {
  const [info] = await logCommits(repo, ["-1", "--no-walk", "--end-of-options", sha]);
  if (!info) throw new GitError(`no commit ${sha}`);
  return info;
}

/** A file's bytes at a revision, split into lines (1-based index = line - 1); null when absent. */
export async function fileLines(repo: string, rev: string, file: string): Promise<string[] | null> {
  const text = await gitMaybe(repo, ["show", "--end-of-options", `${rev}:${file}`]);
  if (text === null) return null;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Paths a diff touches, NUL-separated so any byte in a name survives. */
export async function diffNames(repo: string, from: string, to: string, extra: readonly string[] = []): Promise<string[]> {
  const raw = await git(repo, ["diff", "--name-only", "-z", "--no-renames", ...extra, "--end-of-options", from, to]);
  return raw.split("\0").filter((p) => p !== "");
}

/** Added + deleted lines between two revisions (binary files count 0). */
export async function changedLines(repo: string, from: string, to: string): Promise<{ lines: number; files: number }> {
  const raw = await git(repo, ["diff", "--numstat", "-z", "--no-renames", "--end-of-options", from, to]);
  let lines = 0;
  let files = 0;
  for (const rec of raw.split("\0")) {
    const m = rec.match(/^(\d+|-)\t(\d+|-)\t/);
    if (!m) continue;
    files += 1;
    lines += (m[1] === "-" ? 0 : Number(m[1])) + (m[2] === "-" ? 0 : Number(m[2]));
  }
  return { lines, files };
}

export async function isAncestor(repo: string, a: string, b: string): Promise<boolean> {
  return git(repo, ["merge-base", "--is-ancestor", "--end-of-options", a, b]).then(() => true, () => false);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `git log` arguments for a window of whole days. git reads a bare date as
 * that date at the current time of day, so the same command would mine a
 * different window in the morning and in the afternoon.
 */
export function windowArgs(since: string, until: string | null | undefined): string[] {
  const from = DATE_ONLY.test(since) ? `${since}T00:00:00` : since;
  const to = until && DATE_ONLY.test(until) ? `${until}T23:59:59` : until;
  return [`--since=${from}`, ...(to ? [`--until=${to}`] : [])];
}
