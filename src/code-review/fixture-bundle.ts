/**
 * A PR as a standalone repository: one root commit holding the PR's base
 * snapshot, then the PR's own commits replayed on it, and nothing after the
 * PR head, so a reviewer cannot reach the fix. Written as a git bundle.
 *
 * Byte-deterministic: agenteval hashes fixtures into trial identity, and a
 * rebuild that differs by one byte re-runs (and re-bills) every trial.
 *   - commits are recreated with their original author, committer, dates and
 *     message bytes, so their ids are fixed by their content;
 *   - the pack is computed afresh (no delta or object reuse from whatever
 *     packs the source clone happens to have), single-threaded, with every
 *     packing knob pinned and no user or system git config;
 *   - the bundle header is written here, not by `git bundle`.
 * The new objects go to a scratch object store that borrows the clone's
 * objects through `alternates`; nothing is written into the clone.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { git, gitBytes } from "./git.js";

/** No user or system config: their pack and commit settings would change bytes. */
const CLEAN_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const PACK_CONFIG = [
  "-c", "pack.threads=1", "-c", "pack.compression=9", "-c", "core.compression=9", "-c", "pack.window=10",
  "-c", "pack.depth=50", "-c", "pack.windowMemory=0", "-c", "pack.useBitmaps=false", "-c", "pack.useSparse=false",
  "-c", "core.bigFileThreshold=512m",
];

export interface BundleResult {
  baseSha: string;
  headSha: string;
  /** The replayed commits' new ids, oldest first (the base excluded). */
  commitShas: string[];
}

interface RawCommit {
  author: string;
  committer: string;
  message: Buffer;
}

/** `author Name <mail> 1700000000 +0100` → name, mail, date. */
function identity(line: string, who: "AUTHOR" | "COMMITTER"): Record<string, string> {
  const m = /^(?:author|committer) (.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(line);
  if (!m) throw new Error(`cannot read ${who.toLowerCase()} line: ${line}`);
  return { [`GIT_${who}_NAME`]: m[1], [`GIT_${who}_EMAIL`]: m[2], [`GIT_${who}_DATE`]: `@${m[3]} ${m[4]}` };
}

async function rawCommit(repo: string, sha: string): Promise<RawCommit> {
  const bytes = await gitBytes(repo, ["cat-file", "commit", sha]);
  const split = bytes.indexOf("\n\n");
  const headers = bytes.subarray(0, split).toString("utf-8").split("\n");
  const author = headers.find((h) => h.startsWith("author "));
  const committer = headers.find((h) => h.startsWith("committer "));
  if (!author || !committer) throw new Error(`commit ${sha} has no author or committer`);
  return { author, committer, message: split === -1 ? Buffer.alloc(0) : bytes.subarray(split + 2) };
}

async function recommit(store: string, source: string, sha: string, parent: string | null): Promise<string> {
  const raw = await rawCommit(source, sha);
  const tree = (await git(source, ["rev-parse", `${sha}^{tree}`])).trim();
  const env = { ...CLEAN_ENV, ...identity(raw.author, "AUTHOR"), ...identity(raw.committer, "COMMITTER") };
  const args = ["commit-tree", "--no-gpg-sign", tree, ...(parent ? ["-p", parent] : [])];
  return (await git(store, args, { env, input: raw.message })).trim();
}

async function objectsDir(repo: string): Promise<string> {
  const common = (await git(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
  return path.join(common, "objects");
}

/** The pack of everything reachable from `head`, computed from scratch. */
function packFrom(store: string, head: string): Promise<Buffer> {
  return gitBytes(store, [
    ...PACK_CONFIG, "pack-objects", "--stdout", "--revs", "-q", "--threads=1", "--window=10", "--depth=50",
    "--no-reuse-delta", "--no-reuse-object", "--delta-base-offset",
  ], { env: CLEAN_ENV, input: `${head}\n` });
}

/**
 * Write `<outFile>` (a v2 bundle with one ref) holding `base`'s snapshot as
 * a root commit and `replay` on top of it.
 */
export async function writeBundle(source: string, base: string, replay: readonly string[], ref: string, outFile: string): Promise<BundleResult> {
  const store = await fs.mkdtemp(path.join(os.tmpdir(), "cr-fixture-"));
  try {
    await git(store, ["init", "-q", "--bare", "."], { env: CLEAN_ENV });
    await fs.writeFile(path.join(store, "objects", "info", "alternates"), `${await objectsDir(source)}\n`);
    const baseSha = await recommit(store, source, base, null);
    const commitShas: string[] = [];
    let head = baseSha;
    for (const sha of replay) {
      head = await recommit(store, source, sha, head);
      commitShas.push(head);
    }
    const pack = await packFrom(store, head);
    const header = Buffer.from(`# v2 git bundle\n${head} ${ref}\n\n`, "utf-8");
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, Buffer.concat([header, pack]));
    return { baseSha, headSha: head, commitShas };
  } finally {
    await fs.rm(store, { recursive: true, force: true });
  }
}
