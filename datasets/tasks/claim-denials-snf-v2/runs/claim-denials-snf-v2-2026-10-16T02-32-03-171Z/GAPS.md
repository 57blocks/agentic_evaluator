# GAPS — fields the protocol wants that this run did not observe

Every field below is recorded as `null` or `not_applicable`, never defaulted to a measured-looking value.

- **budget limit reached**: spent $4.0297 of $4.00; 0 generation(s), 0 judgement(s) and 102 scoring call(s) were never started. Every rate below is computed over the work that ran, so this run is partial — raise the budget or narrow the spec before comparing it with a complete one.
- generation cost: **not observed** for 3 trial(s) (glm-5.3). These candidates' spend was not reported to the harness, so their cost per success is undefined (null, not $0); ledger `generation` and `total` are lower bounds, and `cost_per_success` / `cost_per_attempt` are null.
- `ttft_ms`: non-streaming calls; no time to first token.
- `cache`: OpenRouter reported cached prompt tokens on some calls; recorded under `tokens.cached`, no cache cost breakdown.
- `deployment_ref.region / tier`: provider name observed via OpenRouter; region and service tier are not exposed.
- `human_intervention`: single-call producers, no interactive execution; recorded as not applicable.
- `tool_calls`: producers make no tool calls this milestone.
- `checkpoint`: not applicable to single-call trials.
- transport retry: model-API calls retry transient failures (HTTP 408/409/425/429, 5xx, network) twice with exponential backoff and no jitter; per-trial retry counts are not in scores.jsonl, only retry cost.
- evaluator errors: none in this run.
- pairwise judging: **not run** — the spec declares `methods` without `pairwise-swap`. No preference direction is observed in this run.
- absolute scores show no discrimination on: overall, sound-action (every graded trial scored 5). A dimension with one distinct value measures nothing; treat those scores as not evaluated until the rubric carries per-dimension thresholds and the judge is calibrated.
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector does not use pairwise win rate.
- statistical uncertainty: no interval estimates yet; results are labeled directional (see summary.json) and recommendation.json firmness follows that label.
