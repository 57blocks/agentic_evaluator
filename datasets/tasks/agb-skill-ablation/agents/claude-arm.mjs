#!/usr/bin/env node
/**
 * One agb stage with Claude Code, with or without agb's skills.
 *
 *   node agents/claude-arm.mjs <model> <max-cost-usd> <skill|none>
 *
 * agenteval lays the stage's starting tree into the work dir (the same
 * fixture for both arms: a real agb project at the moment the stage began)
 * and names the step (EVAL_STEP). Both arms get the same model, a clean
 * Claude config and the whole shell. They differ in what using agb's skills
 * means in practice, not only in the plugin (agb-skills, AGB_HOME, default
 * ~/workspace/57b/agb-eval @0a8c4ee7, plugin build e849b1563289):
 *
 *   skill  claude -p "/agb-skills:agb-<stage> --accept-recommended"
 *            --plugin-dir <agb-skills> --add-dir <agb-skills>
 *          What a developer with agb's skills installed types. The planning
 *          stages are agb-flow-v3's path verbatim (command, unattended note,
 *          flags, one session), and they converge with agb's CLI
 *          (./.ab/bin/agb check), which is also the grader's ruler. Code
 *          starts `agb run` and supervises it; the session is reopened while
 *          the plan is unfinished (it may detach, or stop short), as a
 *          developer coming back would: at most MAX_SESSIONS in all. Inside
 *          agb run the fixed auditor (opus) checks the candidate's work, so
 *          sonnet-5-5-skill has an opus reviewer that sonnet-5-5-none lacks.
 *   none   claude -p "<what this stage must produce>"
 *          No plugin, no agb CLI, one session. A planning stage's prompt
 *          carries the deliverable contract (agents/contracts/<step>.md):
 *          paths, JSON shapes and ID rules the grader reads, not agb's method.
 *
 * Tokens are reported, not dollars (reports_usage: tokens): every claude
 * session plus every session agb run started (.ab/events.jsonl), summed.
 * agenteval prices them at the candidate's rates; the fixed auditor's opus
 * tokens in a sonnet trial are therefore priced as sonnet (underestimated).
 * Every session's event stream is appended to .eval-trace.jsonl
 * (cli.trace: claude-code); checks/arm-check.mjs reads it to confirm the arm.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, appendFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [model, capArg, arm] = process.argv.slice(2);
if (!model || !capArg || !["skill", "none"].includes(arm)) refuse("usage: claude-arm.mjs <model> <max-cost-usd> <skill|none>");
const withSkill = arm === "skill";
const cap = Number(capArg);
const MINUTES = 60_000;
const MAX_SESSIONS = 3;
// One auditor for every trial (agb's closing audit, verifier and seam review),
// as in agb-flow-v3: a candidate auditing itself is what made October weak.
const AUDITOR = process.env.AGB_AUDITOR ?? "claude-opus-5-5";
const cwd = process.cwd();
const AGB_HOME = process.env.AGB_HOME ?? path.join(os.homedir(), "workspace", "57b", "agb-eval");
const AGB = [path.join(AGB_HOME, "node_modules", ".bin", "tsx"), path.join(AGB_HOME, "packages", "agb", "src", "run", "cli.ts")];
const PLUGIN = path.join(AGB_HOME, "skills", "dist", "packages", "claude-code");

function refuse(msg) {
  console.error(msg);
  process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
/** agenteval's step id → the agb stage it runs. */
const STAGE = { spec: "spec", architecture: "arch", "task-breakdown": "tasks", "test-design": "test-plan", code: "code" };
const stepId = process.env.EVAL_STEP ?? "";
const stage = STAGE[stepId];
if (!stage) refuse(`unknown step ${JSON.stringify(stepId)} (expected one of ${Object.keys(STAGE).join(", ")})`);
if (withSkill && !existsSync(path.join(PLUGIN, ".claude", "commands", `agb-${stage}.md`))) {
  refuse(`agb's Claude Code plugin has no /agb-${stage} command at ${PLUGIN} (build agb's skills in AGB_HOME)`);
}
if (!/^claude-/.test(model)) refuse("this task runs Claude models only (the subscription)");

// A clean claude config per trial: no personal MCP servers, plugins, global
// rules, hooks or memory. Only the subscription token crosses over: the
// agent has a whole shell, and every other key here would be its to read.
const claudeHome = mkdtempSync(path.join(os.tmpdir(), "agb-skill-claude-"));
// This machine has a global `agb` on PATH (~/.local/bin, the developer's own
// checkout, not AGB_HOME). Shadow it, and ab-gate, for both arms: the skill
// arm reaches the pinned agb whichever name it calls; the no-skill arm has none.
const shimBin = path.join(claudeHome, "bin");
mkdirSync(shimBin, { recursive: true });
// Claude Code drops CLAUDE_CODE_OAUTH_TOKEN from its Bash tool's environment,
// so an `agb run` the session starts would spawn executors that are not logged
// in (agb-skill-ablation 2026-11-17: every skill-arm code trial's agb run failed
// "Not logged in" and the supervising session wrote the code itself). The agb
// shims put the token back from a file outside the workspace.
const tokenFile = path.join(claudeHome, "oauth-token");
writeFileSync(tokenFile, process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "", { mode: 0o600 });
const agbShim = `#!/bin/sh\nCLAUDE_CODE_OAUTH_TOKEN="$(cat ${JSON.stringify(tokenFile)})"; export CLAUDE_CODE_OAUTH_TOKEN\nexec ${JSON.stringify(AGB[0])} ${JSON.stringify(AGB[1])} "$@"\n`;
for (const name of ["agb", "ab-gate"]) {
  const body = withSkill && name === "agb"
    ? agbShim
    : `#!/bin/sh\necho "${name}: not available in this run" >&2\nexit 127\n`;
  writeFileSync(path.join(shimBin, name), body, { mode: 0o755 });
}
const SECRETS = ["OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRETS.includes(k) || k === "CLAUDE_CODE_OAUTH_TOKEN")),
  CLAUDE_CONFIG_DIR: claudeHome,
  PATH: `${shimBin}${path.delimiter}${process.env.PATH ?? ""}`,
  npm_config_cache: path.join(claudeHome, "npm-cache"),
  // Whole builds run for hours: waiting out a usage window beats throwing the build away.
  AB_USAGE_WAIT_MAX_H: "6",
};
if (!env.CLAUDE_CODE_OAUTH_TOKEN) refuse("a Claude model needs CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`, put it in .env.local)");

function run(cmd, args, timeoutMin) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: ["ignore", "inherit", "inherit"], timeout: timeoutMin * MINUTES });
  if (r.error && r.error.code !== "ETIMEDOUT") throw r.error;
  return r.error ? 124 : (r.status ?? 1);
}
const git = (...a) => run("git", ["-c", "user.name=agentic-evaluator", "-c", "user.email=eval@localhost", ...a], 2);
const readJson = (file) => JSON.parse(readFileSync(path.join(cwd, file), "utf-8"));
const writeJson = (file, value) => writeFileSync(path.join(cwd, file), JSON.stringify(value, null, 2) + "\n");

// ── Starting state, identical for both arms ─────────────────────────────
// agb's model slots: the candidate writes, the fixed auditor checks, the load
// test and the security review are off (as in agb-flow-v3's code step). The
// no-skill arm never reads this file; writing it in both keeps the trees equal.
const rc = readJson(".abrc.json");
writeJson(".abrc.json", {
  ...rc,
  models: { spec: model, coding: model, escalation: model },
  review: { ...rc.review, model },
  verifier: { ...rc.verifier, model: AUDITOR },
  audit: { ...rc.audit, model: AUDITOR },
  seam: { ...rc.seam, model: AUDITOR },
  securityReview: { ...rc.securityReview, enabled: false, model },
  load: { ...rc.load, enabled: false },
});
// The command runs `./.ab/bin/agb`; a project agb installed has it, a fixture does not.
if (withSkill) {
  const shim = path.join(cwd, ".ab", "bin", "agb");
  mkdirSync(path.dirname(shim), { recursive: true });
  writeFileSync(shim, agbShim, { mode: 0o755 });
}
// The whole shell for both arms (claude honours this in an untrusted dir).
mkdirSync(path.join(cwd, ".claude"), { recursive: true });
writeJson(".claude/settings.local.json", { permissions: { allow: ["Bash"] } });
git("init", "-q");
writeFileSync(path.join(cwd, ".git", "info", "exclude"), ".ab/bin/\n.claude/\n");
git("add", "-A");
git("commit", "-q", "-m", `agb-skill-ablation: ${stepId} starts`);

// ── Prompts ─────────────────────────────────────────────────────────────
/** agb-flow-v3's planning note, verbatim. */
const UNATTENDED_PLAN =
  "这是一次无人值守的评测运行：会话里没有人，不会有人回答，也不要停下来等。" +
  "需要问人的问题按 asking 的「全部按推荐」处理：有推荐项的按推荐落（answeredBy 写 \"eval-operator\"）；" +
  "没有推荐、要人给取值或密钥的，登记进 .ab/questions.json 留空，继续把这一阶段做完。" +
  "只做这一个阶段，收尾按 converging 收敛门禁并提交。";
const UNATTENDED_CODE =
  "这是一次无人值守的评测运行：会话里没有人，不会有人回答，也不要停下来等。" +
  "需要问人的问题按 asking 的「全部按推荐」处理：有推荐项的按推荐落（answeredBy 写 \"eval-operator\"）；" +
  "没有推荐、要人给取值或密钥的，登记进 .ab/questions.json 留空，继续做。" +
  "把整份任务清单做完，收尾按 converging 收敛门禁并提交。";
const UNATTENDED_NONE_CODE = "这是一次无人值守的评测运行：会话里没有人，不会有人回答，也不要停下来等。拿不准的按最合理的理解做，并在 README 里写明。";
// Planning steps keep open questions where the next stage reads them, not in a README.
const UNATTENDED_NONE_PLAN = "这是一次无人值守的评测运行：会话里没有人，不会有人回答，也不要停下来等。拿不准的登记进 .ab/questions.json：有推荐答案就按推荐落，继续做完这一步。";
/** The spec stage names the client's documents (fixture: docs/prd-source/) and any prototype. */
function sources() {
  const dir = path.join(cwd, "docs", "prd-source");
  const docs = existsSync(dir) ? readdirSync(dir).map((f) => `docs/prd-source/${f}`) : [];
  if (docs.length === 0) refuse("the spec step's fixture has no docs/prd-source/: nothing to normalize");
  const prototypes = existsSync(path.join(cwd, "docs")) ? readdirSync(path.join(cwd, "docs")).filter((f) => /\.html?$/.test(f)).map((f) => `docs/${f}`) : [];
  return { docs, prototypes };
}
/** agb-flow-v3's stageCommand, verbatim. */
function skillPrompt() {
  if (stage !== "spec") return `/agb-skills:agb-${stage} --accept-recommended`;
  const { docs, prototypes } = sources();
  return `/agb-skills:agb-spec --accept-recommended 需求原文在 ${docs.join("、")}` + (prototypes.length ? `；原型在 ${prototypes.join("、")}` : "");
}
const ONLY_THIS = "只做这一步，不要写代码。完成后提交。";
function nonePrompt() {
  const contract = () => readFileSync(path.join(HERE, "contracts", `${stepId}.md`), "utf-8");
  switch (stage) {
    case "spec": {
      const { docs, prototypes } = sources();
      return `把客户的需求原文规范化成一份 PRD。需求原文在 ${docs.join("、")}` + (prototypes.length ? `；原型在 ${prototypes.join("、")}` : "") + `。${ONLY_THIS}\n\n${contract()}`;
    }
    case "arch":
      return `PRD 已经定稿（docs/PRD.md、.ab/prd.json）。为它做系统设计：API 契约、设计决策和系统组成。${ONLY_THIS}\n\n${contract()}`;
    case "tasks":
      return `PRD、系统设计和 API 契约已经定稿（docs/PRD.md、.ab/prd.json、docs/DESIGN.md、_contracts/）。把项目拆成可以逐个实现的任务计划，并写界面锚点约定。${ONLY_THIS}\n\n${contract()}`;
    case "test-plan":
      return `PRD 和任务计划已经定稿（docs/PRD.md、.ab/prd.json、.ab/tasks.json、UI_CONTRACT.md）。写验收测试计划。${ONLY_THIS}\n\n${contract()}`;
    default:
      return PROMPT_NONE_CODE;
  }
}
const PROMPT_NONE_CODE =
  "这是一个已经规划好的项目：docs/PRD.md（需求）、docs/DESIGN.md 与 _contracts/（设计和 API 契约）、" +
  "UI_CONTRACT.md（界面锚点）、.ab/tasks.json（任务清单）、.ab/test-plan.json（验收测试计划）。" +
  "把整份任务清单实现出来：写代码和测试，让验收测试计划里的测试都通过，能用 README 里写的命令起起来。完成后提交。";

// ── Sessions ────────────────────────────────────────────────────────────
const used = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
let spentUsd = 0;
let usageLimited = false;

/** One claude session; its stream is appended to the trace. Returns true when it ended cleanly. */
let traceText = "";
const writeTrace = () => writeFileSync(path.join(cwd, ".eval-trace.jsonl"), traceText);

function session(prompt) {
  const budget = Math.max(1, Math.round((cap - spentUsd) * 100) / 100);
  const r = spawnSync("claude", [
    "-p", prompt,
    "--output-format", "stream-json", "--verbose",
    "--model", model,
    "--max-budget-usd", String(budget),
    ...(withSkill ? ["--plugin-dir", PLUGIN, "--add-dir", PLUGIN] : []),
    "--append-system-prompt", stage === "code" ? (withSkill ? UNATTENDED_CODE : UNATTENDED_NONE_CODE) : (withSkill ? UNATTENDED_PLAN : UNATTENDED_NONE_PLAN),
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Skill", "Bash",
  ], { cwd, env, encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 512 * 1024 * 1024 });
  const stdout = r.stdout ?? "";
  // Kept in memory and rewritten whole: the build's own git housekeeping can
  // delete an untracked file mid-trial (2026-11-18: opus-skill invoice lost it).
  traceText += stdout.endsWith("\n") || stdout === "" ? stdout : stdout + "\n";
  writeTrace();
  const events = stdout.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
  // A session whose background work finishes after its reply prints one result
  // per turn: each carries that turn's usage, total_cost_usd is cumulative.
  const results = events.filter((e) => e?.type === "result");
  const out = results[results.length - 1];
  if (!out) {
    console.error(`claude printed no result: ${stdout.slice(-1000)}`);
    return false;
  }
  if (/hit your .{0,40}limit|usage limit reached/i.test(String(out.result ?? ""))) {
    console.error(`usage-limit: ${String(out.result).slice(0, 200)}`);
    usageLimited = true;
  }
  for (const { usage: u = {} } of results) {
    used.input += u.input_tokens ?? 0;
    used.output += u.output_tokens ?? 0;
    used.cacheRead += u.cache_read_input_tokens ?? 0;
    used.cacheWrite += u.cache_creation_input_tokens ?? 0;
  }
  spentUsd += typeof out.total_cost_usd === "number" ? out.total_cost_usd : 0;
  console.log(`claude: ${out.subtype ?? "?"}, ${out.num_turns ?? "?"} turns. ${String(out.result ?? "").slice(0, 1500)}`);
  return r.status === 0 && out.is_error !== true;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
const stopState = () => (existsSync(path.join(cwd, ".ab", "run", "stop.json")) ? readJson(".ab/run/stop.json") : null);

/** A detached agb run the session left behind: wait for it, bounded by the trial's own time limit. */
function waitForAgbRun() {
  for (;;) {
    const s = stopState();
    if (!s || s.state !== "running" || typeof s.pid !== "number" || !alive(s.pid)) return;
    spawnSync("sleep", ["30"]);
  }
}

/** Every planned task completed (a small project's single session is one synthesized T-000). */
function planDone() {
  const planned = (readJson(".ab/tasks.json").domains ?? []).flatMap((d) => (d.tasks ?? []).map((t) => t.id));
  const statePath = path.join(cwd, ".ab", "run", "state.json");
  const completed = new Set(existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf-8")).completedTasks ?? [] : []);
  return planned.length > 0 && (planned.every((id) => completed.has(id)) || [...completed].some((id) => /^T-0*0$/.test(id)));
}

/** Tokens of the sessions agb run started; added once, at the end. */
function agbTokens() {
  const events = path.join(cwd, ".ab", "events.jsonl");
  if (!existsSync(events)) return;
  const ends = readFileSync(events, "utf-8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e?.type === "task.end");
  for (const e of ends) {
    used.input += e.inputTokens ?? 0;
    used.output += e.outputTokens ?? 0;
    used.cacheRead += e.cacheReadTokens ?? 0;
    used.cacheWrite += e.cacheCreationTokens ?? 0;
  }
  if (ends.some((e) => typeof e.inputTokens !== "number")) console.error("some agb sessions reported no tokens: the cost is a lower bound");
}

let status = 1;
try {
  if (!withSkill) {
    status = session(nonePrompt()) ? 0 : 1;
  } else if (stage !== "code") {
    status = session(skillPrompt()) ? 0 : 1;
  } else {
    let ok = false;
    for (let n = 1; n <= MAX_SESSIONS && !usageLimited; n++) {
      ok = session(skillPrompt());
      waitForAgbRun();
      if (planDone() && stopState()?.state !== "running") break;
      if (n < MAX_SESSIONS) console.log(`plan not finished after session ${n}: opening /agb-code again`);
    }
    agbTokens();
    // The held-out tests decide; this only says whether the build ran to the end.
    status = planDone() ? 0 : ok ? 0 : 1;
  }
  if (usageLimited) status = 75;
  writeJson(".eval-usage.json", {
    prompt_tokens: used.input, completion_tokens: used.output, cache_read_tokens: used.cacheRead, cache_write_tokens: used.cacheWrite,
  });
} finally {
  if (traceText) writeTrace();
  if (stage === "code") {
    // A trial must not leave compose services up: the grader brings up its own.
    for (const f of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"]) {
      if (existsSync(path.join(cwd, f))) { run("docker", ["compose", "-f", f, "down", "-v", "--remove-orphans"], 3); break; }
    }
    // Nor a dev server it left running (a vite on 5173 failed every later build's
    // grade, 2026-11-17): stop every process whose working directory is in the tree.
    const cwds = spawnSync("lsof", ["-a", "-d", "cwd", "-Fpn"], { encoding: "utf-8" }).stdout ?? "";
    const tree = realpathSync(cwd); // lsof reports /private/var/…, not /var/…
    let pid = 0;
    for (const line of cwds.split("\n")) {
      if (line.startsWith("p")) pid = Number(line.slice(1));
      else if (line.startsWith("n") && pid !== process.pid && (line.slice(1) === tree || line.slice(1).startsWith(tree + path.sep))) {
        try { process.kill(pid, "SIGTERM"); console.error(`stopped pid ${pid} left running in ${line.slice(1)}`); } catch {}
      }
    }
    for (const p of ["server/dist", "client/dist", "dist"]) rmSync(path.join(cwd, p), { recursive: true, force: true });
  }
  rmSync(claudeHome, { recursive: true, force: true });
}
process.exit(status);
