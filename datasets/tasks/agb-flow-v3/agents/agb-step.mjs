#!/usr/bin/env node
/**
 * One step of agb's flow, with one model.
 *
 *   node agents/agb-step.mjs <model> <max-cost-usd> [bare]
 *
 * agenteval has already laid the starting state into the work dir: the
 * input's fixture, or the previous step's files when chained. It says which
 * step this is (EVAL_STEP) and whether the work dir was handed over
 * (EVAL_CHAINED). This sets all of agb's model slots to <model>, commits the
 * tree and runs the step:
 *
 *   spec            `claude -p /agb-skills:agb-spec`        docs/PRD.md, .ab/prd.json
 *   architecture    `claude -p /agb-skills:agb-arch`        _contracts/, docs/DESIGN.md, .ab/design.json, .ab/arch.json
 *   task-breakdown  `claude -p /agb-skills:agb-tasks`       .ab/tasks.json, UI_CONTRACT.md
 *   test-design     `claude -p /agb-skills:agb-test-plan`   .ab/test-plan.json
 *   implementation  `agb run`: the whole plan (a small project codes it in one
 *           session), or one task when the input names one (task: T-NNN).
 *           With `bare`: plain `claude -p`, no agb plugin, no orchestration.
 *
 * The four planning stages run agb's own slash commands, unattended: no one
 * is in the session, so questions with a recommendation take it
 * (--accept-recommended) and the rest are left open in the ledger.
 *
 * Tokens are reported, not dollars (reports_usage: tokens): agenteval prices
 * them. The provider comes from the candidate's env (ANTHROPIC_BASE_URL);
 * for a model claude does not know, every model slot claude might reach for
 * on its own is pinned to it, and the spend cap is converted to claude's
 * units, since claude prices unknown models at Opus rates.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const [model, capArg, arm] = process.argv.slice(2);
const bare = arm === "bare";
// One auditor for every arm (agb's verifier, closing acceptance audit and seam
// review): a candidate auditing itself is what made October's code step weak.
const AUDITOR = process.env.AGB_AUDITOR ?? "claude-opus-5-5";
/** agenteval's step id → the agb stage it runs. Below, `step` is the stage. */
const STAGE = { spec: "spec", architecture: "arch", "task-breakdown": "tasks", "test-design": "test-plan", implementation: "code" };
const step = STAGE[process.env.EVAL_STEP] ?? (/^build/.test(process.env.EVAL_STEP ?? "") ? "code" : undefined);
const chained = process.env.EVAL_CHAINED === "1";
const cwd = process.cwd();
const AGB_HOME = process.env.AGB_HOME ?? path.join(os.homedir(), "workspace", "57b", "agb-eval");
const AGB = [path.join(AGB_HOME, "node_modules", ".bin", "tsx"), path.join(AGB_HOME, "packages", "agb", "src", "run", "cli.ts")];
// The plugin as Claude Code installs it: the stages are its slash commands
// (.claude/commands/agb-<stage>.md), each splicing in the packs it needs.
const PLUGIN = path.join(AGB_HOME, "skills", "dist", "packages", "claude-code");
const command = (stage) => path.join(PLUGIN, ".claude", "commands", `agb-${stage}.md`);
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
if (step !== "code" && !existsSync(command(step))) {
  refuse(`agb's Claude Code plugin has no /agb-${step} command at ${PLUGIN} (build agb's skills in AGB_HOME)`);
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
  // agb run waits out a subscription's usage window (up to a week) before it
  // retries; a trial would sit until its timeout. Fail now, as usage-limit.
  AB_USAGE_WAIT_MAX_H: "0",
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
// the verifier and the security reviewer (both sonnet unless told otherwise,
// which would put a second model into every candidate's run). The code step
// turns those two off as well; pinning them is for the run that leaves them on.
// agb at 0a8c4ee7 has eight model slots; an unset one defaults to opus and
// would put opus into a sonnet run. The candidate writes (spec, coding,
// escalation, the post-coding review); the auditor checks; the load test is off.
json(".abrc.json", (rc) => ({
  ...rc,
  models: { spec: model, coding: model, escalation: model },
  review: { ...rc.review, model },
  verifier: { ...rc.verifier, model: AUDITOR },
  audit: { ...rc.audit, model: AUDITOR },
  seam: { ...rc.seam, model: AUDITOR },
  securityReview: { ...rc.securityReview, model },
  load: { ...rc.load, enabled: false },
}));
// The stage commands converge with `./.ab/bin/agb check` (agb's converging
// pack); a project agb installed has it, a fixture does not. Kept out of git.
const shim = path.join(cwd, ".ab", "bin", "agb");
if (!bare && !existsSync(shim)) {
  mkdirSync(path.dirname(shim), { recursive: true });
  writeFileSync(shim, `#!/bin/sh\nexec ${JSON.stringify(AGB[0])} ${JSON.stringify(AGB[1])} "$@"\n`, { mode: 0o755 });
}
// The whole shell, for every candidate alike (the user's decision, 2026-10-14).
// Narrowed rules (`Bash(npm:*)`) stop an unattended run at the first command
// shape not listed (a `for` loop, `curl`), and agb only writes the rule it was
// denied in a directory claude trusts, which a trial dir never is: the smoke
// run stopped env-blocked after 37 minutes. They also protected nothing that
// `npm` and `node`, which any coding session needs, could not already do.
// claude honours this list in an untrusted dir (docs/design/agb-flow-gaps.md D1).
mkdirSync(path.join(cwd, ".claude"), { recursive: true });
writeFileSync(path.join(cwd, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash"] } }, null, 2));

const task = step === "code" && !chained ? /^task:\s*(\S+)/m.exec(readFileSync(path.join(cwd, ".eval-input.txt"), "utf-8"))?.[1] : undefined;
if (task) {
  // One task: earlier tasks' code is in the fixture, so its dependencies are met.
  json(".ab/tasks.json", (plan) => ({
    ...plan,
    domains: plan.domains
      .map((d) => ({ ...d, dependsOn: [], tasks: (d.tasks ?? []).filter((t) => t.id === task).map((t) => ({ ...t, dependsOn: [] })) }))
      .filter((d) => d.tasks.length > 0),
  }));
}
git("init", "-q");
writeFileSync(path.join(cwd, ".git", "info", "exclude"), ".ab/bin/\n.claude/\n");
git("add", "-A");
git("commit", "-q", "-m", `agb-flow: ${step} starts`);

// ── The step ────────────────────────────────────────────────────────────
/** The slash command each planning stage runs, with its arguments. */
function stageCommand(stage) {
  if (stage !== "spec") return `/agb-skills:agb-${stage} --accept-recommended`;
  // The spec stage needs the external document named; the fixture holds it under docs/prd-source/.
  const dir = path.join(cwd, "docs", "prd-source");
  const sources = existsSync(dir) ? readdirSync(dir).map((f) => `docs/prd-source/${f}`) : [];
  if (sources.length === 0) refuse("the spec step's fixture has no docs/prd-source/: nothing to normalize");
  const prototypes = existsSync(path.join(cwd, "docs")) ? readdirSync(path.join(cwd, "docs")).filter((f) => /\.html?$/.test(f)).map((f) => `docs/${f}`) : [];
  return `/agb-skills:agb-spec --accept-recommended 需求原文在 ${sources.join("、")}` + (prototypes.length ? `；原型在 ${prototypes.join("、")}` : "");
}

/**
 * Said once, the same for every candidate: the session is unattended. Without
 * it a stage asks its questions and ends its turn waiting for an answer, and
 * the step is graded on a half-done stage.
 */
const UNATTENDED =
  "这是一次无人值守的评测运行：会话里没有人，不会有人回答，也不要停下来等。" +
  "需要问人的问题按 asking 的「全部按推荐」处理：有推荐项的按推荐落（answeredBy 写 \"eval-operator\"）；" +
  "没有推荐、要人给取值或密钥的，登记进 .ab/questions.json 留空，继续把这一阶段做完。" +
  "只做这一个阶段，收尾按 converging 收敛门禁并提交。";

/**
 * claude's event stream is the trace: every model call, tool call and the
 * closing result, kept as .eval-trace.jsonl (cli.trace: claude-code), from
 * which agenteval also reads the run's tokens and cost. The result line is
 * the last one; what runClaude needs from it is read back from the file.
 */
function runClaude(prompt, { plugin = true } = {}) {
  const r = spawnSync("claude", [
    "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    "--model", model,
    "--max-budget-usd", String(claudeCap),
    // The packs a command reads at run time live in the plugin, outside the work dir.
    ...(plugin ? ["--plugin-dir", PLUGIN, "--add-dir", PLUGIN] : []),
    "--append-system-prompt", plugin ? UNATTENDED : BARE_UNATTENDED,
    "--permission-mode", "acceptEdits",
    // The whole shell, as in the code step: converging runs agb check and git commit.
    "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Skill", "Bash",
  ],{ cwd, env, encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 256 * 1024 * 1024 });
  writeFileSync(path.join(cwd, ".eval-trace.jsonl"), r.stdout ?? "");
  const lines = (r.stdout ?? "").split("\n").filter(Boolean);
  let out;
  try {
    out = JSON.parse(lines[lines.length - 1] ?? "");
    if (out.type !== "result") throw new Error("last line is not the result");
  } catch {
    console.error(`claude printed no result: ${(r.stdout ?? "").slice(-1000)}`);
    return 1;
  }
  // A subscription's usage window ran out: not the candidate's answer. Exit 75
  // (EX_TEMPFAIL) so the trial reads as an error to re-run, not a wrong answer.
  if (/hit your .{0,40}limit|usage limit reached/i.test(String(out.result ?? ""))) {
    console.error(`usage-limit: ${String(out.result).slice(0, 200)}`);
    return 75;
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

const BARE_UNATTENDED = "这是一次无人值守的评测运行：会话里没有人，不会有人回答，也不要停下来等。拿不准的按最合理的理解做，并在 README 里写明。";

/** The no-skill arm: the same model and starting tree, no agb plugin, no orchestration. */
const BARE_PROMPT =
  "这是一个已经规划好的项目：docs/PRD.md（需求）、docs/DESIGN.md 与 _contracts/（设计和 API 契约）、" +
  "UI_CONTRACT.md（界面锚点）、.ab/tasks.json（任务清单）、.ab/test-plan.json（验收测试计划）。" +
  "把整份任务清单实现出来：写代码和测试，让验收测试计划里的测试都通过，能用 README 里写的命令起起来。完成后提交。";

let status;
try {
  if (step === "code" && bare) {
    status = runClaude(BARE_PROMPT, { plugin: false });
  } else if (step === "code") {
    // What is measured is the candidate writing code. The closing mutation
    // pass, the verifier, the security review and the contract audit are
    // diagnoses run by further sessions: each costs differently per model and
    // the verifier, being the candidate, fails strict models on themselves.
    // agenteval enforces the time limit (and stops the whole tree); no second clock here.
    // agb has no cost cap since #109 (2026-10-17); the time limit bounds the trial.
    // v3: the closing audit (by the fixed auditor) and its fix rounds are agb's
    // own quality loop and stay on; the mutation diagnosis and security review stay off.
    const exit = run(AGB[0], [AGB[1], "run", "--no-mutate", "--no-security-review"], 24 * 60);
    agbTokens();
    // Done means every planned task completed. agb's own closing verdict is
    // not the ruler here: alone, a task leaves the later tasks' red tests in
    // the tree, which cannot compile yet, so agb fails the delivery whatever
    // the task did. The step's check (the task's own tests) decides.
    const planned = (JSON.parse(readFileSync(path.join(cwd, ".ab", "tasks.json"), "utf-8")).domains ?? []).flatMap((d) => (d.tasks ?? []).map((t) => t.id));
    const statePath = path.join(cwd, ".ab", "run", "state.json");
    const completed = new Set(existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf-8")).completedTasks ?? [] : []);
    // A small project's single session is one synthesized task (T-000).
    const allDone = planned.length > 0 && (planned.every((id) => completed.has(id)) || [...completed].some((id) => /^T-0*0$/.test(id)));
    console.log(`agb run exited ${exit}; ${planned.filter((id) => completed.has(id)).length} of ${planned.length} planned tasks completed`);
    status = allDone ? 0 : exit || 1;
  } else {
    status = runClaude(stageCommand(step));
  }
} finally {
  // agb leaves its compose services up (so a resume need not start over); a
  // trial must not: the grader brings up its own, and the next trial needs the ports.
  if (step === "code") {
    for (const f of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
      if (existsSync(path.join(cwd, f))) { run("docker", ["compose", "-f", f, "down", "-v", "--remove-orphans"], 3); break; }
    }
  }
  // Build output is not the deliverable.
  for (const p of ["server/dist", "client/dist", "dist"]) rmSync(path.join(cwd, p), { recursive: true, force: true });
  rmSync(claudeHome, { recursive: true, force: true });
}
process.exit(status);
