/**
 * What the code-review builders ask GitHub, behind an interface so tests (and
 * repos with no GitHub remote) never touch the network.
 *
 * The real client shells out to `gh api`, so authentication is whatever gh
 * already has; no token passes through this process.
 */

import { execFile } from "node:child_process";

export interface PullSummary {
  number: number;
  title: string;
  /** ISO time, null when the PR was closed without merging. */
  mergedAt: string | null;
  baseRef: string;
  /** GitHub's merge_commit_sha: the merge, the squash, or the last rebased commit. */
  mergeCommitSha: string | null;
  author: string;
  isBot: boolean;
  /** Additions + deletions as GitHub counts them, when the listing gives them (a hint; git decides). */
  changedLines?: number;
}

export interface PullCommit {
  sha: string;
  /** First line of the message. */
  headline: string;
}

export interface PullDetail extends PullSummary {
  body: string;
  createdAt: string;
  /** How many commits GitHub says the PR has. */
  commitCount: number;
  /** The commits GitHub lists, in order (the API stops at 250). */
  commits: PullCommit[];
}

export interface GitHub {
  readonly repo: string;
  /** PRs GitHub associates with a commit. */
  pullsForCommit(sha: string): Promise<PullSummary[]>;
  pull(number: number): Promise<PullDetail>;
  /** PRs merged into `base` between since and until (inclusive dates, YYYY-MM-DD). */
  mergedPulls(base: string, since: string, until: string | null): Promise<PullSummary[]>;
}

export class GitHubError extends Error {}

const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function checkRepoName(repo: string): string {
  if (!OWNER_REPO.test(repo)) throw new GitHubError(`--github must be owner/repo, got "${repo}"`);
  return repo;
}

type Json = Record<string, unknown>;

function summaryOf(p: Json): PullSummary {
  const user = (p.user ?? {}) as Json;
  const base = (p.base ?? {}) as Json;
  const login = String(user.login ?? "");
  return {
    number: Number(p.number),
    title: String(p.title ?? ""),
    mergedAt: (p.merged_at as string | null) ?? null,
    baseRef: String(base.ref ?? ""),
    mergeCommitSha: (p.merge_commit_sha as string | null) ?? null,
    author: login,
    isBot: user.type === "Bot" || /\[bot\]$|-bot$|^dependabot|^renovate/i.test(login),
  };
}

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

/** A 404 or 422 is an answer; a dropped stream or a 5xx is worth another try. */
const TRANSIENT = /stream error|CANCEL|timeout|timed out|connection reset|EOF|HTTP 5\d\d|HTTP 429|rate limit/i;

function ghApi(args: readonly string[]): Promise<unknown> {
  return ghJson(["api", ...args]);
}

async function ghJson(args: readonly string[]): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await ghOnce(args);
    } catch (err) {
      if (attempt >= ATTEMPTS || !TRANSIENT.test((err as Error).message)) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
}

function ghOnce(args: readonly string[]): Promise<unknown> {
  const what = `gh ${args.filter((a) => !a.startsWith("-")).slice(0, 3).join(" ")}`;
  return new Promise((resolve, reject) => {
    execFile("gh", [...args], { maxBuffer: 256 * 1024 * 1024, encoding: "utf-8" }, (e, stdout, stderr) => {
      if (e) {
        reject(new GitHubError(`${what}: ${String(stderr).trim() || e.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new GitHubError(`${what}: not JSON`));
      }
    });
  });
}

const PAGE = 100;
const MAX_LISTED = 5000;

/** The client every command uses unless a test hands in its own. */
export function ghClient(repo: string): GitHub {
  checkRepoName(repo);
  return {
    repo,
    async pullsForCommit(sha) {
      const list = (await ghApi([`repos/${repo}/commits/${sha}/pulls`])) as Json[];
      return list.map(summaryOf);
    },
    async pull(number) {
      const p = (await ghApi([`repos/${repo}/pulls/${number}`])) as Json;
      const pages = (await ghApi(["--paginate", "--slurp", `repos/${repo}/pulls/${number}/commits?per_page=${PAGE}`])) as Json[][];
      const commits = pages.flat().map((c) => ({
        sha: String(c.sha),
        headline: String(((c.commit ?? {}) as Json).message ?? "").split("\n")[0],
      }));
      return { ...summaryOf(p), body: String(p.body ?? ""), createdAt: String(p.created_at ?? ""), commitCount: Number(p.commits ?? commits.length), commits };
    },
    async mergedPulls(base, since, until) {
      // `gh pr list` (GraphQL) returns only the fields asked for, sizes
      // included; the REST list returns whole PRs and dropped its stream on
      // a slow link.
      const list = (await ghJson([
        "pr", "list", "-R", repo, "--state", "merged", "--base", base, "--limit", String(MAX_LISTED),
        "--search", `merged:${since}..${until ?? "*"}`,
        "--json", "number,title,mergedAt,baseRefName,mergeCommit,author,additions,deletions",
      ])) as Json[];
      if (list.length >= MAX_LISTED) throw new GitHubError(`more than ${MAX_LISTED} PRs merged in the window: narrow it with --since/--until`);
      return list.map((p) => {
        const author = (p.author ?? {}) as Json;
        const login = String(author.login ?? "");
        return {
          number: Number(p.number),
          title: String(p.title ?? ""),
          mergedAt: (p.mergedAt as string | null) ?? null,
          baseRef: String(p.baseRefName ?? ""),
          mergeCommitSha: (((p.mergeCommit ?? null) as Json | null)?.oid as string | undefined) ?? null,
          author: login,
          isBot: author.is_bot === true || /\[bot\]$|-bot$|^dependabot|^renovate|^app\//i.test(login),
          changedLines: Number(p.additions ?? 0) + Number(p.deletions ?? 0),
        };
      }).sort((a, b) => a.number - b.number);
    },
  };
}

/** The merged PR a commit landed through, if GitHub knows one. */
export function landedThrough(pulls: readonly PullSummary[], base: string): PullSummary | null {
  const merged = pulls.filter((p) => p.mergedAt !== null);
  const onBase = merged.filter((p) => p.baseRef === base);
  const pool = onBase.length > 0 ? onBase : merged;
  return [...pool].sort((a, b) => String(a.mergedAt).localeCompare(String(b.mergedAt)) || a.number - b.number)[0] ?? null;
}
