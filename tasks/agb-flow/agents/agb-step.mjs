#!/usr/bin/env node
/**
 * One step of agb's flow, with one model.
 *
 *   node agents/agb-step.mjs <model> <max-cost-usd>
 *
 * agenteval has already laid the starting state into the work dir: the
 * input's fixture, or the previous step's files when chained. It says which
 * step this is (EVAL_STEP) and whether the work dir was handed over
 * (EVAL_CHAINED). This sets all of agb's model slots to <model>, commits the
 * tree and runs the step:
 *
 *   task-breakdown  `claude -p` + stage-detail   .ab/tasks.json, UI_CONTRACT.md
 *   test-design     `claude -p` + stage-qa       .ab/test-plan.json
 *   implementation  `agb run`: one task (the plan cut down to the input's task), or,
 *           chained, every task in the plan
 *
 * Tokens are reported, not dollars (reports_usage: tokens): agenteval prices
 * them. The provider comes from the candidate's env (ANTHROPIC_BASE_URL);
 * for a model claude does not know, every model slot claude might reach for
 * on its own is pinned to it, and the spend cap is converted to claude's
 * units, since claude prices unknown models at Opus rates.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [model, capArg] = process.argv.slice(2);
/** agenteval's step id → the agb stage it runs. Below, `step` is the stage. */
const STAGE = { "task-breakdown": "detail", "test-design": "qa", implementation: "code" };
const step = STAGE[process.env.EVAL_STEP];
const chained = process.env.EVAL_CHAINED === "1";
const cwd = process.cwd();
const AGB_HOME = process.env.AGB_HOME ?? path.join(os.homedir(), "workspace", "57b", "agb");
const AGB = [path.join(AGB_HOME, "node_modules", ".bin", "tsx"), path.join(AGB_HOME, "packages", "agb", "src", "run", "cli.ts")];
const PLUGIN = path.join(AGB_HOME, "skills", "dist", "packages", "claude-code");
// What claude charges a model it does not know, per million input tokens:
// Opus rates (measured 2026-10-14, claude 2.1.296; docs/design/agb-flow-gaps.md B1).
const CLAUDE_FALLBACK_INPUT = 5;
const MINUTES = 60 * 1000;

/** Exit 2: the setup is wrong, not the candidate. */
function refuse(msg) {
  console.error(msg);
  process.exit(2);
}

const cap = Number(capArg);
if (!model || !(cap > 0) || !step) {
  refuse(`usage: agb-step.mjs <model> <max-cost-usd>, with EVAL_STEP ${Object.keys(STAGE).join("|")} (agenteval sets it)`);
}
if (!AGB.every(existsSync)) refuse(`agb not found under ${AGB_HOME} (set AGB_HOME)`);
if (step !== "code" && !existsSync(path.join(PLUGIN, "skills", `stage-${step}`))) {
  refuse(`agb's Claude Code plugin has no stage-${step} at ${PLUGIN} (run pnpm install in AGB_HOME)`);
}
if (!existsSync(path.join(cwd, ".abrc.json"))) refuse("the work dir holds no agb project (.abrc.json): no fixture was laid in");

const isClaude = /^claude-/.test(model);
const price = process.env.EVAL_MODEL_PRICE ? JSON.parse(process.env.EVAL_MODEL_PRICE) : null;
// claude knows its own models' prices; another model's cap is scaled by input price.
const claudeCap = isClaude || !price?.input ? cap : Math.round(cap * (CLAUDE_FALLBACK_INPUT / price.input) * 100) / 100;
const provider = process.env.ANTHROPIC_BASE_URL ?? "";
// A clean claude config per trial: no personal MCP servers, plugins, global
// rules, hooks or memory — they would change what the model does, and no one
// else could reproduce the run. Claude models sign in with
// CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`); others with their provider key.
const claudeHome = mkdtempSync(path.join(os.tmpdir(), "agb-flow-claude-"));
// Only the credential this candidate's provider needs crosses over: the agent
// has a whole shell, and every other key in this environment would be its to read.
const SECRETS = ["OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
const needed = isClaude
  ? ["CLAUDE_CODE_OAUTH_TOKEN"]
  : provider.includes("deepseek") ? ["ANTHROPIC_API_KEY"] : ["ANTHROPIC_AUTH_TOKEN"];
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRETS.includes(k) || needed.includes(k))),
  // Provider keys arrive as ANTHROPIC_* (cli.env); an empty one must stay empty, not unset.
  ...(isClaude ? {} : { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "", ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ?? "" }),
  CLAUDE_CONFIG_DIR: claudeHome,
  // Its own npm cache: trials run side by side, and two installs writing one
  // cache at once crash npm, which would fail the candidate for nothing.
  npm_config_cache: path.join(claudeHome, "npm-cache"),
  ...(isClaude
    ? {}
    : {
        ANTHROPIC_MODEL: model,
        ANTHROPIC_SMALL_FAST_MODEL: model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
        CLAUDE_CODE_SUBAGENT_MODEL: model,
      }),
};
if (isClaude && !env.CLAUDE_CODE_OAUTH_TOKEN) refuse("a Claude model needs CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`, put it in .env.local)");

function run(cmd, args, timeoutMin) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: ["ignore", "inherit", "inherit"], timeout: timeoutMin * MINUTES });
  if (r.error && r.error.code !== "ETIMEDOUT") throw r.error;
  return r.error ? 124 : (r.status ?? 1);
}
const git = (...a) => run("git", ["-c", "user.name=agentic-evaluator", "-c", "user.email=eval@localhost", ...a], 2);

function json(file, update) {
  const p = path.join(cwd, file);
  writeFileSync(p, JSON.stringify(update(JSON.parse(readFileSync(p, "utf-8"))), null, 2) + "\n");
}

/** agenteval prices these (reports_usage: tokens). */
function reportTokens(t) {
  writeFileSync(path.join(cwd, ".eval-usage.json"), JSON.stringify({
    prompt_tokens: t.input, completion_tokens: t.output, cache_read_tokens: t.cacheRead, cache_write_tokens: t.cacheWrite,
  }));
}

// ── Starting state ──────────────────────────────────────────────────────
// One model for everything agb runs: its spec, coding and escalation slots,
// and the verifier that reviews each task (sonnet unless told otherwise, which
// would put a second model into every Claude candidate's run).
json(".abrc.json", (rc) => ({ ...rc, models: { spec: model, coding: model, escalation: model }, verifier: { ...rc.verifier, model } }));
// The whole shell, for every candidate alike (the user's decision, 2026-10-14).
// Narrowed rules (`Bash(npm:*)`) stop an unattended run at the first command
// shape not listed (a `for` loop, `curl`), and agb only writes the rule it was
// denied in a directory claude trusts, which a trial dir never is: the smoke
// run stopped env-blocked after 37 minutes. They also protected nothing that
// `npm` and `node`, which any coding session needs, could not already do.
// claude honours this list in an untrusted dir (docs/design/agb-flow-gaps.md D1).
mkdirSync(path.join(cwd, ".claude"), { recursive: true });
writeFileSync(path.join(cwd, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash"] } }, null, 2));

if (step === "code" && !chained) {
  // One task: earlier tasks' code is in the fixture, so its dependencies are met.
  const task = /^task:\s*(\S+)/m.exec(readFileSync(path.join(cwd, ".eval-input.txt"), "utf-8"))?.[1];
  if (!task) refuse("the input names no task (task: T-NNN)");
  json(".ab/tasks.json", (plan) => ({
    ...plan,
    domains: plan.domains
      .map((d) => ({ ...d, dependsOn: [], tasks: (d.tasks ?? []).filter((t) => t.id === task).map((t) => ({ ...t, dependsOn: [] })) }))
      .filter((d) => d.tasks.length > 0),
  }));
}
git("init", "-q");
git("add", "-A");
git("commit", "-q", "-m", `agb-flow: ${step} starts`);

// ── The step ────────────────────────────────────────────────────────────
const PROMPTS = {
  detail:
    "用 stage-detail skill 完成这个项目的详设与任务拆解阶段。输入在 docs/PRD.md、docs/DESIGN.md 与 _contracts/；" +
    "按 skill 的要求产出 .ab/tasks.json 与 UI_CONTRACT.md。只做这一个阶段，不要写代码，不要写测试。" +
    "遇到需要问人的地方，按最合理的假设继续，并把假设写进产物。",
  qa:
    "用 stage-qa skill 完成这个项目的测试设计阶段。输入在 docs/PRD.md、.ab/prd.json、.ab/tasks.json 与 UI_CONTRACT.md；" +
    "按 skill 的要求产出 .ab/test-plan.json。只做这一个阶段，不要写代码，不要写用例正文。" +
    "遇到需要问人的地方，按最合理的假设继续，并把假设写进产物。",
};

function runClaude(prompt) {
  const r = spawnSync("claude", [
    "-p", prompt,
    "--output-format", "json",
    "--model", model,
    "--max-budget-usd", String(claudeCap),
    "--plugin-dir", PLUGIN,
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Skill", "Bash(ls:*)",
  ], { cwd, env, encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 });
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    console.error(`claude printed no result: ${(r.stdout ?? "").slice(-1000)}`);
    return 1;
  }
  const u = out.usage ?? {};
  reportTokens({ input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 });
  console.log(`claude: ${out.subtype ?? "?"}, ${out.num_turns ?? "?"} turns. ${String(out.result ?? "").slice(0, 1500)}`);
  return r.status === 0 && out.is_error !== true ? 0 : 1;
}

/** Tokens from agb's task.end events; nothing when any task did not report them. */
function agbTokens() {
  const events = path.join(cwd, ".ab", "events.jsonl");
  if (!existsSync(events)) return;
  const ends = readFileSync(events, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "task.end");
  if (ends.length === 0 || ends.some((e) => typeof e.inputTokens !== "number")) return;
  const sum = (k) => ends.reduce((n, e) => n + (e[k] ?? 0), 0);
  reportTokens({ input: sum("inputTokens"), output: sum("outputTokens"), cacheRead: sum("cacheReadTokens"), cacheWrite: sum("cacheCreationTokens") });
}

let status;
try {
  if (step === "code") {
    // The closing mutation pass is a diagnosis, not the task, and costs differently per model.
    // agenteval enforces the time limit (and stops the whole tree); no second clock here.
    const exit = run(AGB[0], [AGB[1], "run", `--max-cost=${claudeCap}`, "--no-mutate"], 24 * 60);
    agbTokens();
    // Done means every planned task completed. agb's own closing verdict is
    // not the ruler here: alone, a task leaves the later tasks' red tests in
    // the tree, which cannot compile yet, so agb fails the delivery whatever
    // the task did. The step's check (the task's own tests) decides.
    const planned = (JSON.parse(readFileSync(path.join(cwd, ".ab", "tasks.json"), "utf-8")).domains ?? []).flatMap((d) => (d.tasks ?? []).map((t) => t.id));
    const statePath = path.join(cwd, ".ab", "run", "state.json");
    const completed = new Set(existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf-8")).completedTasks ?? [] : []);
    const allDone = planned.length > 0 && planned.every((id) => completed.has(id));
    console.log(`agb run exited ${exit}; ${planned.filter((id) => completed.has(id)).length} of ${planned.length} planned tasks completed`);
    status = allDone ? 0 : exit || 1;
  } else {
    status = runClaude(PROMPTS[step]);
  }
} finally {
  // Build output is not the deliverable.
  for (const p of ["server/dist", "client/dist", "dist"]) rmSync(path.join(cwd, p), { recursive: true, force: true });
  rmSync(claudeHome, { recursive: true, force: true });
}
process.exit(status);
