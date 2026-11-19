/**
 * Git, read the way the code-review builders need it.
 *
 * Every call sets `core.quotepath=false` (a non-ASCII path otherwise comes
 * back octal-escaped and in quotes, and then matches nothing) and returns raw
 * stdout. Nothing here writes into the repository it reads: fixture objects
 * go to a scratch object store (see fixture-bundle.ts).
 */

import { execFile, spawn } from "node:child_process";

const MAX_BUFFER = 512 * 1024 * 1024;

export class GitError extends Error {}

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
  return (await git(repo, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`])).trim();
}

export async function parentsOf(repo: string, sha: string): Promise<string[]> {
  const line = (await git(repo, ["show", "-s", "--format=%P", sha])).trim();
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
  body: string;
}

const FIELD = "\x1f";
const RECORD = "\x1e";
const INFO_FORMAT = ["%H", "%P", "%an", "%ae", "%aI", "%s", "%b"].join("%x1f") + "%x1e";

function parseInfo(record: string): CommitInfo {
  const [sha, parents, authorName, authorEmail, date, subject, body] = record.replace(/^\n/, "").split(FIELD);
  return { sha, parents: parents ? parents.split(" ") : [], authorName, authorEmail, date, subject, body: (body ?? "").trim() };
}

/** Commits `git log <args>` lists, with their metadata. */
export async function logCommits(repo: string, args: readonly string[]): Promise<CommitInfo[]> {
  const raw = await git(repo, ["log", `--format=${INFO_FORMAT}`, ...args]);
  return raw.split(RECORD).filter((r) => r.trim() !== "").map(parseInfo);
}

export async function commitInfo(repo: string, sha: string): Promise<CommitInfo> {
  const [info] = await logCommits(repo, ["-1", "--no-walk", sha]);
  if (!info) throw new GitError(`no commit ${sha}`);
  return info;
}

/** A file's bytes at a revision, split into lines (1-based index = line - 1); null when absent. */
export async function fileLines(repo: string, rev: string, file: string): Promise<string[] | null> {
  const text = await gitMaybe(repo, ["show", `${rev}:${file}`]);
  if (text === null) return null;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Paths a diff touches, NUL-separated so any byte in a name survives. */
export async function diffNames(repo: string, from: string, to: string, extra: readonly string[] = []): Promise<string[]> {
  const raw = await git(repo, ["diff", "--name-only", "-z", "--no-renames", ...extra, from, to]);
  return raw.split("\0").filter((p) => p !== "");
}

/** Added + deleted lines between two revisions (binary files count 0). */
export async function changedLines(repo: string, from: string, to: string): Promise<{ lines: number; files: number }> {
  const raw = await git(repo, ["diff", "--numstat", "-z", "--no-renames", from, to]);
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
  return git(repo, ["merge-base", "--is-ancestor", a, b]).then(() => true, () => false);
}
