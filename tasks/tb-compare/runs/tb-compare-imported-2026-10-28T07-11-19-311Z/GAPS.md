# GAPS — fields the protocol wants that this run did not observe

Every field below is recorded as `null` or `not_applicable`, never defaulted to a measured-looking value.

- generation cost: **not observed** for 4 trial(s) (terminus-2--anthropic-claude-sonnet-5). These candidates' spend was not reported to the harness, so their cost per success is undefined (null, not $0); ledger `generation` and `total` are lower bounds, and `cost_per_success` / `cost_per_attempt` are null.
- generation cost: **self-reported** by claude-code--anthropic-claude-sonnet-5, terminus-2--anthropic-claude-sonnet-5, terminus-2--deepseek-deepseek-v4-flash through `.eval-usage.json` (the spec declares `cli.reports_usage`). Recorded as `estimated`; not verified by the harness, so it is only as trustworthy as the command that wrote it.
- `ttft_ms`: non-streaming calls; no time to first token.
- `cache`: OpenRouter reported cached prompt tokens on some calls; recorded under `tokens.cached`, no cache cost breakdown.
- `deployment_ref.region / tier`: provider name observed via OpenRouter; region and service tier are not exposed.
- `human_intervention`: not observed; no trace format read here says whether the agent waited on a person.
- `tool_calls`, turns: observed for terminus-2--anthropic-claude-sonnet-5, terminus-2--deepseek-deepseek-v4-flash, claude-code--anthropic-claude-sonnet-5 (not terminus-2--anthropic-claude-sonnet-5: no `cli.trace`, or none left) from the trace the command left; counts in `agent` per row, the turn list in traces/.
- `checkpoint`: not observed; no trace format read here says whether the agent resumed from one.
- transport retry: model-API calls retry transient failures (HTTP 408/409/425/429, 5xx, network) twice with exponential backoff and no jitter; per-trial retry counts are not in scores.jsonl, only retry cost.
- infra failures: 4 trial(s) ended in provider_error or cancelled (terminus-2--anthropic-claude-sonnet-5 4). They are undetermined: out of task-success and reliability denominators, and shown as lost evaluation coverage.
- evaluator errors: 4 evaluator invocation(s) failed and are recorded as evaluator_error rows (excluded from candidate rates).
- absolute 1–5 scoring: **not run** — the spec declares `methods` without `absolute-1-5`. Magnitude is therefore not observed at all in this run; the empty score columns are a declaration, not a failure.
- pairwise judging: **not run** — the spec declares `methods` without `pairwise-swap`. No preference direction is observed in this run.
- effective N: 2 of 6 inputs separated any two candidates; 4 every candidate passed, 0 gave everyone the same partial rate. Only the separating inputs carry evidence for a choice (items.json).
- pairwise judging uses only the first successful output per (candidate, input); repeated trials feed absolute scores only. The selector reads the pairwise score only to rank judge-preference, and to break a tie on assurance in highest-assurance.
- statistical uncertainty: the chosen candidate's gated rates carry Wilson 95% intervals, and a highest-assurance pick must beat the runner-up on an exact sign test over inputs (recommendation.json `evidence`). Inputs generated from one template are still treated as independent, which overstates certainty when they share a template.

- **imported from Harbor**: 22 trial(s) read from /private/tmp/claude-502/-Users-liuxing-workspace-57b-agentic-evaluator/4c0e9420-d665-43a8-b752-a78f0eea8f9c/scratchpad/harbor-compare; nothing was generated, checked or judged by agenteval. Each trial's text is the verifier's verdict, not the agent's deliverable (Harbor keeps that in its sandbox); cost is what the agent reported to Harbor.
