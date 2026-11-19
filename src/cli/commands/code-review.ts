/**
 * `agenteval code-review <mine|pick-clean|build>` — build a code-review
 * dataset from a repository's own history (docs/design/code-review.md).
 * Thin: parsing and printing here, the work in src/code-review/.
 */

import path from "node:path";
import { carryOver, DEFAULT_BLAME, DEFAULT_MAX_REMOVED_LINES, DEFAULT_MIN_OWNER_SHARE, mine } from "../../code-review/mine.js";
import { readMinedIfAny, writeMined } from "../../code-review/candidates-file.js";
import { ghClient, checkRepoName } from "../../code-review/github.js";
import { revParse, git } from "../../code-review/git.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { numberFlag, rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";

export const CODE_REVIEW_HELP = `agenteval code-review <mine|pick-clean|build> <repo-dir> [options]

  Build a code-review dataset from a repository's history: PRs that shipped
  a bug a later commit fixed (escaped), and PRs no fix traced a bug to
  (clean). Reads the repository; never writes to it.

  mine <repo-dir> --since DATE --out DIR
      SZZ over the branch's first-parent history: blame the lines each fix
      commit removed and name the commit that wrote them. Writes
      candidates.json and candidates.md; set "confirmed" in the JSON.
      --until DATE            end of the window (default: now)
      --branch NAME           branch to walk (default: the checked-out one)
      --github OWNER/REPO     map commits to PRs with gh (else one commit = one unit)
      --fix-pattern REGEX     also count subjects matching this (case-insensitive) as fixes
      --max-removed-lines N   drop fixes removing more lines of code (default ${DEFAULT_MAX_REMOVED_LINES})
      --min-owner-share F     drop fixes whose top introducer owns less (default ${DEFAULT_MIN_OWNER_SHARE})
      --no-move-detection     blame with -w only, not -w -M -C`;

const MINE_VALUED = ["since", "until", "branch", "out", "github", "fix-pattern", "max-removed-lines", "min-owner-share"] as const;
export const CODE_REVIEW_VALUED: readonly string[] = [...MINE_VALUED];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const v = stringFlag(flags, name);
  if (v !== undefined && !DATE.test(v)) throw new UsageError(`--${name} must be YYYY-MM-DD, got "${v}"`);
  return v;
}

function required(flags: ParsedArgs["flags"], name: string, why: string): string {
  const v = stringFlag(flags, name);
  if (v === undefined) throw new UsageError(`--${name} is required: ${why}`);
  return v;
}

async function repoArg(args: ParsedArgs): Promise<string> {
  const dir = args.positional[1];
  if (dir === undefined) throw new UsageError(`which repository? \`agenteval code-review ${args.positional[0]} <repo-dir> …\``);
  const abs = path.resolve(dir);
  await git(abs, ["rev-parse", "--git-dir"]).catch(() => {
    throw new UsageError(`${dir} is not a git repository`);
  });
  return abs;
}

async function branchOf(repo: string, given: string | undefined): Promise<{ branch: string; head: string }> {
  const current = await git(repo, ["symbolic-ref", "--short", "-q", "HEAD"]).then((s) => s.trim(), () => "");
  const branch = given ?? (current || "HEAD");
  const head = await revParse(repo, branch).catch(() => {
    throw new UsageError(`no branch ${branch} in ${repo}`);
  });
  return { branch, head };
}

async function cmdMine(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, [...MINE_VALUED, "no-move-detection"]);
  const repo = await repoArg(args);
  const since = dateFlag(args.flags, "since");
  if (since === undefined) throw new UsageError("--since YYYY-MM-DD is required: where the window of fix commits starts");
  const until = dateFlag(args.flags, "until") ?? null;
  const out = path.resolve(required(args.flags, "out", "the directory candidates.json goes to"));
  const githubName = stringFlag(args.flags, "github");
  const fixPattern = stringFlag(args.flags, "fix-pattern") ?? null;
  if (fixPattern !== null) {
    try {
      new RegExp(fixPattern, "i");
    } catch (err) {
      throw new UsageError(`--fix-pattern is not a regular expression: ${(err as Error).message}`);
    }
  }
  const maxRemovedLines = numberFlag(args.flags, "max-removed-lines") ?? DEFAULT_MAX_REMOVED_LINES;
  const minOwnerShare = numberFlag(args.flags, "min-owner-share") ?? DEFAULT_MIN_OWNER_SHARE;
  if (!(minOwnerShare > 0 && minOwnerShare <= 1)) throw new UsageError("--min-owner-share must be in (0, 1]");
  const { branch, head } = await branchOf(repo, stringFlag(args.flags, "branch"));
  const github = githubName ? ghClient(checkRepoNameOrUsage(githubName)) : null;

  const fresh = await mine({
    repo, branch, head, since, until, fixPattern, maxRemovedLines, minOwnerShare, github,
    blame: args.flags["no-move-detection"] ? ["-w"] : DEFAULT_BLAME,
    log: (line) => io.err(`${line}\n`),
  });
  const { mined, carried } = carryOver(fresh, await readMinedIfAny(out));
  await writeMined(out, mined);
  io.out(
    `${mined.scanned.fixes} fixes in ${mined.scanned.commits} commits → ${mined.candidates.length} candidates, ${mined.dropped.length} dropped` +
      `${carried > 0 ? ` (${carried} kept their marks from the earlier candidates.json)` : ""}\n` +
      `${path.join(out, "candidates.json")}\n${path.join(out, "candidates.md")}\n`,
  );
  return EXIT.ok;
}

function checkRepoNameOrUsage(name: string): string {
  try {
    return checkRepoName(name);
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

const SUBCOMMANDS: Record<string, (args: ParsedArgs, io: Io) => Promise<ExitCode>> = {
  mine: cmdMine,
};

export async function cmdCodeReview(args: ParsedArgs, io: Io): Promise<ExitCode> {
  const sub = args.positional[0];
  if (sub === undefined) throw new UsageError(`which step? \`agenteval code-review <${Object.keys(SUBCOMMANDS).join("|")}> …\``);
  const run = SUBCOMMANDS[sub];
  if (!run) throw new UsageError(`unknown code-review subcommand "${sub}" (known: ${Object.keys(SUBCOMMANDS).join(", ")})`);
  return run(args, io);
}
