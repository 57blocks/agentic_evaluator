/**
 * `agenteval review <run>` — blind human review of a finished run, in the
 * dashboard (docs/design/human-review.md).
 *
 * Checks the task declares `evaluators.human` before serving anything, reuses
 * a dashboard already running on this workspace, or starts one, then opens
 * the review page. Not a daemon: when this process started the server, it
 * serves until Ctrl+C, like `agenteval dash`.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDemoServer, listenDemo } from "../../demo/server.js";
import { liveRunIndex } from "../../demo/catalog.js";
import { findWorkspace, workspaceAt, type Workspace } from "../../core/workspace.js";
import { loadReviewSession } from "../../core/review-service.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { numberFlag, rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";

const DEFAULT_PORT = 4173;

export const REVIEW_HELP = `agenteval review <run> [options]

  Review a finished run blind, in the dashboard: two candidates' answers to
  one input side by side, names hidden, a verdict per pair. The task needs an
  evaluators.human block (rubric_file, show, dimensions).

  <run>               a run id, or a path to a run directory
  --reviewer NAME     who is reviewing (default: git config user.name)
  --port N            dashboard port (default 4173; another if it is taken)
  --no-open           print the address instead of opening a browser
  --workspace DIR     workspace the run belongs to`;

function git(args: string[]): Promise<string> {
  return new Promise((resolve) => execFile("git", args, (err, out) => resolve(err ? "" : String(out).trim())));
}

/** --reviewer, then git's user.name, then the OS user: never empty. */
export async function resolveReviewer(flag: string | undefined): Promise<string> {
  if (flag && flag.trim()) return flag.trim();
  const fromGit = await git(["config", "user.name"]);
  return fromGit || os.userInfo().username || "reviewer";
}

export function reviewPageUrl(base: string, runId: string, reviewer: string): string {
  return `${base}/#run=${encodeURIComponent(runId)}&review=${encodeURIComponent(reviewer)}`;
}

async function resolveRun(ws: Workspace, target: string): Promise<{ id: string; dir: string }> {
  const index = await liveRunIndex({ ws });
  const asPath = path.resolve(target);
  const isDir = await fs.stat(asPath).then((s) => s.isDirectory(), () => false);
  const id = isDir ? path.basename(asPath) : target;
  const dir = index.get(id);
  if (!dir) throw new UsageError(`no run "${target}" in ${ws.root} (try \`agenteval ls\`)`);
  return { id, dir };
}

/** A dashboard already answering on this port for this run, or null. */
async function existingDashboard(port: number, runId: string, reviewer: string): Promise<string | null> {
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/api/review/${encodeURIComponent(runId)}?reviewer=${encodeURIComponent(reviewer)}`, { signal: AbortSignal.timeout(1500) });
    return res.ok ? base : null;
  } catch {
    return null;
  }
}

function openInBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  execFile(cmd, [url], () => undefined);
}

export async function cmdReview(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["reviewer", "port", "no-open", "workspace"]);
  const target = args.positional[0];
  if (target === undefined) throw new UsageError("which run? (try `agenteval ls`)");
  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();
  const run = await resolveRun(ws, target);
  const reviewer = await resolveReviewer(stringFlag(args.flags, "reviewer"));

  // Fail before serving: a task with no evaluators.human has nothing to review.
  const session = await loadReviewSession(run.dir, reviewer).catch((err: Error) => {
    throw new UsageError(err.message);
  });

  const port = numberFlag(args.flags, "port") ?? DEFAULT_PORT;
  const reused = await existingDashboard(port, run.id, reviewer);
  const server = reused ? null : createDemoServer(ws);
  const base = reused ?? (await listenDemo(server!, port).catch(() => listenDemo(server!, 0)));
  const url = reviewPageUrl(base, run.id, reviewer);

  io.out(`${session.pairs.length} pair(s) to review as ${reviewer}${session.hiddenFailed ? ` (${session.hiddenFailed} more where a side failed its check)` : ""}\n${url}\n`);
  if (args.flags["no-open"] !== true) openInBrowser(url);
  if (!server) return EXIT.ok;
  io.out("Serving the dashboard (Ctrl+C to stop)\n");
  await new Promise<void>((resolve) => server.once("close", resolve));
  return EXIT.ok;
}
