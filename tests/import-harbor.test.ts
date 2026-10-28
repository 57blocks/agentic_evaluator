/**
 * A finished Harbor job reads as a task with one run: Harbor's verdicts as
 * check results, its exceptions as completion states, its trajectories as
 * traces — and a missing reward as an evaluator error, never a failure.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { candidateIdOf, importHarborJob, rewardVerdict, type HarborTrial } from "../src/core/import-harbor.js";
import { loadSpec } from "../src/spec/load-spec.js";
import type { TrialRow } from "../src/canon/rows.js";

const ATIF = path.resolve("tests/fixtures/agent-traces/atif-terminus-fix-git.json");

function trial(over: Partial<HarborTrial> & { agent: string; model?: string | null; task: string }): HarborTrial {
  const { agent, model = null, task, ...rest } = over;
  return {
    task_name: task,
    trial_name: `${task}__x`,
    started_at: "2026-10-27T02:11:47.000Z",
    finished_at: "2026-10-27T02:14:15.000Z",
    agent_execution: { started_at: "2026-10-27T02:12:16.000Z", finished_at: "2026-10-27T02:12:59.000Z" },
    agent_info: { name: agent, model_info: model ? { name: model, provider: "openrouter" } : null },
    agent_result: { n_input_tokens: 100, n_cache_tokens: 50, n_output_tokens: 20, cost_usd: 0.01 },
    verifier_result: { rewards: { reward: 1 } },
    exception_info: null,
    config: { agent: { name: agent, model_name: model }, environment: { type: "docker" } },
    ...rest,
  };
}

/** A job dir: <jobs>/<job>/<trial>/result.json, plus the job's own result.json that is not a trial. */
async function jobDir(trials: readonly HarborTrial[], withTrajectoryFor: readonly string[] = []): Promise<string> {
  const jobs = await fs.mkdtemp(path.join(os.tmpdir(), "harbor-jobs-"));
  const job = path.join(jobs, "2026-10-27__14-22-13");
  await fs.mkdir(job, { recursive: true });
  await fs.writeFile(path.join(job, "result.json"), JSON.stringify({ id: "job", n_trials: trials.length }));
  for (const [i, t] of trials.entries()) {
    const dir = path.join(job, `${t.trial_name}-${i}`);
    await fs.mkdir(path.join(dir, "agent"), { recursive: true });
    await fs.writeFile(path.join(dir, "result.json"), JSON.stringify(t));
    if (withTrajectoryFor.includes(t.trial_name!)) await fs.copyFile(ATIF, path.join(dir, "agent", "trajectory.json"));
  }
  return jobs;
}

const rows = async (runDir: string): Promise<TrialRow[]> =>
  (await fs.readFile(path.join(runDir, "scores.jsonl"), "utf-8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as TrialRow);

test("candidate ids name the agent and its model; the reward rule matches the spike's check", () => {
  assert.equal(candidateIdOf(trial({ agent: "terminus-2", model: "openrouter/anthropic/claude-sonnet-5", task: "fix-git" })), "terminus-2--anthropic-claude-sonnet-5");
  assert.equal(candidateIdOf(trial({ agent: "oracle", task: "fix-git" })), "oracle");
  // A custom agent is asked for by import path; it names itself in agent_info.
  const custom = trial({ agent: "claude-code", model: "anthropic/claude-sonnet-5", task: "fix-git", config: { agent: { name: "cached_claude_code:CachedClaudeCode", model_name: "anthropic/claude-sonnet-5" }, environment: { type: "docker" } } });
  assert.equal(candidateIdOf(custom), "claude-code--anthropic-claude-sonnet-5");
  assert.equal(rewardVerdict(trial({ agent: "a", task: "t" }), 1).state, "pass");
  assert.equal(rewardVerdict(trial({ agent: "a", task: "t", verifier_result: { rewards: { reward: 0.5 } } }), 1).state, "fail");
  assert.equal(rewardVerdict(trial({ agent: "a", task: "t", verifier_result: { rewards: { reward: 0.5 } } }), 0.5).state, "pass");
  const missing = rewardVerdict(trial({ agent: "a", task: "t", verifier_result: null }), 1);
  assert.equal(missing.state, "evaluator_error");
  const timedOut = rewardVerdict(trial({ agent: "a", task: "t", verifier_result: null, exception_info: { exception_type: "AgentTimeoutError" } }), 1);
  assert.equal(timedOut.state, "fail");
});

test("a job imports as a runnable task with one run; states, costs and traces carried over", async () => {
  // Arrange - two agents on two tasks; one trial timed out, one lost its reward, one has a trajectory.
  const jobs = await jobDir(
    [
      trial({ agent: "terminus-2", model: "openrouter/anthropic/claude-sonnet-5", task: "fix-git", trial_name: "fix-git__a" }),
      trial({ agent: "terminus-2", model: "openrouter/anthropic/claude-sonnet-5", task: "hello-world", trial_name: "hello-world__a", verifier_result: { rewards: { reward: 0 } } }),
      trial({ agent: "oracle", task: "fix-git", trial_name: "fix-git__o", agent_result: null }),
      trial({ agent: "oracle", task: "hello-world", trial_name: "hello-world__o", agent_result: null, verifier_result: null, exception_info: { exception_type: "VerifierTimeoutError", exception_message: "verifier took too long" } }),
      trial({ agent: "nop", task: "fix-git", trial_name: "fix-git__n", agent_result: null, verifier_result: null, exception_info: { exception_type: "AgentTimeoutError" } }),
    ],
    ["fix-git__a"],
  );
  const into = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "import-")), "tasks", "tb-import");

  // Act
  const result = await importHarborJob(jobs, { into, mode: "highest-assurance" });

  // Assert - the task is a loadable spec with the spike's files beside it.
  const suite = await loadSpec(path.join(into, "spec.yaml"));
  assert.deepEqual([...suite.candidates].sort(), ["nop", "oracle", "terminus-2--anthropic-claude-sonnet-5"]);
  assert.deepEqual(suite.inputs, ["fix-git", "hello-world"]);
  for (const f of ["agents/harbor-run.sh", "checks/reward.mjs", "rubrics/harbor.md", "inputs/fix-git.txt"]) await fs.access(path.join(into, f));
  assert.equal(result.trials, 5);

  // Assert - the run's rows say what Harbor said, in agenteval's terms.
  const trials = await rows(result.runDir);
  const by = (c: string, i: string) => trials.find((t) => t.candidate === c && t.input === i)!;
  const sonnetFix = by("terminus-2--anthropic-claude-sonnet-5", "fix-git");
  assert.equal(sonnetFix.task_outcome, "success");
  assert.equal(sonnetFix.checks["harbor-reward"].state, "pass");
  assert.deepEqual(sonnetFix.cost, { generation: 0.01, retry: 0, source: "estimated" });
  assert.equal(sonnetFix.tokens.prompt, 150);
  assert.equal(sonnetFix.isolation, "docker");
  assert.equal(sonnetFix.ms, 43_000);
  assert.equal(sonnetFix.agent?.turns, 10, "the trajectory was read");
  await fs.access(path.join(result.runDir, "traces", "terminus-2--anthropic-claude-sonnet-5__fix-git__t0.json"));

  assert.equal(by("terminus-2--anthropic-claude-sonnet-5", "hello-world").task_outcome, "failure", "reward 0 is a failure");
  const oracleFix = by("oracle", "fix-git");
  assert.equal(oracleFix.cost.source, "none", "no agent_result: cost unobserved, not $0");
  assert.equal(oracleFix.agent, null);

  const lostReward = by("oracle", "hello-world");
  assert.equal(lostReward.completion_state, "provider_error", "a verifier timeout is Harbor's, not the candidate's");
  assert.equal(lostReward.checks["harbor-reward"].state, "evaluator_error");
  assert.equal(lostReward.task_outcome, "undetermined");

  const timedOut = by("nop", "fix-git");
  assert.equal(timedOut.completion_state, "timeout");
  assert.equal(timedOut.task_outcome, "failure");

  // Assert - the pick came out of the ordinary selection: highest assurance
  // ranks oracle (1/1; its lost reward is Harbor's error, not oracle's) over
  // terminus (1/2, hello-world failed). The imported spec gates nothing.
  assert.equal(result.chosen, "oracle");
  assert.match(await fs.readFile(path.join(result.runDir, "GAPS.md"), "utf-8"), /imported from Harbor/);
  // An imported trial is never served to a real run of the task as its own.
  assert.ok(trials.every((t) => t.trial_hash.length === 64));
});

test("an existing task dir is refused without --force; an empty job dir is refused", async () => {
  const into = await fs.mkdtemp(path.join(os.tmpdir(), "exists-"));
  const jobs = await jobDir([trial({ agent: "oracle", task: "t" })]);
  await assert.rejects(importHarborJob(jobs, { into }), /exists/);
  await assert.rejects(importHarborJob(await fs.mkdtemp(path.join(os.tmpdir(), "empty-")), { into: path.join(into, "x") }), /no Harbor trial/);
});

test("a job whose names could escape the task dir or break the spec is refused", async () => {
  const into = () => path.join(os.tmpdir(), `import-${Math.random().toString(36).slice(2)}`);
  await assert.rejects(importHarborJob(await jobDir([trial({ agent: "oracle", task: "../evil" })]), { into: into() }), /task_name "\.\.\/evil" is not a plain name/);
  await assert.rejects(importHarborJob(await jobDir([trial({ agent: "x; rm -rf /", task: "t" })]), { into: into() }), /agent name .* is not a plain name/);
  await assert.rejects(importHarborJob(await jobDir([trial({ agent: "a", model: 'm"]\n  - id: injected', task: "t" })]), { into: into() }), /model name .* is not a plain name/);
  // Names with the characters Harbor really uses round-trip through the spec.
  const ok = await importHarborJob(await jobDir([trial({ agent: "claude-code", model: "openrouter/anthropic/claude-sonnet-5:beta", task: "fix-git.v2" })]), { into: into() });
  const suite = await loadSpec(path.join(ok.taskDir, "spec.yaml"));
  assert.deepEqual(suite.inputs, ["fix-git.v2"]);
  assert.deepEqual(suite.candidateDefs?.[suite.candidates[0]!]?.cli?.argv.slice(2, 4), ["claude-code", "openrouter/anthropic/claude-sonnet-5:beta"]);
});
