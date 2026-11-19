/**
 * `agenteval code-review <mine|pick-clean|build>` — build a code-review
 * dataset from a repository's own history (docs/design/code-review.md).
 * Thin: parsing and printing here, the work in src/code-review/.
 */

import path from "node:path";
import { carryOver, DEFAULT_BLAME, DEFAULT_MAX_REMOVED_LINES, DEFAULT_MIN_OWNER_SHARE, mine } from "../../code-review/mine.js";
import { CandidatesError, CLEAN_JSON, readClean, readMined, readMinedIfAny, toJson, writeMined } from "../../code-review/candidates-file.js";
import { DEFAULT_SEED, pickClean } from "../../code-review/pick-clean.js";
import { build, BUILD_REPORT, writeBuild } from "../../code-review/build.js";
import type { MinedFile } from "../../code-review/types.js";
import fs from "node:fs/promises";
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
      --no-move-detection     blame with -w only, not -w -M -C

  pick-clean <repo-dir> --mined DIR --count N --out DIR
      Merged PRs (or commits) in the mined window that no scanned fix
      blamed, minus bots and housekeeping, drawn with a fixed seed and
      size-matched by changed lines to the confirmed escaped PRs. Writes
      clean.json.
      --seed N                default ${DEFAULT_SEED}; recorded in clean.json
      --since/--until DATE    another window than the mined one

  build <repo-dir> --mined DIR [--clean DIR] --task DIR
      One item per PR in <task>/items.jsonl and fixtures/<id>/ (repo.bundle
      ending at the PR head, pr.json). Only candidates with
      "confirmed": true go in; defect lines are PR-head line numbers.
      Writes ${BUILD_REPORT} beside items.jsonl: what was skipped and why.
      --include-unconfirmed   also unreviewed candidates (not those marked
                              false or pre-screened not_defect); their
                              provenance says so`;

const MINE_VALUED = ["since", "until", "branch", "out", "github", "fix-pattern", "max-removed-lines", "min-owner-share"] as const;
const PICK_VALUED = ["mined", "count", "out", "seed", "since", "until"] as const;
const BUILD_VALUED = ["mined", "clean", "task"] as const;
export const CODE_REVIEW_VALUED: readonly string[] = [...new Set([...MINE_VALUED, ...PICK_VALUED, ...BUILD_VALUED])];

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

async function minedArg(args: ParsedArgs): Promise<MinedFile> {
  const dir = required(args.flags, "mined", "the directory `code-review mine` wrote candidates.json to");
  try {
    return await readMined(path.resolve(dir));
  } catch (err) {
    if (err instanceof CandidatesError) throw new UsageError(err.message);
    throw err;
  }
}

function githubOf(mined: MinedFile) {
  return mined.repo.github ? ghClient(mined.repo.github) : null;
}

async function cmdPickClean(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, [...PICK_VALUED]);
  const repo = await repoArg(args);
  const mined = await minedArg(args);
  const count = numberFlag(args.flags, "count");
  if (count === undefined || !Number.isInteger(count) || count < 1) throw new UsageError("--count N is required: how many clean PRs to pick (a whole number, 1 or more)");
  const seed = numberFlag(args.flags, "seed") ?? DEFAULT_SEED;
  if (!Number.isInteger(seed)) throw new UsageError("--seed must be a whole number");
  const out = path.resolve(required(args.flags, "out", "the directory clean.json goes to"));
  const clean = await pickClean({
    repo, mined, count, seed,
    since: dateFlag(args.flags, "since") ?? mined.window.since,
    until: dateFlag(args.flags, "until") ?? mined.window.until,
    github: githubOf(mined),
    log: (line) => io.err(`${line}\n`),
  });
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, CLEAN_JSON), toJson(clean));
  const bins = clean.bins.filter((b) => b.want > 0).map((b) => `${b.lo}${b.hi ? `-${b.hi}` : "+"}: ${b.got}/${b.want}`).join(", ");
  io.out(`${clean.picked.length} of ${count} clean picked (seed ${seed}; matched to ${clean.matched_to}; ${bins}), ${clean.rejected.length} rejected\n${path.join(out, CLEAN_JSON)}\n`);
  return clean.picked.length < count ? EXIT.partial : EXIT.ok;
}

async function cmdBuild(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, [...BUILD_VALUED, "include-unconfirmed"]);
  const repo = await repoArg(args);
  const mined = await minedArg(args);
  const cleanDir = stringFlag(args.flags, "clean");
  const clean = cleanDir ? await readClean(path.resolve(cleanDir)).catch((err: unknown) => {
    throw err instanceof CandidatesError ? new UsageError(err.message) : err;
  }) : null;
  const taskDir = path.resolve(required(args.flags, "task", "the task directory items.jsonl and fixtures/ go to"));
  const { items, report } = await build({
    repo, mined, clean, taskDir, github: githubOf(mined),
    includeUnconfirmed: args.flags["include-unconfirmed"] === true,
    log: (line) => io.err(`${line}\n`),
  });
  await writeBuild(taskDir, items, report);
  const escaped = items.filter((i) => i.expected.kind === "defect").length;
  const lines = [
    `${items.length} items (${escaped} escaped, ${items.length - escaped} clean) → ${path.join(taskDir, "items.jsonl")}`,
    `${report.excluded.length} candidates not selected, ${report.skipped.length} skipped, ${report.unlocated.length} defect files without lines → ${path.join(taskDir, BUILD_REPORT)}`,
    ...report.skipped.map((s) => `  skipped ${s.id}: ${s.reason}`),
    ...report.unlocated.map((u) => `  no lines for ${u.candidate} in ${u.file}: ${u.note}`),
    ...(report.stale_fixtures.length > 0 ? [`  fixtures/ also holds ${report.stale_fixtures.join(", ")}, not built this time`] : []),
  ];
  if (items.length === 0 && report.excluded.length > 0 && !args.flags["include-unconfirmed"]) {
    lines.push('Nothing is confirmed yet: set "confirmed": true in candidates.json, or pass --include-unconfirmed.');
  }
  io.out(`${lines.join("\n")}\n`);
  return EXIT.ok;
}

const SUBCOMMANDS: Record<string, (args: ParsedArgs, io: Io) => Promise<ExitCode>> = {
  mine: cmdMine,
  "pick-clean": cmdPickClean,
  build: cmdBuild,
};

export async function cmdCodeReview(args: ParsedArgs, io: Io): Promise<ExitCode> {
  const sub = args.positional[0];
  if (sub === undefined) throw new UsageError(`which step? \`agenteval code-review <${Object.keys(SUBCOMMANDS).join("|")}> …\``);
  const run = SUBCOMMANDS[sub];
  if (!run) throw new UsageError(`unknown code-review subcommand "${sub}" (known: ${Object.keys(SUBCOMMANDS).join(", ")})`);
  return run(args, io);
}
