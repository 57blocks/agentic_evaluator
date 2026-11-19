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

function ghApi(args: readonly string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile("gh", ["api", ...args], { maxBuffer: 256 * 1024 * 1024, encoding: "utf-8" }, (e, stdout, stderr) => {
      if (e) {
        reject(new GitHubError(`gh api ${args.filter((a) => !a.startsWith("-")).join(" ")}: ${String(stderr).trim() || e.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new GitHubError(`gh api ${args.join(" ")}: not JSON`));
      }
    });
  });
}

const PAGE = 100;

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
      // Sorted by last update, newest first: a PR merged on or after `since`
      // was updated on or after it too, so the first page entirely older
      // than `since` ends the walk.
      const out: PullSummary[] = [];
      for (let page = 1; ; page++) {
        const list = (await ghApi([`repos/${repo}/pulls?state=closed&base=${encodeURIComponent(base)}&sort=updated&direction=desc&per_page=${PAGE}&page=${page}`])) as Json[];
        for (const p of list) {
          const s = summaryOf(p);
          if (s.mergedAt && s.mergedAt.slice(0, 10) >= since && (until === null || s.mergedAt.slice(0, 10) <= until)) out.push(s);
        }
        const oldest = list.at(-1)?.updated_at as string | undefined;
        if (list.length < PAGE || oldest === undefined || oldest.slice(0, 10) < since) break;
      }
      return out.sort((a, b) => a.number - b.number);
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
