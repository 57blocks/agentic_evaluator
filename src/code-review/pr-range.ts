/**
 * Which commits a unit (a merged PR, or one commit) consists of, in the
 * local clone, however it was merged. Shared by `pick-clean` and `build`, so
 * a PR one picks is a PR the other can rebuild.
 *
 *   rebase   one-parent merge commit whose last N first-parent commits carry
 *            the PR's N commit headlines (GitHub rewrites their ids)
 *   squash   one-parent merge commit that does not: the squash is the PR
 *   merge    two-parent merge commit: the PR is merge-base..second parent
 *   commit   no PR: the commit alone
 */

import { git, gitMaybe, parentsOf, logCommits, SHA } from "./git.js";
import type { GitHub, PullDetail } from "./github.js";
import type { Unit } from "./types.js";

export interface PrRange {
  kind: "rebase" | "squash" | "merge" | "commit";
  /** The snapshot the PR started from. */
  base: string;
  /** Commits replayed onto the base, oldest first; the last is the PR head. */
  replay: string[];
  /** Every local commit that belongs to the PR (for "did it write this line?"). */
  members: string[];
  head: string;
}

export type RangeResult = { range: PrRange; pull: PullDetail | null } | { skip: string };

async function commitRange(repo: string, sha: string): Promise<RangeResult> {
  const parents = await parentsOf(repo, sha);
  if (parents.length === 0) return { skip: "a root commit has no base to review against" };
  return { range: { kind: "commit", base: parents[0], replay: [sha], members: [sha], head: sha }, pull: null };
}

async function mergeCommitRange(repo: string, merge: string, parents: string[]): Promise<RangeResult> {
  const base = (await git(repo, ["merge-base", "--end-of-options", parents[0], parents[1]])).trim();
  const members = (await logCommits(repo, ["--reverse", "--topo-order", "--end-of-options", `${base}..${parents[1]}`]));
  if (members.length === 0) return { skip: `merge commit ${merge.slice(0, 9)} brought no commits` };
  // A branch that merged its base in has no straight line of its own to
  // replay; its whole change becomes one commit, the branch tip.
  const straight = members.every((c) => c.parents.length === 1);
  return {
    range: { kind: "merge", base, replay: straight ? members.map((c) => c.sha) : [parents[1]], members: members.map((c) => c.sha), head: parents[1] },
    pull: null,
  };
}

/** GitHub's commit lists stop at 250; at that size the count itself is suspect. */
export const GITHUB_COMMIT_CAP = 250;

async function linearRange(repo: string, merge: string, pull: PullDetail, github: GitHub): Promise<RangeResult> {
  const count = pull.commitCount;
  const tail = (await logCommits(repo, ["--first-parent", `-${count}`, "--end-of-options", merge])).reverse();
  // Rebased commits keep their messages; a squash keeps none of them. A
  // message or two reworded during the rebase does not make it a squash.
  const matched = tail.filter((c, i) => c.headline.trim() === pull.commits[i]?.headline.trim()).length;
  const rebased = tail.length === count && tail.every((c) => c.parents.length === 1) && (matched === count || (count > 2 && matched * 2 >= count));
  if (rebased && tail[0].parents.length === 1) {
    const shas = tail.map((c) => c.sha);
    // At the cap, the commit below the range must belong to another PR, or
    // the PR is longer than GitHub says and the base is wrong.
    if (count >= GITHUB_COMMIT_CAP && (await github.pullsForCommit(tail[0].parents[0])).some((p) => p.number === pull.number)) {
      return { skip: `PR #${pull.number} has more than the ${GITHUB_COMMIT_CAP} commits GitHub lists: its base is unknown` };
    }
    return { range: { kind: "rebase", base: tail[0].parents[0], replay: shas, members: shas, head: merge }, pull };
  }
  const [parent] = await parentsOf(repo, merge);
  return { range: { kind: "squash", base: parent, replay: [merge], members: [merge], head: merge }, pull };
}

export async function resolveRange(repo: string, unit: Unit, github: GitHub | null): Promise<RangeResult> {
  if (unit.kind === "commit") return commitRange(repo, unit.sha);
  if (!github) return { skip: `PR #${unit.number} needs GitHub to resolve (the candidates were mined with --github)` };
  const pull = await github.pull(unit.number);
  if (!pull.mergedAt || !pull.mergeCommitSha) return { skip: `PR #${unit.number} was not merged` };
  if (!SHA.test(pull.mergeCommitSha)) return { skip: `PR #${unit.number}: GitHub's merge commit ${JSON.stringify(pull.mergeCommitSha)} is not a commit id` };
  if (!Number.isInteger(pull.commitCount) || pull.commitCount < 1) return { skip: `PR #${unit.number}: GitHub gives no commit count` };
  const merge = pull.mergeCommitSha;
  if ((await gitMaybe(repo, ["cat-file", "-e", "--end-of-options", `${merge}^{commit}`])) === null) {
    return { skip: `PR #${unit.number}'s merge commit ${merge.slice(0, 9)} is not in this clone (fetch it)` };
  }
  if (pull.commits.length < pull.commitCount) {
    return { skip: `PR #${unit.number} has ${pull.commitCount} commits and GitHub lists only ${pull.commits.length}: its base is unknown` };
  }
  const parents = await parentsOf(repo, merge);
  if (parents.length > 2) return { skip: `PR #${unit.number} landed as an octopus merge` };
  const result = parents.length === 2 ? await mergeCommitRange(repo, merge, parents) : await linearRange(repo, merge, pull, github);
  return "range" in result ? { range: result.range, pull } : result;
}
