/**
 * `agenteval ls` — what this workspace holds.
 *
 * Tasks first, with their runs and what those runs spent. A task that has
 * never run is still listed: "no runs yet" is information, and the moment a
 * listing hides it, the absence of evidence starts looking like evidence.
 */

import fs from "node:fs/promises";
import { listTasks } from "../../demo/catalog.js";
import { findWorkspace, tasksDir, workspaceAt } from "../../core/workspace.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, stringFlag, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";

export const LS_HELP = `agenteval ls [options]

  List the workspace's tasks, their runs, and what those runs spent.

  --json              print the listing as JSON
  --workspace DIR     workspace to list`;

const NO_TASKS = "no tasks yet (a task is a directory under tasks/ with a spec.yaml)\n  agenteval init <name>    creates one\n";

/** Id prefix of the sample runs shipped with agenteval (see src/demo/catalog.ts). */
const SAMPLE_PREFIX = "fixture:";

function money(n: number | null): string {
  return n === null ? "     —" : `$${n.toFixed(4)}`;
}

export async function cmdLs(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["json", "workspace"]);
  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();
  const hasTasksDir = await fs.stat(tasksDir(ws)).then((st) => st.isDirectory(), () => false);
  if (!hasTasksDir && !args.flags.json) {
    io.out(`workspace ${ws.root}\n\n${NO_TASKS}`);
    return EXIT.ok;
  }
  const listed = hasTasksDir ? await listTasks({ ws }) : { tasks: [], unfiled: [], broken: [] };
  const { tasks, broken } = listed;
  // Runs this workspace holds outside any task — not the sample runs that ship
  // with agenteval, which the dashboard shows as samples and which a user
  // never made.
  const unfiled = listed.unfiled.filter((r) => !r.id.startsWith(SAMPLE_PREFIX));

  if (args.flags.json) {
    io.out(`${JSON.stringify({ workspace: ws.root, tasks, unfiled, broken }, null, 2)}\n`);
    return EXIT.ok;
  }

  io.out(`workspace ${ws.root}\n\n`);
  if (tasks.length === 0 && broken.length === 0) {
    io.out(NO_TASKS);
    return EXIT.ok;
  }
  const width = Math.max(0, ...tasks.map((t) => t.name.length));
  for (const t of tasks) {
    const budget = t.budgetUsd === null ? "no budget" : `budget $${t.budgetUsd}`;
    const runs = t.runs.length === 0 ? "never run" : `${t.runs.length} run(s), spent ${money(t.spentUsd)}`;
    io.out(`  ${t.name.padEnd(width)}  ${budget.padEnd(12)}  ${runs}\n`);
    const latest = t.runs[0];
    if (latest) {
      const picks = latest.steps?.map((s) => `${s.id}:${s.chosen ?? "none"}`).join(", ") ?? "";
      io.out(`  ${" ".repeat(width)}  latest ${latest.id}${picks ? ` — ${picks}` : ""}\n`);
    }
  }
  if (broken.length > 0) {
    io.out(`\n  ${broken.length} task(s) could not be read — fix the spec to list them:\n`);
    for (const b of broken) io.out(`  ✖ ${b.path}\n      ${b.error}\n`);
  }
  if (unfiled.length > 0) {
    io.out(`\n  ${unfiled.length} run(s) belong to no task (in the workspace's top-level runs/)\n`);
  }
  return EXIT.ok;
}
