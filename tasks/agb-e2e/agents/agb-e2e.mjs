#!/usr/bin/env node
/**
 * The whole of agb after architecture, unattended, with one model config.
 *
 *   node agents/agb-e2e.mjs <plan-model> [<code-model>]
 *
 * The input's header names the fixture (an agb project with PRD, design and
 * contracts in place, before its task plan). Three stages run in order, each
 * committed so the next starts from a clean tree, and nobody steps in:
 *
 *   detail  `claude -p` + stage-detail   .ab/tasks.json, UI_CONTRACT.md   <plan-model>
 *   qa      `claude -p` + stage-qa       .ab/test-plan.json               <plan-model>
 *   code    `agb run`, every task                                        <code-model>
 *
 * .abrc.json gets spec = <plan-model>, coding = escalation = <code-model>.
 * A stage that fails stops the chain; what got done is still copied back and
 * the wrapper exits 0, so the check grades whatever the chain delivered and
 * its evidence names the stage that broke. A non-zero exit would mark the
 * trial malformed and skip the check. Exit 2 is kept for setup errors.
 *
 * Why a fixed sandbox. `agb run` writes the shell rules a task was denied to
 * .claude/settings.local.json, and claude only honours them in a workspace it
 * trusts (agb: permissions.ts). A fresh trial dir is never trusted, so the run
 * would stall on the first unfamiliar command. The chain runs in one fixed
 * directory (AGB_E2E_SANDBOX, default ~/.agb-e2e/work) that the user trusts
 * once, then the result is copied into the trial dir. One trial at a time: a
 * lock refuses a second.
 *
 * Spend: each claude stage has --max-budget-usd, `agb run` has --max-cost.
 * The sum of what they report is written to .eval-usage.json (reports_usage).
 * `AGB_EVAL_DRY=1` lays everything down and runs `agb run --dry-run` on the
 * reference plan instead of calling a model.
 */

import { spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_COST = { detail: 15, qa: 10, code: Number(process.env.AGB_E2E_MAX_RUN_COST ?? 80) };
const MINUTES = 60 * 1000;
const STAGE_TIMEOUT = { detail: 50 * MINUTES, qa: 30 * MINUTES, code: 5 * 60 * MINUTES };
const SANDBOX_MARK = ".agb-e2e-sandbox";
// Installs, build output and local data are not the deliverable; the check reinstalls.
const NOT_COPIED_ANYWHERE = new Set([".git", "node_modules", "dist"]);
// events.jsonl grows with every gate run; the check starts its own.
const NOT_COPIED_AT = new Set([".claude", ".agb-e2e.lock", SANDBOX_MARK, "server/data", ".ab/events.jsonl"]);
// Hours of agb output would overrun the harness's 2 MB stdout buffer (and get
// the wrapper killed mid-run); every stage logs here instead.
const LOG = "AGB_EVAL_LOG.txt";
const LOG_KEEP_BYTES = 256 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const trialDir = process.cwd();
const [planModel, codeModel = planModel] = process.argv.slice(2);
const dry = process.env.AGB_EVAL_DRY === "1";
const AGB_HOME = process.env.AGB_HOME ?? path.join(os.homedir(), "workspace", "57b", "agb");
const AGB_PLUGIN = path.join(AGB_HOME, "skills", "dist", "packages", "claude-code");
const AGB_CLI = [path.join(AGB_HOME, "node_modules", ".bin", "tsx"), path.join(AGB_HOME, "packages", "agb", "src", "run", "cli.ts")];
const sandbox = path.resolve(process.env.AGB_E2E_SANDBOX ?? path.join(os.homedir(), ".agb-e2e", "work"));

/** Exit 2: the setup is wrong, not the candidate. Same for every candidate. */
function refuse(msg) {
  console.error(msg);
  process.exit(2);
}

const header = Object.fromEntries(
  [...readFileSync(path.join(trialDir, ".eval-input.txt"), "utf-8").matchAll(/^(fixture):\s*(\S+)/gm)].map((m) => [m[1], m[2]]),
);
const fixture = header.fixture ? path.resolve(here, "..", "fixture", header.fixture) : "";
if (!planModel || !header.fixture || !existsSync(fixture)) refuse("usage: agb-e2e.mjs <plan-model> [<code-model>]; the input needs fixture: <dir under fixture/>");
for (const skill of ["stage-detail", "stage-qa"]) {
  if (!existsSync(path.join(AGB_PLUGIN, "skills", skill))) refuse(`agb's Claude Code plugin has no ${skill} at ${AGB_PLUGIN} (run pnpm install in AGB_HOME)`);
}
if (!AGB_CLI.every(existsSync)) refuse(`agb not found under ${AGB_HOME} (set AGB_HOME)`);

function isTrusted(dir) {
  try {
    const cfg = JSON.parse(readFileSync(path.join(os.homedir(), ".claude.json"), "utf-8"));
    return cfg.projects?.[dir]?.hasTrustDialogAccepted === true;
  } catch {
    return false;
  }
}

function prepareSandbox() {
  // Never wipe a directory this script did not make: it must be marked, and
  // must not be home or a parent of it.
  if (sandbox === path.parse(sandbox).root || os.homedir().startsWith(sandbox)) refuse(`refusing sandbox ${sandbox}`);
  if (!existsSync(sandbox)) {
    mkdirSync(sandbox, { recursive: true });
    writeFileSync(path.join(sandbox, SANDBOX_MARK), "agb-e2e trial sandbox: emptied before every trial\n");
  }
  if (!existsSync(path.join(sandbox, SANDBOX_MARK))) refuse(`${sandbox} exists but is not an agb-e2e sandbox (no ${SANDBOX_MARK}); pick another AGB_E2E_SANDBOX`);
  if (!dry && !isTrusted(sandbox)) {
    refuse(`claude does not trust ${sandbox}, so agb's permission rules would be ignored and the run would stall.\nTrust it once: cd ${sandbox} && claude   (accept, then exit)`);
  }
  try {
    mkdirSync(path.join(sandbox, ".agb-e2e.lock"));
  } catch {
    refuse(`${sandbox} is in use by another trial (remove ${path.join(sandbox, ".agb-e2e.lock")} if none is running)`);
  }
  for (const e of readdirSync(sandbox)) {
    if (e !== SANDBOX_MARK && e !== ".agb-e2e.lock") rmSync(path.join(sandbox, e), { recursive: true, force: true });
  }
}

let logFd = null;
function log(line) {
  if (logFd !== null) writeFileSync(logFd, line + "\n");
}

function run(cmd, args, timeout) {
  log(`$ ${path.basename(cmd)} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: sandbox, stdio: ["ignore", logFd, logFd], timeout });
  if (r.error && r.error.code !== "ETIMEDOUT") throw r.error;
  return r.error ? 124 : (r.status ?? 1);
}

const git = (...args) => run("git", ["-c", "user.name=agentic-evaluator", "-c", "user.email=eval@localhost", ...args]);
function commit(msg) {
  const added = git("add", "-A");
  return added !== 0 ? added : git("commit", "-q", "--allow-empty", "-m", msg);
}

function json(file, update) {
  const p = path.join(sandbox, file);
  writeFileSync(p, JSON.stringify(update(JSON.parse(readFileSync(p, "utf-8"))), null, 2) + "\n");
}

/** One claude stage; returns what it says about itself. */
function runClaude(stage, prompt) {
  const started = Date.now();
  const r = spawnSync("claude", [
    "-p", prompt,
    "--output-format", "json",
    "--model", planModel,
    "--max-budget-usd", String(MAX_COST[stage]),
    // The skills come from agb's own build, loaded for this session only.
    "--plugin-dir", AGB_PLUGIN,
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Skill", "Bash(ls:*)",
  ], { cwd: sandbox, encoding: "utf-8", stdio: ["ignore", "pipe", logFd], maxBuffer: 16 * 1024 * 1024, timeout: STAGE_TIMEOUT[stage] });
  log(`[${stage}] ${(r.stdout ?? "").slice(-4000)}`);
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    out = { is_error: true, subtype: r.error?.code === "ETIMEDOUT" ? "timeout" : "unparseable", result: (r.stdout ?? "").slice(-2000) };
  }
  const u = out.usage ?? {};
  return {
    stage,
    exit: r.error ? 124 : r.status,
    ok: r.status === 0 && out.is_error !== true,
    subtype: out.subtype ?? null,
    num_turns: out.num_turns ?? null,
    cost_usd: typeof out.total_cost_usd === "number" ? out.total_cost_usd : null,
    prompt_tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    completion_tokens: u.output_tokens ?? 0,
    seconds: Math.round((Date.now() - started) / 1000),
    result: String(out.result ?? "").slice(0, 2000),
  };
}

function runAgb() {
  const started = Date.now();
  const exit = run(AGB_CLI[0], [AGB_CLI[1], "run", `--max-cost=${MAX_COST.code}`], STAGE_TIMEOUT.code);
  const statePath = path.join(sandbox, ".ab", "run", "state.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf-8")) : null;
  return {
    stage: "code",
    exit,
    ok: exit === 0,
    cost_usd: typeof state?.costUsd === "number" ? state.costUsd : null,
    seconds: Math.round((Date.now() - started) / 1000),
    completed_tasks: state?.completedTasks ?? [],
    failed_domains: state?.failedDomains ?? [],
  };
}

const DETAIL_PROMPT =
  "用 stage-detail skill 完成这个项目的详设与任务拆解阶段。输入在 docs/PRD.md、docs/DESIGN.md 与 _contracts/；" +
  "按 skill 的要求产出 .ab/tasks.json 与 UI_CONTRACT.md。只做这一个阶段，不要写代码，不要写测试。" +
  "遇到需要问人的地方，按最合理的假设继续，并把假设写进产物。";
const QA_PROMPT =
  "用 stage-qa skill 完成这个项目的测试设计阶段。输入在 docs/PRD.md、.ab/prd.json、.ab/tasks.json 与 UI_CONTRACT.md；" +
  "按 skill 的要求产出 .ab/test-plan.json。只做这一个阶段，不要写代码，不要写用例正文。" +
  "遇到需要问人的地方，按最合理的假设继续，并把假设写进产物。";

function copyBack() {
  cpSync(sandbox, trialDir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(sandbox, src);
      return rel === "" || (!NOT_COPIED_ANYWHERE.has(path.basename(src)) && !NOT_COPIED_AT.has(rel));
    },
  });
  // agb keeps its run state under .ab/run/, which agb projects gitignore; a
  // copy at the root keeps "which tasks got done" with the trial.
  const state = path.join(sandbox, ".ab", "run", "state.json");
  if (existsSync(state)) cpSync(state, path.join(trialDir, "AGB_EVAL_STATE.json"));
}

prepareSandbox();
logFd = openSync(path.join(trialDir, LOG), "a");
const stages = [];
let status = 1;
try {
  cpSync(fixture, sandbox, { recursive: true });
  json(".abrc.json", (rc) => ({ ...rc, models: { spec: planModel, coding: codeModel, escalation: codeModel } }));
  git("init", "-q");
  commit(`fixture: ${header.fixture}`);

  if (dry) {
    // No model: lay the reference plan down and let agb plan the run.
    const ref = path.resolve(here, "..", "references", header.fixture);
    for (const f of [".ab/tasks.json", ".ab/test-plan.json", "UI_CONTRACT.md"]) {
      if (existsSync(path.join(ref, f))) cpSync(path.join(ref, f), path.join(sandbox, f));
    }
    commit("dry: reference plan");
    status = run(AGB_CLI[0], [AGB_CLI[1], "run", "--dry-run", `--max-cost=${MAX_COST.code}`], 10 * MINUTES);
  } else {
    for (const [stage, prompt] of [["detail", DETAIL_PROMPT], ["qa", QA_PROMPT]]) {
      const s = runClaude(stage, prompt);
      stages.push(s);
      if (!s.ok) break;
      commit(`agb-e2e: ${stage} stage`);
    }
    if (stages.every((s) => s.ok)) stages.push(runAgb());
    status = 0;
  }
} finally {
  copyBack();
  const costs = stages.map((s) => s.cost_usd);
  if (stages.length > 0 && costs.every((c) => typeof c === "number")) {
    writeFileSync(path.join(trialDir, ".eval-usage.json"), JSON.stringify({
      cost_usd: costs.reduce((a, b) => a + b, 0),
      prompt_tokens: stages.reduce((n, s) => n + (s.prompt_tokens ?? 0), 0),
      completion_tokens: stages.reduce((n, s) => n + (s.completion_tokens ?? 0), 0),
    }));
  }
  writeFileSync(path.join(trialDir, "AGB_EVAL_RESULT.json"), JSON.stringify({ plan_model: planModel, code_model: codeModel, stages }, null, 2));
  rmSync(path.join(sandbox, ".agb-e2e.lock"), { recursive: true, force: true });
  closeSync(logFd);
  // The harness reads every file back as the answer: keep the log's tail.
  const logPath = path.join(trialDir, LOG);
  const text = readFileSync(logPath);
  if (text.length > LOG_KEEP_BYTES) writeFileSync(logPath, `[… ${text.length - LOG_KEEP_BYTES} bytes cut]\n` + text.subarray(-LOG_KEEP_BYTES).toString("utf-8"));
}
const summary = stages.map((s) => `${s.stage} ${s.ok ? "ok" : `failed (exit ${s.exit}${s.subtype ? `, ${s.subtype}` : ""})`} $${s.cost_usd ?? "?"} ${s.seconds}s`);
console.log(dry ? `dry run: agb run --dry-run exited ${status}` : summary.join("\n"));
process.exit(status);
