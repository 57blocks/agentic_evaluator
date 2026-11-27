# GAPS — fields the protocol wants that this run did not observe

Every field below is recorded as `null` or `not_applicable`, never defaulted to a measured-looking value.

- `ttft_ms`: non-streaming calls; no time to first token.
- `cache`: the provider reported cached prompt tokens on some calls; recorded under `tokens.cached`, no cache cost breakdown.
- `deployment_ref.region / tier`: who served the model is read from the command's trace (`cli/…`), from OpenRouter's upstream provider, or from the model id a direct API answered with; region and service tier are not exposed.
- `human_intervention`: not observed; no trace format read here says whether the agent waited on a person.
- `tool_calls`, turns: observed for every trial from the trace the command left; counts in `agent` per row, the turn list in traces/.
- `checkpoint`: not observed; no trace format read here says whether the agent resumed from one.
- transport retry: model-API calls retry transient failures (HTTP 408/409/425/429, 5xx, network) twice with exponential backoff and no jitter; per-trial retry counts are not in scores.jsonl, only retry cost.
- evaluator errors: none in this run.
- absolute 1–5 scoring: **not run** — the spec declares `methods` without `absolute-1-5`. Magnitude is therefore not observed at all in this run; the empty score columns are a declaration, not a failure.
- pairwise judging: **not run** — the spec declares `methods` without `pairwise-swap`. No preference direction is observed in this run.
- effective N: 16 of 32 inputs separated any two candidates on task success; 1 every candidate passed, 0 gave everyone the same partial rate. Only the separating inputs carry evidence for a choice (items.json).
- every candidate failed 15 input(s): pr2963, pr3189, pr3266, pr3280-clean, pr3321, pr3385-clean, pr3459, pr3670, pr3746-clean, pr4159 and 5 more. A hard set can do that; if you did not expect it, check those traces for a harness or check bug before counting them as model failures.
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector reads the pairwise score only to rank judge-preference, and to break a tie on assurance in highest-assurance.
- statistical uncertainty: the chosen candidate's gated rates carry Wilson 95% intervals, and a highest-assurance pick must beat the runner-up on an exact sign test over inputs (recommendation.json `evidence`). Inputs generated from one template are still treated as independent, which overstates certainty when they share a template.
