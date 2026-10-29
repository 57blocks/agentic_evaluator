# GAPS — fields the protocol wants that this run did not observe

Every field below is recorded as `null` or `not_applicable`, never defaulted to a measured-looking value.

- generation cost: **not observed** for 1 trial(s) (kimi-k3). These candidates' spend was not reported to the harness, so their cost per success is undefined (null, not $0); ledger `generation` and `total` are lower bounds, and `cost_per_success` / `cost_per_attempt` are null.
- `ttft_ms`: non-streaming calls; no time to first token.
- `cache`: no cached prompt tokens reported on any call; cache economics not observable.
- `deployment_ref.region / tier`: route plus who served the call (OpenRouter's upstream provider, or the model id a direct API answered with); region and service tier are not exposed.
- `human_intervention`: not observed; no trace format read here says whether the agent waited on a person.
- `tool_calls`, turns: not observed; no candidate declared `cli.trace`, so what the agents did between input and output is not recorded.
- `checkpoint`: not observed; no trace format read here says whether the agent resumed from one.
- transport retry: model-API calls retry transient failures (HTTP 408/409/425/429, 5xx, network) twice with exponential backoff and no jitter; per-trial retry counts are not in scores.jsonl, only retry cost.
- evaluator errors: none in this run.
- pairwise judging: **not run** — the spec declares `methods` without `pairwise-swap`. No preference direction is observed in this run.
- effective N: 50 of 50 inputs separated any two candidates on task success; 0 every candidate passed, 0 gave everyone the same partial rate. Only the separating inputs carry evidence for a choice (items.json).
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector reads the pairwise score only to rank judge-preference, and to break a tie on assurance in highest-assurance.
- statistical uncertainty: the chosen candidate's gated rates carry Wilson 95% intervals, and a highest-assurance pick must beat the runner-up on an exact sign test over inputs (recommendation.json `evidence`). Inputs generated from one template are still treated as independent, which overstates certainty when they share a template.
