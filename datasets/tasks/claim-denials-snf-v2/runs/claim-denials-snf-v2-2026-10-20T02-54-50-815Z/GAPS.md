# GAPS — fields the protocol wants that this run did not observe

Every field below is recorded as `null` or `not_applicable`, never defaulted to a measured-looking value.

- generation cost: **not observed** for 5 trial(s) (deepseek-v4.1-flash, glm-5.3). These candidates' spend was not reported to the harness, so their cost per success is undefined (null, not $0); ledger `generation` and `total` are lower bounds, and `cost_per_success` / `cost_per_attempt` are null.
- `ttft_ms`: non-streaming calls; no time to first token.
- `cache`: OpenRouter reported cached prompt tokens on some calls; recorded under `tokens.cached`, no cache cost breakdown.
- `deployment_ref.region / tier`: provider name observed via OpenRouter; region and service tier are not exposed.
- `human_intervention`: single-call producers, no interactive execution; recorded as not applicable.
- `tool_calls`: producers make no tool calls this milestone.
- `checkpoint`: not applicable to single-call trials.
- transport retry: model-API calls retry transient failures (HTTP 408/409/425/429, 5xx, network) twice with exponential backoff and no jitter; per-trial retry counts are not in scores.jsonl, only retry cost.
- evaluator errors: none in this run.
- pairwise judging: **not run** — the spec declares `methods` without `pairwise-swap`. No preference direction is observed in this run.
- effective N: 179 of 300 inputs separated any two candidates; 96 every candidate passed, 0 gave everyone the same partial rate. Only the separating inputs carry evidence for a choice (items.json).
- every candidate failed 25 input(s): cd2-019, cd2-028, cd2-056, cd2-103, cd2-110, cd2-111, cd2-117, cd2-137, cd2-140, cd2-148 and 15 more. Check those traces for a harness or check bug before counting them as model failures.
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector reads the pairwise score only to rank judge-preference, and to break a tie on assurance in highest-assurance.
- statistical uncertainty: the chosen candidate's gated rates carry Wilson 95% intervals, and a highest-assurance pick must beat the runner-up on an exact sign test over inputs (recommendation.json `evidence`). Inputs generated from one template are still treated as independent, which overstates certainty when they share a template.
