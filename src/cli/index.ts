#!/usr/bin/env node
/**
 * `agenteval` — the command line tool.
 *
 * A thin adapter over `src/core/`: it resolves what the user typed, decides
 * who is watching, and turns an outcome into an exit code. No evaluation
 * logic lives here, which is what lets the dashboard drive the same core
 * without reimplementing any of it.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { INSTALL_ROOT } from "../paths.js";
import { EXIT, type ExitCode } from "./exit-codes.js";
import { parseArgs, UsageError, type ParsedArgs } from "./args.js";
import { processIo, type Io } from "./io.js";
import { NoSuchSpecError } from "../core/workspace.js";
import { cmdPlan, cmdRun, PLAN_HELP, RUN_HELP } from "./commands/run.js";
import { cmdLs, LS_HELP } from "./commands/ls.js";
import { cmdInit, INIT_HELP } from "./commands/init.js";
import { cmdModels, MODELS_HELP } from "./commands/models.js";
import { cmdReport, REPORT_HELP } from "./commands/report.js";
import { cmdDash, DASH_HELP } from "./commands/dash.js";

interface Command {
  summary: string;
  help: string;
  /** Flags that take a value, so `--workspace dir` parses as one flag. */
  valued?: readonly string[];
  run: (args: ParsedArgs, io: Io) => Promise<ExitCode>;
}

const VALUED = ["workspace", "concurrency", "port"] as const;

export const COMMANDS: Record<string, Command> = {
  plan: { summary: "say what a run would cost, and do none of it", help: PLAN_HELP, valued: VALUED, run: cmdPlan },
  run: { summary: "execute a task", help: RUN_HELP, valued: VALUED, run: cmdRun },
  ls: { summary: "list the workspace's tasks and their runs", help: LS_HELP, valued: VALUED, run: cmdLs },
  init: { summary: "create a runnable task to edit", help: INIT_HELP, valued: VALUED, run: cmdInit },
  models: { summary: "are this task's models reachable from here, and at what price", help: MODELS_HELP, valued: VALUED, run: cmdModels },
  report: { summary: "re-render a run's report.html", help: REPORT_HELP, valued: VALUED, run: cmdReport },
  dash: { summary: "serve the dashboard", help: DASH_HELP, valued: VALUED, run: cmdDash },
};

function usage(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((c) => c.length));
  const lines = Object.entries(COMMANDS).map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}`);
  return [
    "agenteval <command> [options]",
    "",
    "Model and workflow evaluation: run a task, read what it proved, and see",
    "what it could not observe. Evidence is written beside the task that",
    "produced it.",
    "",
    ...lines,
    "",
    "  agenteval <command> --help    for one command's options",
    "  agenteval --version",
    "",
    "Exit codes: 0 done · 1 failed · 2 usage · 3 completed but partial.",
  ].join("\n");
}

async function version(): Promise<string> {
  const pkg = JSON.parse(await fs.readFile(path.join(INSTALL_ROOT, "package.json"), "utf-8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

export async function main(argv: readonly string[], io: Io = processIo): Promise<ExitCode> {
  // `pnpm run agenteval -- ls` puts a bare `--` in front. The old entry point
  // required that separator, so the habit is real; treating it as a command
  // name would answer a correct invocation with "unknown command --".
  const [name, ...rest] = argv[0] === "--" ? argv.slice(1) : argv;

  if (name === undefined || name === "--help" || name === "-h" || name === "help") {
    io.out(`${usage()}\n`);
    return name === undefined ? EXIT.usage : EXIT.ok;
  }
  if (name === "--version" || name === "-v") {
    io.out(`${await version()}\n`);
    return EXIT.ok;
  }

  const command = COMMANDS[name];
  if (!command) {
    io.err(`unknown command "${name}"\n\n${usage()}\n`);
    return EXIT.usage;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    io.out(`${command.help}\n`);
    return EXIT.ok;
  }

  return command.run(parseArgs(rest, { valued: command.valued }), io);
}

/**
 * Entry point for both launch paths: `bin/agenteval.mjs` (installed) and
 * `tsx src/cli/index.ts` (in this checkout). Sets the exit code rather than
 * calling `process.exit`, so buffered stdout is not truncated on the way out.
 */
export async function cli(argv: readonly string[] = process.argv.slice(2), io: Io = processIo): Promise<void> {
  const { loadEnvLocal } = await import("../run.js");
  await loadEnvLocal();
  try {
    process.exitCode = await main(argv, io);
  } catch (err: unknown) {
    if (err instanceof UsageError || err instanceof NoSuchSpecError) {
      io.err(`${err.message}\n`);
      process.exitCode = EXIT.usage;
      return;
    }
    io.err(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = EXIT.failed;
  }
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (invokedDirectly) await cli();
