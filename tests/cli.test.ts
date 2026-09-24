/**
 * The command line's contract: what each command does, and what it says on
 * the way out.
 *
 * Exit codes get their own assertions because they are the only thing a
 * script can read. A command that fails quietly with 0 is worse than one that
 * crashes — the crash gets noticed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { INSTALL_ROOT } from "../src/paths.js";
import { EXIT } from "../src/cli/exit-codes.js";
import { parseArgs, rejectUnknown, UsageError } from "../src/cli/args.js";
import { bufferIo } from "../src/cli/io.js";
import { COMMANDS, main } from "../src/cli/index.js";

/** Run a command with its output captured rather than printed. */
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const io = bufferIo();
  const code = await main(argv, io);
  return { code, out: io.stdout, err: io.stderr };
}

async function tempWorkspace(): Promise<string> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "eval-cli-"));
  await fs.mkdir(path.join(ws, "tasks"), { recursive: true });
  return ws;
}

test("--help lists every command, and each command documents its own flags", async () => {
  // Act
  const top = await run(["--help"]);

  // Assert
  assert.equal(top.code, EXIT.ok);
  for (const name of Object.keys(COMMANDS)) {
    assert.match(top.out, new RegExp(`\\b${name}\\b`), `${name} missing from the top-level help`);
    const one = await run([name, "--help"]);
    assert.equal(one.code, EXIT.ok);
    assert.match(one.out, new RegExp(`^agenteval ${name}`), `${name} --help does not describe itself`);
  }
});

test("no command at all is a usage error, not a silent success", async () => {
  const r = await run([]);
  assert.equal(r.code, EXIT.usage);
});

test("an unknown command exits 2 and says what is available", async () => {
  const r = await run(["frobnicate"]);
  assert.equal(r.code, EXIT.usage);
  assert.match(r.err, /unknown command "frobnicate"/);
  assert.match(r.err, /\bplan\b/);
});

test("a leading -- separator is skipped, not read as a command", async () => {
  // Arrange - `pnpm run agenteval -- ls` passes it through, and the entry
  // point this replaced required it, so people type it from habit.

  // Act
  const r = await run(["--", "ls", "--workspace", INSTALL_ROOT]);

  // Assert
  assert.equal(r.code, EXIT.ok);
  assert.match(r.out, /^workspace /);
});

test("--version prints the harness version", async () => {
  const r = await run(["--version"]);
  assert.equal(r.code, EXIT.ok);
  assert.match(r.out.trim(), /^\d+\.\d+\.\d+/);
});

test("a mistyped flag is refused rather than quietly ignored", () => {
  // Arrange - the exact failure this guards: --yess previews instead of running.
  const args = parseArgs(["--yess"]);

  // Act + Assert
  assert.throws(() => rejectUnknown(args.flags, ["yes"]), UsageError);
});

test("plan counts the calls and makes none; run without --yes does the same", async () => {
  // Act
  const planned = await run(["plan", "smoke-local"]);
  const unconfirmed = await run(["run", "smoke-local"]);

  // Assert - both stop at the preview, and both exit 0.
  assert.equal(planned.code, EXIT.ok);
  assert.equal(unconfirmed.code, EXIT.ok);
  assert.match(planned.out, /generations 2 · pairwise off · absolute off/);
  assert.match(unconfirmed.out, /Preview only/);
});

test("plan --json is a document a script can read", async () => {
  const r = await run(["plan", "smoke-local", "--json"]);
  assert.equal(r.code, EXIT.ok);
  const plan = JSON.parse(r.out) as { steps: Array<{ generations: number; judgeCalls: number }>; e2e: unknown };
  assert.equal(plan.steps[0].generations, 2);
  assert.equal(plan.steps[0].judgeCalls, 0);
  assert.equal(plan.e2e, null);
});

test("run --json emits one event per line and omits the legacy markdown", async () => {
  // Arrange
  const ws = await tempWorkspace();
  await fs.cp(path.join(INSTALL_ROOT, "tasks", "smoke-local"), path.join(ws, "tasks", "smoke-local"), {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });

  // Act
  const r = await run(["run", "smoke-local", "--yes", "--json", "--workspace", ws]);

  // Assert
  assert.equal(r.code, EXIT.ok);
  const events = r.out.trim().split("\n").map((l) => JSON.parse(l) as { type: string; markdown?: string });
  assert.ok(events.every((e) => typeof e.type === "string"), "every line is an event");
  const done = events.find((e) => e.type === "step.done") as { markdown?: string; chosen?: string };
  assert.equal(done.markdown, undefined, "the legacy markdown does not belong in the machine stream");
  assert.equal(done.chosen, "fake-pass");

  await fs.rm(ws, { recursive: true, force: true });
});

test("init creates a task that runs offline, immediately", async () => {
  // Arrange
  const ws = await tempWorkspace();

  // Act
  const created = await run(["init", "my-task", "--workspace", ws]);
  const ran = await run(["run", "my-task", "--yes", "--workspace", ws]);

  // Assert - the scaffold is runnable, not a template with holes.
  assert.equal(created.code, EXIT.ok);
  assert.equal(ran.code, EXIT.ok);
  assert.match(ran.out, /recommend baseline/);

  // Assert - and it landed in the workspace it was told to use.
  const runs = await fs.readdir(path.join(ws, "tasks", "my-task", "runs"));
  assert.equal(runs.length, 1);

  await fs.rm(ws, { recursive: true, force: true });
});

test("init --models creates a small real evaluation: two models, a tsc gate and a judge", async () => {
  // Arrange
  const ws = await tempWorkspace();

  // Act
  const created = await run(["init", "real", "--models", "--workspace", ws]);
  const plan = await run(["plan", "real", "--json", "--workspace", ws]);

  // Assert - it loads (the judge's vendor differs from every candidate's, or
  // the loader would refuse it) and plans what its header promises, for free.
  assert.equal(created.code, EXIT.ok);
  assert.equal(plan.code, EXIT.ok, plan.err);
  const { steps } = JSON.parse(plan.out) as { steps: Array<{ generations: number; judgeCalls: number; budgetUsd: number }> };
  assert.equal(steps[0].generations, 2);
  assert.equal(steps[0].judgeCalls, 2, "one pair, judged in both orders");
  assert.equal(steps[0].budgetUsd, 0.05);
  // Models, not stand-ins: there is no agent script to run.
  await assert.rejects(fs.access(path.join(ws, "tasks", "real", "agents")));

  await fs.rm(ws, { recursive: true, force: true });
});

test("init refuses a name that is not a task name, and refuses to overwrite", async () => {
  // Arrange
  const ws = await tempWorkspace();
  await run(["init", "taken", "--workspace", ws]);

  // Act + Assert
  await assert.rejects(main(["init", "../escape", "--workspace", ws], bufferIo()), UsageError);
  await assert.rejects(main(["init", "taken", "--workspace", ws], bufferIo()), /already exists/);

  await fs.rm(ws, { recursive: true, force: true });
});

test("ls reports an empty workspace as empty rather than as nothing", async () => {
  // Arrange
  const ws = await tempWorkspace();

  // Act
  const r = await run(["ls", "--workspace", ws]);

  // Assert
  assert.equal(r.code, EXIT.ok);
  assert.match(r.out, /no tasks/);

  await fs.rm(ws, { recursive: true, force: true });
});

test("init's stand-in agents run cleanly, each writing its file and exiting 0", async () => {
  // Arrange
  const ws = await tempWorkspace();
  await run(["init", "demo", "--workspace", ws]);
  const task = path.join(ws, "tasks", "demo");
  const { execFileSync } = await import("node:child_process");

  for (const extra of [[], ["--mode", "fail"]]) {
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-init-agent-"));

    // Act - execFileSync throws on a non-zero exit, e.g. a ReferenceError.
    const out = execFileSync(process.execPath, [path.join(task, "agents", "example.mjs"), ...extra], { cwd: workDir, encoding: "utf-8" });

    // Assert
    assert.match(await fs.readFile(path.join(workDir, "add.ts"), "utf-8"), /export function add/);
    assert.match(out, extra.length ? /deliberate type error/ : /ok/);
  }

  await fs.rm(ws, { recursive: true, force: true });
});

test("report re-renders a finished run without touching its numbers", async () => {
  // Arrange - a real run, in a workspace of its own.
  const ws = await tempWorkspace();
  await fs.cp(path.join(INSTALL_ROOT, "tasks", "smoke-local"), path.join(ws, "tasks", "smoke-local"), {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });
  await run(["run", "smoke-local", "--yes", "--workspace", ws]);
  const runsRoot = path.join(ws, "tasks", "smoke-local", "runs");
  const runId = (await fs.readdir(runsRoot))[0];
  const before = await fs.readFile(path.join(runsRoot, runId, "scores.jsonl"), "utf-8");

  // Act
  const r = await run(["report", runId, "--workspace", ws]);

  // Assert
  assert.equal(r.code, EXIT.ok);
  const html = await fs.readFile(path.join(runsRoot, runId, "report.html"), "utf-8");
  assert.match(html, /fake-pass/);
  assert.equal(await fs.readFile(path.join(runsRoot, runId, "scores.jsonl"), "utf-8"), before);

  await fs.rm(ws, { recursive: true, force: true });
});

test("report on a workflow run re-renders every step's page, not just the workflow page", async () => {
  // Arrange - a finished multi-step run whose step page is stale.
  const ws = await tempWorkspace();
  await fs.cp(path.join(INSTALL_ROOT, "tasks", "smoke-workflow"), path.join(ws, "tasks", "smoke-workflow"), {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });
  await run(["run", "smoke-workflow", "--yes", "--workspace", ws]);
  const runsRoot = path.join(ws, "tasks", "smoke-workflow", "runs");
  const runId = (await fs.readdir(runsRoot))[0];
  const stepDirs = (await fs.readdir(path.join(runsRoot, runId), { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.join(runsRoot, runId, e.name));
  assert.ok(stepDirs.length > 1, "expected a multi-step run");
  for (const dir of stepDirs) await fs.writeFile(path.join(dir, "report.html"), "STALE");

  // Act
  const r = await run(["report", runId, "--workspace", ws]);

  // Assert
  assert.equal(r.code, EXIT.ok);
  for (const dir of stepDirs) {
    assert.notEqual(await fs.readFile(path.join(dir, "report.html"), "utf-8"), "STALE", `${dir} was not re-rendered`);
  }

  await fs.rm(ws, { recursive: true, force: true });
});

test("report on a run that does not exist is a usage error", async () => {
  const ws = await tempWorkspace();
  await assert.rejects(main(["report", "no-such-run", "--workspace", ws], bufferIo()), UsageError);
  await fs.rm(ws, { recursive: true, force: true });
});

test("a reader that closes the pipe early does not crash the run or cost it its evidence", async () => {
  // Arrange - `agenteval run … | head -1` closes stdout long before the run ends.
  const { spawn } = await import("node:child_process");
  const ws = await tempWorkspace();
  await fs.cp(path.join(INSTALL_ROOT, "tasks", "smoke-local"), path.join(ws, "tasks", "smoke-local"), {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });
  const bin = path.join(INSTALL_ROOT, "bin", "agenteval.mjs");

  // Act
  const child = spawn(process.execPath, [bin, "run", "smoke-local", "--yes", "--workspace", ws], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.destroy();
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => void (stderr += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));

  // Assert
  assert.equal(code, EXIT.ok, stderr);
  assert.doesNotMatch(stderr, /EPIPE/);
  const runs = await fs.readdir(path.join(ws, "tasks", "smoke-local", "runs"));
  assert.equal(runs.length, 1, "the run still wrote its evidence");
});

test("ls names a task whose spec does not load, with the reason, and still lists the rest", async () => {
  // Arrange
  const ws = await tempWorkspace();
  await fs.cp(path.join(INSTALL_ROOT, "tasks", "smoke-local"), path.join(ws, "tasks", "smoke-local"), {
    recursive: true,
    filter: (s) => !s.includes(`${path.sep}runs`),
  });
  await fs.mkdir(path.join(ws, "tasks", "bad"));
  await fs.writeFile(path.join(ws, "tasks", "bad", "spec.yaml"), 'protocol_version: "9.9"\nrun_name: bad\n');

  // Act
  const r = await run(["ls", "--workspace", ws]);

  // Assert
  assert.equal(r.code, EXIT.ok);
  assert.match(r.out, /smoke-local/);
  assert.match(r.out, /could not be read/);
  assert.match(r.out, /tasks\/bad\/spec\.yaml/);
});
