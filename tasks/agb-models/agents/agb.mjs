#!/usr/bin/env node
/**
 * One agb step, run with one model.
 *
 *   node agents/agb.mjs <model>
 *
 * The input's header says what to do (written by scripts/harvest.mjs):
 *
 *   stage: detail | code
 *   fixture: <dir under fixture/>
 *   task: T-003                      (code only)
 *
 * The work dir starts empty; this lays the fixture down, sets all three of
 * agb's model slots to <model>, makes it a clean git repo and runs the step:
 *
 *   detail  `claude -p` with the stage-detail skill — the stage has no agb CLI
 *           command by design, it is driven by the skill in the host
 *   code    `agb run` on a plan cut down to this one task. The earlier tasks'
 *           code is already in the snapshot, so the task's dependencies are met.
 *
 * Spend is capped here: an agent candidate's cost is not visible to the harness.
 * `AGB_EVAL_DRY=1` sets everything up and stops before any executor runs.
 */

import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_COST = { detail: 10, code: 10 };
const here = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const model = process.argv[2];
const dry = process.env.AGB_EVAL_DRY === "1";

const header = Object.fromEntries(
  [...readFileSync(path.join(cwd, ".eval-input.txt"), "utf-8").matchAll(/^(stage|fixture|task):\s*(\S+)/gm)].map((m) => [m[1], m[2]]),
);
if (!model || !(header.stage in MAX_COST) || !header.fixture || (header.stage === "code" && !header.task)) {
  console.error("usage: agb.mjs <model>; the input needs stage: detail|code, fixture: <dir>, and task: T-NNN for code");
  process.exit(2);
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

function json(file, update) {
  const p = path.join(cwd, file);
  const next = update(JSON.parse(readFileSync(p, "utf-8")));
  writeFileSync(p, JSON.stringify(next, null, 2) + "\n");
}

cpSync(path.resolve(here, "..", "fixture", header.fixture), cwd, { recursive: true });
// All three slots: one model end to end, not "this one, and opus when it escalates".
json(".abrc.json", (rc) => ({ ...rc, models: { spec: model, coding: model, escalation: model } }));

if (header.stage === "code") {
  // Keep only this task, in its own domain. Its dependencies were done by
  // earlier commits, so they are already in the code, not in the plan.
  json(".ab/tasks.json", (plan) => ({
    ...plan,
    domains: plan.domains
      .map((d) => ({
        ...d,
        dependsOn: [],
        tasks: (d.tasks ?? []).filter((t) => t.id === header.task).map((t) => ({ ...t, dependsOn: [] })),
      }))
      .filter((d) => d.tasks.length > 0),
  }));
}

run("git", ["init", "-q"]);
run("git", ["add", "-A"]);
run("git", ["-c", "user.name=agentic-evaluator", "-c", "user.email=eval@localhost", "commit", "-q", "-m", `fixture: ${header.fixture}`]);

const DETAIL_PROMPT =
  "用 stage-detail skill 完成这个项目的详设与任务拆解阶段。输入在 docs/PRD.md、docs/DESIGN.md 与 _contracts/；" +
  "按 skill 的要求产出 .ab/tasks.json 与 UI_CONTRACT.md。只做这一个阶段，不要写代码，不要写测试。" +
  "遇到需要问人的地方，按最合理的假设继续，并把假设写进产物。";

let status;
try {
  if (dry) {
    status = header.stage === "code" ? run("agb", ["run", "--dry-run"]) : 0;
  } else if (header.stage === "code") {
    status = run("agb", ["run", `--max-cost=${MAX_COST.code}`]);
  } else {
    status = run("claude", [
      "-p", DETAIL_PROMPT,
      "--model", model,
      "--max-budget-usd", String(MAX_COST.detail),
      "--permission-mode", "acceptEdits",
      "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Skill", "Bash(ls:*)",
    ]);
  }
} finally {
  // The harness reads back every file left here as text; git objects and
  // build output are not the deliverable.
  for (const p of [".git", "server/data", "server/dist", "client/dist"]) rmSync(path.join(cwd, p), { recursive: true, force: true });
}
process.exit(status);
