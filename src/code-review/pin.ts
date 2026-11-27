/**
 * Pinned files (`code-review build --pin-files REV PATH...`): paths taken
 * from one commit and laid over every tree of every fixture, the base
 * snapshot and each PR commit alike. A reviewer that reads repo-resident
 * rules (CLAUDE.md, CONTRIBUTING.md, review guides) then reads the same
 * rules on every item, and the PR's diff is unchanged unless the PR itself
 * edited a pinned path (build reports those).
 *
 * A pinned path is made exactly what it is at the pinned commit: entries the
 * tree had under it are removed first, so a file the pin no longer has does
 * not linger in older trees. Trees are rebuilt in the fixture's scratch
 * store, never in the clone.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { assertNotOption, git, GitError } from "./git.js";

export interface Pin {
  /** The pinned commit, full id. */
  commit: string;
  /** Repository-relative paths (files or directories), no trailing slash. */
  paths: string[];
  /** `ls-tree -r -z` of the paths at the commit: what every tree gets. */
  entries: string;
}

/** Path arguments are literal: `*` in a name is a `*`. */
const LITERAL = { GIT_LITERAL_PATHSPECS: "1" };

function checkPath(raw: string): string {
  const p = raw.replace(/\/+$/, "");
  const parts = p.split("/");
  if (p === "" || p.startsWith("/") || parts.some((s) => s === "" || s === "." || s === "..")) {
    throw new GitError(`pinned path ${JSON.stringify(raw)} must be a relative path inside the repository`);
  }
  return p;
}

/** Resolve `rev` to a commit and check every path is in it. Throws GitError with a reason. */
export async function resolvePin(repo: string, rev: string, rawPaths: readonly string[]): Promise<Pin> {
  assertNotOption(rev, "--pin-files revision");
  if (rawPaths.length === 0) throw new GitError("--pin-files needs at least one path after the revision");
  const paths = [...new Set(rawPaths.map(checkPath))];
  const commit = await git(repo, ["rev-parse", "--verify", "-q", "--end-of-options", `${rev}^{commit}`]).then((s) => s.trim(), () => {
    throw new GitError(`no commit ${rev} in ${repo}`);
  });
  for (const p of paths) {
    const found = await git(repo, ["ls-tree", "-z", "--name-only", "--full-tree", commit, "--", p], { env: LITERAL });
    if (found === "") throw new GitError(`${p} is not in ${commit.slice(0, 9)}`);
  }
  const entries = await git(repo, ["ls-tree", "-r", "-z", "--full-tree", commit, "--", ...paths], { env: LITERAL });
  return { commit, paths, entries };
}

/** Is `file` a pinned path or under one? */
export function isPinned(file: string, pin: Pick<Pin, "paths">): boolean {
  return pin.paths.some((p) => file === p || file.startsWith(`${p}/`));
}

/**
 * `tree` with the pinned paths replaced by the pin's, written into `store`
 * (whose objects borrow the clone's). Deterministic: the same tree and pin
 * give the same tree id.
 */
export async function overlayTree(store: string, tree: string, pin: Pin, env: Record<string, string>): Promise<string> {
  const index = path.join(store, "pin.index");
  await fs.rm(index, { force: true });
  const e = { ...env, ...LITERAL, GIT_INDEX_FILE: index };
  try {
    await git(store, ["read-tree", "--end-of-options", tree], { env: e });
    const stale = (await git(store, ["ls-tree", "-r", "-z", "--name-only", "--full-tree", tree, "--", ...pin.paths], { env: e })).split("\0").filter((p) => p !== "");
    const zero = "0".repeat(tree.length);
    const removals = stale.map((p) => `0 ${zero}\t${p}\0`).join("");
    await git(store, ["update-index", "-z", "--index-info"], { env: e, input: removals + pin.entries });
    return (await git(store, ["write-tree"], { env: e })).trim();
  } finally {
    await fs.rm(index, { force: true });
  }
}
