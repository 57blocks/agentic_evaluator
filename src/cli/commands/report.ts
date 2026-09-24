/**
 * `agenteval report <run>` — re-render a finished run's page.
 *
 * Reads only. Re-rendering never re-derives a number: the canonical rows are
 * on disk and this turns them into HTML again, which is what makes it safe to
 * run against a run that cost real money.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { writeRunReport } from "../../report-v2.js";
import { writeWorkflowReport } from "../../report-workflow.js";
import { findWorkspace, listRunDirs, workspaceAt } from "../../core/workspace.js";
import { displayPath } from "../../paths.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";

export const REPORT_HELP = `agenteval report <run> [options]

  Re-render report.html for a finished run. Reads only — no number changes.

  <run>               a run id, or a path to a run directory
  --workspace DIR     workspace to look the run id up in`;

const exists = (p: string): Promise<boolean> => fs.stat(p).then(() => true, () => false);

/** A workflow run's step directories: the subdirectories holding a step manifest. */
async function stepRunDirs(runDir: string): Promise<string[]> {
  const entries = await fs.readdir(runDir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(runDir, e.name));
  const isStep = await Promise.all(dirs.map((d) => exists(path.join(d, "manifest.json"))));
  return dirs.filter((_, i) => isStep[i]);
}

export async function cmdReport(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["workspace"]);
  const target = args.positional[0];
  if (target === undefined) throw new UsageError("which run? (try `agenteval ls`)");

  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();

  const asPath = path.resolve(target);
  const isDir = await fs.stat(asPath).then((s) => s.isDirectory()).catch(() => false);
  const runDir = isDir ? asPath : (await listRunDirs(ws)).find((e) => e.name === target)?.dir;
  if (runDir === undefined) throw new UsageError(`no run "${target}" in ${ws.root}`);

  // A workflow run carries workflow.json at its root; a single-step run does not.
  const isWorkflow = await exists(path.join(runDir, "workflow.json"));
  if (isWorkflow) {
    // Each step's page first: the workflow page links to them, and a step
    // page left stale would still speak the old wording.
    for (const step of await stepRunDirs(runDir)) await writeRunReport(step);
    await writeWorkflowReport(runDir);
  } else {
    await writeRunReport(runDir);
  }

  io.out(`✔ ${displayPath(path.join(runDir, "report.html"))}\n`);
  return EXIT.ok;
}
