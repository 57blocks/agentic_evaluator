# Samples

Sample tasks to learn the tool on. Run each by its path from the repository
root — `agenteval run examples/tasks/<name>` — and its runs are written next
to it, under `examples/tasks/<name>/runs/`.

| task | what it shows | cost |
|---|---|---|
| [`custom-check`](tasks/custom-check/spec.yaml) | a required check you write (`kind: command`); any command as a candidate (`adapter: agent-cli`) | free |
| [`chain-offline`](tasks/chain-offline/spec.yaml) | two chained steps (`input_from`) and the end-to-end verdict against a single-model control | free |
| [`agent-pipeline`](tasks/agent-pipeline/spec.yaml) | a Python app's search and summarizer agents: one wrapper for every step, a model picked per agent, frozen findings for the summarizer, tokens and traces reported by the agent, the mix tested end to end ([guide](../docs/evaluate-your-pipeline.md)) | free; needs `python3` |
| [`docker-sandbox`](tasks/docker-sandbox/spec.yaml) | one agent script as two candidates, in a Docker container (`image:`) and on the host; each trial records `isolation: docker` or `none` | free; needs Docker |
| [`compare-models`](tasks/compare-models/spec.yaml) | two OpenRouter models, a deterministic gate plus a pairwise judge | billed, capped at $0.50 |
| [`compare-prompts`](tasks/compare-prompts/spec.yaml) | one model with three prompts on eight changelogs, picked by judge preference | billed, capped at $3 |
| [`compare-agents`](tasks/compare-agents/spec.yaml) | Claude Code, OpenCode and pi build a reactive-signals library, same model; ten behavioural tests gate, the judge ranks | billed by each agent (unseen by the harness); judge capped at $1; runs unsandboxed |
| [`compare-agent-models`](tasks/compare-agent-models/spec.yaml) | the other half: one agent (OpenCode) with sonnet-5, deepseek-v4-pro and kimi-k3 on the same task | billed by OpenRouter (unseen by the harness); judge capped at $1; runs unsandboxed |
| [`compare-setups`](tasks/compare-setups/spec.yaml) | concrete setups head to head, each its own agent and model (Claude Code + sonnet-5, OpenCode + deepseek-v4-pro, pi + kimi-k3) — for choosing, not for attributing | billed by each agent (unseen by the harness); judge capped at $1; runs unsandboxed |

```bash
agenteval run examples/tasks/custom-check --yes --html
agenteval run examples/tasks/chain-offline --yes --html
agenteval run examples/tasks/docker-sandbox --yes --html   # needs Docker
agenteval run examples/tasks/agent-pipeline --yes --html   # needs python3
agenteval plan examples/tasks/compare-models        # free; then run it with --yes
agenteval plan examples/tasks/compare-prompts       # free; then run it with --yes
agenteval plan examples/tasks/compare-agents        # free; read the spec's warnings first
agenteval plan examples/tasks/compare-agent-models  # free; same warnings
agenteval plan examples/tasks/compare-setups        # free; same warnings
```

Each spec's header comment says what to look at. The free tasks declare
`methods: []`, so no judge is called even when a key is configured — `plan`
shows `pairwise off · absolute off` for every step.

For evaluation datasets with answer keys and a finished run each
(claim denials, KYC beneficial owners, contract terms, agb's flow), see
[`datasets/`](../datasets/README.md).

To make your own, copy the closest task into your workspace's `tasks/` and
edit it. The full walkthrough is the [README](../README.md); to evaluate an
app you already have, start from `agent-pipeline` and
[Evaluate your own pipeline](../docs/evaluate-your-pipeline.md).
