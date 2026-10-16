/**
 * `agenteval combine <task> <run> <run>...` — one run's answer from several:
 * the first run, then the re-grades and partial re-runs that fixed parts of
 * it. Generates and judges nothing (src/core/combine.ts).
 */

import { combineRuns } from "../../core/combine.js";
import { displayPath } from "../../paths.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { rejectUnknown, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import { resolveTask } from "./run.js";

export const COMBINE_HELP = `agenteval combine <task> <run> <run> [<run>...] [options]

  Build one run from several of the same task: each step's trials come from
  the latest of the given runs that has them (later runs supersede earlier
  ones, per candidate, input and trial), and the rates, recommendation, ledger
  and reports are worked out again. Nothing is generated or judged.

  Typical: the full run, then \`run --reuse --step code\` (a re-grade after a
  check fix), then \`run --step code --candidate a,b\` (a re-run after a fix
  that concerned only them) — combine all three, oldest first.

  --html              also write report.html
  --workspace DIR     workspace to resolve <task> under`;

export async function cmdCombine(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["html", "workspace"]);
  const runs = args.positional.slice(1);
  if (runs.length < 2) throw new UsageError("name at least two runs to combine, oldest first (try `agenteval ls`)");
  const spec = await resolveTask(args);
  const result = await combineRuns(spec, runs, { html: args.flags.html === true });
  for (const s of result.steps) io.out(`  ${s.id}: ${s.chosen ?? "no recommendation"}  (from ${s.sources.join(", ")})\n`);
  io.out(`✔ ${displayPath(result.dir)}\n`);
  return EXIT.ok;
}
