/**
 * `agenteval run <task>` and `agenteval plan <task>`.
 *
 * One implementation, because they differ in exactly one thing: whether the
 * plan is confirmed. `plan` is `run` that stops after saying what it would
 * cost, and that has to stay literally true — a preview you cannot trust is
 * worse than no preview, since it is the only thing standing between a typo
 * and a bill.
 */

import { runSuite } from "../../core/execute.js";
import { planWorkflow } from "../../core/plan.js";
import { loadSuites } from "../../spec/load-spec.js";
import { findWorkspace, resolveSpecPath, workspaceAt } from "../../core/workspace.js";
import { consoleSink } from "../print.js";
import { jsonSink } from "../json.js";
import { EXIT, type ExitCode } from "../exit-codes.js";
import { numberFlag, rejectUnknown, stringFlag, UsageError, type ParsedArgs } from "../args.js";
import type { Io } from "../io.js";
import type { RunEvent } from "../../core/events.js";

const KNOWN = ["yes", "html", "json", "reuse", "concurrency", "workspace"];

export const RUN_HELP = `agenteval run <task> [options]

  Execute a task: generate, check, judge, score, choose.

  <task>              a task name (smoke-local), a directory, or a spec file

  --yes               actually execute. Without it, run only plans — the same
                      output as \`agenteval plan\`, and nothing is billed.
  --html              also write report.html
  --json              emit one JSON object per event on stdout, instead of lines
  --reuse             reuse a prior identical generation (matched on trial hash)
  --concurrency N     max LLM calls in flight; overrides the spec
  --workspace DIR     workspace to resolve <task> and write runs under

  Exits 0 when the run completed, 3 when it completed but the budget stopped
  it early or its durations are unreliable, 1 on failure, 2 on a usage error.`;

export const PLAN_HELP = `agenteval plan <task> [options]

  Say what a run would do, and do none of it. No key is needed and no call is
  made: the counts come from the spec alone.

  --json              print the plan as JSON
  --workspace DIR     workspace to resolve <task> under`;

async function resolve(args: ParsedArgs): Promise<string> {
  const target = args.positional[0];
  if (target === undefined) throw new UsageError("which task? (try `agenteval ls`)");
  const dir = stringFlag(args.flags, "workspace");
  const ws = dir ? workspaceAt(dir) : await findWorkspace();
  return resolveSpecPath(ws, target);
}

export async function cmdPlan(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, ["json", "workspace"]);
  const spec = await resolve(args);
  const suites = await loadSuites(spec);
  const plan = planWorkflow(suites, { reuse: process.env.EVAL_REUSE === "1" });
  if (args.flags.json) {
    io.out(`${JSON.stringify(plan, null, 2)}\n`);
    return EXIT.ok;
  }
  const emit = consoleSink((line) => io.out(`${line}\n`));
  for (const step of plan.steps) emit({ type: "step.planned", plan: step });
  if (plan.e2e) emit({ type: "workflow.planned", e2e: plan.e2e });
  emit({ type: "preview.only" });
  return EXIT.ok;
}

export async function cmdRun(args: ParsedArgs, io: Io): Promise<ExitCode> {
  rejectUnknown(args.flags, KNOWN);
  const spec = await resolve(args);

  const concurrency = numberFlag(args.flags, "concurrency");
  if (concurrency !== undefined) {
    if (concurrency < 1) throw new UsageError("--concurrency must be at least 1");
    process.env.EVAL_CONCURRENCY = String(Math.floor(concurrency));
  }
  if (args.flags.reuse) process.env.EVAL_REUSE = "1";

  // Watch for the two things that make a finished run less than a whole one.
  let partial = false;
  const watch = (e: RunEvent): void => {
    if (e.type === "budget.stopped" || e.type === "integrity.gaps") partial = true;
  };
  const write = (line: string): void => io.out(`${line}\n`);
  const render = args.flags.json ? jsonSink(write) : consoleSink(write);
  const onEvent = (e: RunEvent): void => {
    watch(e);
    render(e);
  };

  const report = await runSuite(spec, args.flags.html === true, { yes: args.flags.yes === true, onEvent });
  if (report === null && args.flags.yes !== true) return EXIT.ok; // planned, as asked
  return partial ? EXIT.partial : EXIT.ok;
}
