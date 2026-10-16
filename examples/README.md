# Samples

Sample tasks to learn the tool on. Run each by its path from the repository
root — `agenteval run examples/tasks/<name>` — and its runs are written next
to it, under `examples/tasks/<name>/runs/`.

| task | what it shows | cost |
|---|---|---|
| [`custom-check`](tasks/custom-check/spec.yaml) | a required check you write (`kind: command`); any command as a candidate (`adapter: agent-cli`) | free |
| [`chain-offline`](tasks/chain-offline/spec.yaml) | two chained steps (`input_from`) and the end-to-end verdict against a single-model control | free |
| [`docker-sandbox`](tasks/docker-sandbox/spec.yaml) | one agent script as two candidates, in a Docker container (`image:`) and on the host; each trial records `isolation: docker` or `none` | free; needs Docker |
| [`compare-models`](tasks/compare-models/spec.yaml) | two OpenRouter models, a deterministic gate plus a pairwise judge | billed, capped at $0.50 |
| [`compare-agents`](tasks/compare-agents/spec.yaml) | Claude Code, OpenCode and pi build a reactive-signals library, same model; ten behavioural tests gate, the judge ranks | billed by each agent (unseen by the harness); judge capped at $1; runs unsandboxed |
| [`compare-agent-models`](tasks/compare-agent-models/spec.yaml) | the other half: one agent (OpenCode) with sonnet-5, deepseek-v4-pro and kimi-k3 on the same task | billed by OpenRouter (unseen by the harness); judge capped at $1; runs unsandboxed |
| [`compare-setups`](tasks/compare-setups/spec.yaml) | concrete setups head to head, each its own agent and model (Claude Code + sonnet-5, OpenCode + deepseek-v4-pro, pi + kimi-k3) — for choosing, not for attributing | billed by each agent (unseen by the harness); judge capped at $1; runs unsandboxed |

```bash
agenteval run examples/tasks/custom-check --yes --html
agenteval run examples/tasks/chain-offline --yes --html
agenteval run examples/tasks/docker-sandbox --yes --html   # needs Docker
agenteval plan examples/tasks/compare-models        # free; then run it with --yes
agenteval plan examples/tasks/compare-agents        # free; read the spec's warnings first
agenteval plan examples/tasks/compare-agent-models  # free; same warnings
agenteval plan examples/tasks/compare-setups        # free; same warnings
```

Each spec's header comment says what to look at. The free tasks declare
`methods: []`, so no judge is called even when a key is configured — `plan`
shows `pairwise off · absolute off` for every step.

## Sample datasets, with a finished run

Golden datasets for the [Agent Evaluation Protocol](https://agent-eval-protocol.vercel.app/#golden)
page's samples, plus agb's own flow. Each ships with one finished run, so its
report opens without paying for a run. The data is synthetic except agb-flow,
whose inputs are snapshots of real agb projects.

| task | what it evaluates | result of the run kept here |
|---|---|---|
| [`claim-denials-snf-v2`](tasks/claim-denials-snf-v2/spec.yaml) | triaging 30 denied Medicare SNF claims from raw 835 codes, with no payer manual: the rules ([RULES.md](tasks/claim-denials-snf-v2/RULES.md), from 42 CFR and CMS manuals) must be known | kimi-k3 28/30, sonnet-5 15/30, glm-5.3 12/30, deepseek-flash 11/30; no model qualifies |
| [`kyc-ubo-v2`](tasks/kyc-ubo-v2/spec.yaml) | finding a company's beneficial owners from 30 German register extracts under § 3 GwG ([RULES.md](tasks/kyc-ubo-v2/RULES.md), from the statute and the BVA FAQ) | kimi-k3 26/30, sonnet-5 25/30, deepseek-flash 23/30, glm-5.3 21/30; no model qualifies |
| [`contract-terms-long`](tasks/contract-terms-long/spec.yaml) | extracting eight terms from ~9,000-word scanned agreement packets with SOW distractors | every model 6/6: the cheapest is enough |
| [`agb-flow`](tasks/agb-flow/spec.yaml) | which model should run each step of agb's flow (task breakdown, test design, code), ten candidates | breakdown fable-5.1, test design opus-5.5, code deepseek-flash (directional) |

```bash
open examples/tasks/claim-denials-snf-v2/runs/*/report.html    # the report as the run wrote it
agenteval dash --workspace examples                            # or browse all four in the dashboard
node examples/tasks/claim-denials-snf-v2/gen/generate.mjs      # rebuild a set (same seed, same files)
agenteval check-task examples/tasks/claim-denials-snf-v2       # free
agenteval run examples/tasks/claim-denials-snf-v2 --yes --html # billed, about $4
```

Each report opens with what the task evaluates and breaks the result down by
input tag (ordinary items, each kind of trap, holdout). agb-flow's inputs live
in its `fixture/`; running it needs agb and keys for every provider, and the
run kept here cost about $300.

To make your own, copy the closest task into your workspace's `tasks/` and
edit it. The full walkthrough is the [README](../README.md).
