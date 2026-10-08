#!/usr/bin/env node
/**
 * Required check: did Harbor's verifier reward the candidate?
 *
 * Reads harbor-trial.json (a Harbor trial's result.json) from the work dir.
 *
 *   reward >= HARBOR_REWARD_THRESHOLD (default 1)  → exit 0, pass
 *   reward below it                                 → exit 1, the candidate failed
 *   no reward because the agent ran out of time or
 *   exited non-zero                                 → exit 1, the candidate failed
 *   no result, or no reward for any other reason    → exit 2, evaluator error
 *
 * Harbor's own mean counts a missing reward as 0, so an environment that
 * never came up looks like an agent that failed. Here it never does.
 */
import fs from "node:fs";

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_EVALUATOR_ERROR = 2;
const threshold = Number(process.env.HARBOR_REWARD_THRESHOLD ?? "1");
// Harbor exceptions that are the candidate's own doing. Everything else
// (auth, agent setup, environment start, verifier timeout) is ours.
const CANDIDATE_EXCEPTIONS = new Set(["AgentTimeoutError", "NonZeroAgentExitCodeError"]);

function finish(code, evidence, reason) {
  process.stdout.write(JSON.stringify({ evidence, ...(reason ? { reason } : {}) }));
  process.exit(code);
}

let trial;
try {
  trial = JSON.parse(fs.readFileSync("harbor-trial.json", "utf8"));
} catch (err) {
  finish(EXIT_EVALUATOR_ERROR, `no readable harbor-trial.json: ${err.message}`, "harbor produced no trial result");
}

const exception = trial.exception_info ?? null;
const exceptionType = exception?.exception_type ?? null;
const rewards = trial.verifier_result?.rewards ?? null;
const reward = typeof rewards?.reward === "number" ? rewards.reward : null;
const usage = trial.agent_result ?? {};
const evidence = [
  `task=${trial.task_name} agent=${trial.agent_info?.name} model=${trial.agent_info?.model_info?.name ?? "-"}`,
  `rewards=${JSON.stringify(rewards)}`,
  `exception=${exceptionType ?? "none"}`,
  `harbor-reported cost_usd=${usage.cost_usd ?? "null"} tokens in/out=${usage.n_input_tokens ?? "null"}/${usage.n_output_tokens ?? "null"}`,
].join("\n");

if (reward === null) {
  if (CANDIDATE_EXCEPTIONS.has(exceptionType)) finish(EXIT_FAIL, evidence, `agent error: ${exceptionType}`);
  finish(EXIT_EVALUATOR_ERROR, evidence, `no reward (${exceptionType ?? "verifier wrote none"})`);
}
if (reward >= threshold) finish(EXIT_PASS, evidence);
finish(EXIT_FAIL, evidence, `reward ${reward} < ${threshold}`);
