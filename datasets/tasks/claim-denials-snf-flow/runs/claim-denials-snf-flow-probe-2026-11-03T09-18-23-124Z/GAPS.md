# GAPS — what this workflow run could not observe

Collected from every step plus the end-to-end pass. Each step directory keeps its own GAPS.md.

## Every step

- `ttft_ms`: non-streaming calls; no time to first token.
- `cache`: the provider reported cached prompt tokens on some calls; recorded under `tokens.cached`, no cache cost breakdown.
- `human_intervention`: not observed; no trace format read here says whether the agent waited on a person.
- `tool_calls`, turns: not observed; no candidate declared `cli.trace`, so what the agents did between input and output is not recorded.
- `checkpoint`: not observed; no trace format read here says whether the agent resumed from one.
- transport retry: model-API calls retry transient failures (HTTP 408/409/425/429, 5xx, network) twice with exponential backoff and no jitter; per-trial retry counts are not in scores.jsonl, only retry cost.
- evaluator errors: none in this run.
- absolute 1–5 scoring: **not run** — the spec declares `methods` without `absolute-1-5`. Magnitude is therefore not observed at all in this run; the empty score columns are a declaration, not a failure.
- pairwise judging: **not run** — the spec declares `methods` without `pairwise-swap`. No preference direction is observed in this run.
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector reads the pairwise score only to rank judge-preference, and to break a tie on assurance in highest-assurance.
- statistical uncertainty: the chosen candidate's gated rates carry Wilson 95% intervals, and a highest-assurance pick must beat the runner-up on an exact sign test over inputs (recommendation.json `evidence`). Inputs generated from one template are still treated as independent, which overstates certainty when they share a template.

## Individual steps

- `extract`: generation cost: **not observed** for 1 trial(s) (glm-5.3). These candidates' spend was not reported to the harness, so their cost per success is undefined (null, not $0); ledger `generation` and `total` are lower bounds, and `cost_per_success` / `cost_per_attempt` are null.
- `extract`: `deployment_ref.region / tier`: route plus who served the call (OpenRouter's upstream provider, or the model id a direct API answered with); region and service tier are not exposed.
- `extract`: effective N: 1 of 8 inputs separated any two candidates on task success; 7 every candidate passed, 0 gave everyone the same partial rate. Only the separating inputs carry evidence for a choice (items.json).
- `decide`: generation cost: **not observed** for 2 trial(s) (deepseek-v4-pro, qwen3.8-max). These candidates' spend was not reported to the harness, so their cost per success is undefined (null, not $0); ledger `generation` and `total` are lower bounds, and `cost_per_success` / `cost_per_attempt` are null.
- `decide`: `deployment_ref.region / tier`: route plus who served the call (OpenRouter's upstream provider, or the model id a direct API answered with); region and service tier are not exposed.
- `decide`: effective N: 3 of 8 inputs separated any two candidates on task success; 5 every candidate passed, 0 gave everyone the same partial rate. Only the separating inputs carry evidence for a choice (items.json).
- `deadline`: generation cost: **not observed** for 7 trial(s) (glm-5.3, kimi-k3, qwen3.8-max). These candidates' spend was not reported to the harness, so their cost per success is undefined (null, not $0); ledger `generation` and `total` are lower bounds, and `cost_per_success` / `cost_per_attempt` are null.
- `deadline`: generation cost: **self-reported** by deadline-rules through `.eval-usage.json` (the spec declares `cli.reports_usage`). Recorded as `estimated`; not verified by the harness, so it is only as trustworthy as the command that wrote it.
- `deadline`: `deployment_ref.region / tier`: who served the model is read from the command's trace (`cli/…`), from OpenRouter's upstream provider, or from the model id a direct API answered with; region and service tier are not exposed.
- `deadline`: effective N: 5 of 8 inputs separated any two candidates on task success; 3 every candidate passed, 0 gave everyone the same partial rate. Only the separating inputs carry evidence for a choice (items.json).

## End to end

- verdict `keep-control` is directional; rule e2e-validate-v1.
- not compared: single-configuration workflows other than the declared control
- not compared: the current production workflow
