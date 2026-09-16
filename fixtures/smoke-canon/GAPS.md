# GAPS — fields the protocol wants that this run did not observe

Every field below is recorded as `null` or `not_applicable`, never defaulted to a measured-looking value.

- `ttft_ms`: non-streaming calls; no time to first token.
- `cache`: no cached prompt tokens reported on any call; cache economics not observable.
- `deployment_ref.region / tier`: provider name observed via OpenRouter; region and service tier are not exposed.
- `human_intervention`: single-call producers, no interactive execution; recorded as not applicable.
- `tool_calls`: producers make no tool calls this milestone.
- `checkpoint`: not applicable to single-call trials.
- transport retry: not implemented; no provider_error occurred in this run.
- evaluator errors: none in this run.
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only.
- statistical uncertainty: no interval estimates yet; results are labeled directional (see summary.json).
