# GAPS — fields the protocol wants that this run did not observe

Every field below is recorded as `null` or `not_applicable`, never defaulted to a measured-looking value.

- `ttft_ms`: non-streaming calls; no time to first token.
- `cache`: no cached prompt tokens reported on any call; cache economics not observable.
- `deployment_ref.region / tier`: provider name observed via OpenRouter; region and service tier are not exposed.
- `human_intervention`: single-call producers, no interactive execution; recorded as not applicable.
- `tool_calls`: producers make no tool calls this milestone.
- `checkpoint`: not applicable to single-call trials.
- transport retry: model-API calls retry transient failures (HTTP 408/409/425/429, 5xx, network) twice with exponential backoff and no jitter; per-trial retry counts are not in scores.jsonl, only retry cost.
- evaluator errors: none in this run.
- pairwise judging: **not run** — the spec declares `methods` without `pairwise-swap`. No preference direction is observed in this run.
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector reads the pairwise score only to rank judge-preference, and to break a tie on assurance in highest-assurance.
- statistical uncertainty: no interval estimates yet; results are labeled directional (see summary.json) and recommendation.json firmness follows that label.

- **combined run**: built from agent-security-v2-url-2026-10-20T02-54-50-931Z, agent-security-v2-url-2026-10-20T07-42-08-712Z (later runs supersede earlier ones per trial); nothing was generated or judged for it. combined-from.json says which run each trial came from.
