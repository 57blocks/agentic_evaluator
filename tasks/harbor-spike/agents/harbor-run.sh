#!/usr/bin/env bash
# Candidate: run one Terminal-Bench task through Harbor, keep only the verdict.
#
#   bash agents/harbor-run.sh <harbor-agent> <model or ""> <task-name>
#
# Harbor builds the task's container, runs the agent in it, then runs the
# task's verifier. Its job dir (logs, trajectories) goes to a temp dir; only
# the trial's result.json is copied here as harbor-trial.json, because the
# harness reads every file left in the work dir as the candidate's output.
#
# HARBOR_VIA_OPENROUTER=1 points Claude Code inside the container at
# OpenRouter's Anthropic-compatible endpoint with OPENROUTER_API_KEY, so a
# claude-code candidate needs no Anthropic key.
#
# HARBOR_SPIKE_DROP_RESULT=1 discards the result, to show that a missing
# reward is recorded as an evaluator error, not the candidate's failure.
set -uo pipefail

AGENT="$1"
MODEL="$2"
TASK="$(printf '%s' "$3" | tr -d '[:space:]')"
HARBOR_VERSION="${HARBOR_VERSION:-0.24.0}"
DATASET="${HARBOR_DATASET:-terminal-bench@2.0}"
# Installing an agent CLI inside a fresh container can outlast Harbor's
# default setup limit (360s); a setup timeout is infra, not the candidate.
SETUP_TIMEOUT_MULTIPLIER="${HARBOR_SETUP_TIMEOUT_MULTIPLIER:-3}"

if [ "${HARBOR_VIA_OPENROUTER:-0}" = "1" ]; then
  export ANTHROPIC_BASE_URL="https://openrouter.ai/api"
  export ANTHROPIC_AUTH_TOKEN="${OPENROUTER_API_KEY:?OPENROUTER_API_KEY is not set}"
  export ANTHROPIC_API_KEY=""
fi

JOBS="$(mktemp -d)"
MODEL_ARGS=()
[ -n "$MODEL" ] && MODEL_ARGS=(-m "$MODEL")

uvx --from "harbor==${HARBOR_VERSION}" harbor run \
  -d "$DATASET" -i "$TASK" -a "$AGENT" ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
  --agent-setup-timeout-multiplier "$SETUP_TIMEOUT_MULTIPLIER" \
  -n 1 -o "$JOBS" -y -q
STATUS=$?

TRIAL_RESULT="$(find "$JOBS" -mindepth 3 -maxdepth 3 -name result.json | head -1)"
if [ -n "$TRIAL_RESULT" ] && [ "${HARBOR_SPIKE_DROP_RESULT:-0}" != "1" ]; then
  cp "$TRIAL_RESULT" harbor-trial.json
  # Harbor's ATIF trajectory of the agent's run, when the agent wrote one
  # (oracle and nop do not). Kept as the trace the harness will read.
  TRAJECTORY="$(dirname "$TRIAL_RESULT")/agent/trajectory.json"
  [ -f "$TRAJECTORY" ] && cp "$TRAJECTORY" .eval-trace.json
  # Hand Harbor's own spend figure to the harness (read because the spec
  # declares reports_usage; recorded as an estimate). The agent ran inside
  # Harbor's container and cannot write this work dir. An agent that reports
  # nothing (oracle, nop) leaves no file and its cost stays unobserved.
  node -e '
    const r = require("./harbor-trial.json").agent_result ?? {};
    if (typeof r.cost_usd !== "number") process.exit(0);
    require("fs").writeFileSync(".eval-usage.json", JSON.stringify({
      cost_usd: r.cost_usd,
      prompt_tokens: r.n_input_tokens ?? 0,
      completion_tokens: r.n_output_tokens ?? 0,
    }));
  '
fi
echo "harbor exit=${STATUS} agent=${AGENT} task=${TASK} jobs=${JOBS}"
