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
- effective N: 0 of 3 inputs separated any two candidates on task success; 3 every candidate passed, 0 gave everyone the same partial rate. Only the separating inputs carry evidence for a choice (items.json). The judge preferred one candidate over another on 3 of 3.
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector reads the pairwise score only to rank judge-preference, and to break a tie on assurance in highest-assurance.
- statistical uncertainty: the chosen candidate's gated rates carry Wilson 95% intervals, and a highest-assurance pick must beat the runner-up on an exact sign test over inputs (recommendation.json `evidence`). Inputs generated from one template are still treated as independent, which overstates certainty when they share a template.

- **combined run**: built from agb-flow-v3-2026-11-13T09-04-37-061Z, agb-flow-v3-2026-11-13T10-23-03-124Z (later runs supersede earlier ones per trial); nothing was generated or judged for it. combined-from.json says which run each trial came from.
