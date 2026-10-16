# GAPS — fields the protocol wants that this run did not observe

Every field below is recorded as `null` or `not_applicable`, never defaulted to a measured-looking value.

- generation cost: **not observed** for 3 trial(s) (qwen-3-8-max). These candidates' spend was not reported to the harness, so their cost per success is undefined (null, not $0); ledger `generation` and `total` are lower bounds, and `cost_per_success` / `cost_per_attempt` are null.
- `ttft_ms`: non-streaming calls; no time to first token.
- `cache`: OpenRouter reported cached prompt tokens on some calls; recorded under `tokens.cached`, no cache cost breakdown.
- `deployment_ref.region / tier`: provider name observed via OpenRouter; region and service tier are not exposed.
- `human_intervention`: single-call producers, no interactive execution; recorded as not applicable.
- `tool_calls`: producers make no tool calls this milestone.
- `checkpoint`: not applicable to single-call trials.
- transport retry: model-API calls retry transient failures (HTTP 408/409/425/429, 5xx, network) twice with exponential backoff and no jitter; per-trial retry counts are not in scores.jsonl, only retry cost.
- evaluator errors: none in this run.
- absolute 1–5 scoring: **not run** — the spec declares `methods` without `absolute-1-5`. Magnitude is therefore not observed at all in this run; the empty score columns are a declaration, not a failure.
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector reads the pairwise score only to rank judge-preference, and to break a tie on assurance in highest-assurance.
- statistical uncertainty: no interval estimates yet; results are labeled directional (see summary.json) and recommendation.json firmness follows that label.

- **combined run**: built from agb-flow-2026-10-14T07-38-33-255Z (later runs supersede earlier ones per trial); nothing was generated or judged for it. combined-from.json says which run each trial came from.
- **judged after the run**: `agenteval judge` compared 108 pair(s) with x-ai/grok-4.7 on the files each trial left, minus those unchanged from the fixture; 0 judge call(s) failed.
