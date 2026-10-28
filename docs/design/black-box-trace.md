# Black-box agents: read the trace the command leaves

Status: 2026-10-27. **Step 1 built** (ATIF reader, `cli.trace`, rows, traces/, GAPS, report) on `feat/agent-trace`; steps 2 and 3 are proposals.

## Why

A command candidate (`adapter: agent-cli`) is a black box today: agenteval
gives it an input, collects the files it leaves, and reads `.eval-usage.json`
when the spec says it will be there. Everything the protocol wants about how
the agent worked — tool calls, turns, retries, checkpoint, human intervention —
is recorded as *not observed* on every trial (`GAPS.md`), including the $320
agb-flow run and the Harbor spike.

The subject under test stays a black box: agenteval runs no agent loop and
injects nothing. What changes is that the command may leave **one more file**,
its trace, and agenteval reads it into the rows it already writes. A command
that leaves none stays unobserved. That is the design, not a gap.

## Spec

One field on the candidate, beside `reports_usage`:

```yaml
candidates:
  - id: terminus-sonnet
    adapter: agent-cli
    cli:
      argv: [bash, agents/harbor-run.sh, terminus-2, anthropic/claude-sonnet-5, "{{input}}"]
      reports_usage: true
      trace: atif            # omitted → not observed; claude-code comes with step 2
```

- `trace: atif` — the command leaves `.eval-trace.json`, an ATIF document
  (Harbor's Agent Trajectory Interchange Format, versions 1.0–1.7).
- `trace: claude-code` (step 2, not yet accepted by the schema) — the command
  leaves `.eval-trace.jsonl`, the newline-delimited stream of
  `claude -p --output-format stream-json --verbose`.
- Omitted — nothing is read; GAPS keeps saying not observed.

The file names are fixed, like `.eval-usage.json`; the wrapper copies or tees
into them. Both names join `SKIP_NAMES`, so a trace is never mistaken for the
candidate's output. Candidate level only: the trace is a property of what that
command writes, and a step-level default is not needed yet.

`trace` **never enters the trial hash** (`trialAdapterFields`), like `price`
and `api_key_env`. Declaring it on an existing candidate must still reuse the
agb-flow and Harbor spike trials. A test pins this.

## What is read: one small internal model

`src/canon/agent-trace.ts`. Neither wire format leaks past its reader; ATIF is
Harbor's (its Pydantic models reject unknown fields) and stream-json is
Claude Code's.

```ts
interface AgentTrace {
  format: "atif" | "claude-code";
  /** Model calls in the main loop; subagents counted under their tool call. */
  turns: number;
  tool_calls: { name: string; ms: number | null; failed: boolean | null; subagent_turns: number | null }[];
  /** Null when the format has no notion of it (ATIF). */
  retries: number | null;
  denials: number | null;
  compactions: number | null;
  /** Per main-loop turn; output tokens only where the format reports them honestly. */
  turn_tokens: { prompt: number; cached: number; output: number | null }[] | null;
  models: string[];
  cost: { usd: number; source: "estimated" } | null;
  ended: "finished" | "max_turns" | "max_budget" | "error" | "killed" | null;
}
```

Summary counts go on the trial row; the normalised turn list goes to
`runs/<run>/traces/<candidate>__<input>__tN.json`. The original file stays
where `keepEvidence` puts the work dir, `checks/<candidate>__<input>__tN/`,
as the evidence. A reused trial's turn list is copied into the new run's
`traces/` beside its check evidence.

Row (`scores.jsonl`), beside `tokens` and `cost`:

```ts
agent: {
  turns: number; tool_calls: number; tools: Record<string, number>;
  retries: number | null; denials: number | null; compactions: number | null;
  ended: AgentTrace["ended"];
} | null;   // null: no trace declared or none left
agent_error?: string;   // a trace was left but could not be read
```

`trace.jsonl` (one event per LLM call agenteval made) is not touched: tool
events are the agent's, not ours.

### ATIF reader

Fields read (from Harbor's `models/trajectories/*.py`, 2026-10-27; Harbor
0.24 writes ATIF-v1.8, and the reader accepts any v1.x):
`schema_version`; `agent.name/version/model_name`; `steps[]` with `step_id`,
`timestamp`, `source` (system|user|agent), `model_name`, `tool_calls[]`
(`tool_call_id`, `function_name`, `arguments`), `observation.results[]`
(`source_call_id`, `content`), `metrics` (`prompt_tokens`,
`completion_tokens`, `cached_tokens`, `cost_usd`), `llm_call_count`;
`final_metrics`; `subagent_trajectories`.

- turns = agent steps (`llm_call_count` summed where present);
- a tool call's duration = next step's timestamp − this one's, when both exist;
- `failed` stays null: ATIF observations carry content, not a verdict;
- retries, denials, compactions = null (no such notion);
- `turn_tokens` from step `metrics`, one entry per agent step; cost from
  `final_metrics.total_cost_usd`, else the sum of step `cost_usd`, as
  `estimated`;
- a tool call's duration is the gap to the next step only when the step made
  one call (terminus batches several keystrokes per step), else null;
- `ended`: null unless Harbor's `result.json` is beside it (import path below).

### Claude Code reader

Fields read (Agent SDK reference, 2026-10-27):

- `system/init`: `model`, `claude_code_version`, `apiKeySource`, `tools`;
- `assistant`: `message.id`, `message.usage` (`input_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`; `output_tokens`
  is a placeholder and is **not** read per turn), `message.content[]`
  `tool_use` blocks (`id`, `name`), `parent_tool_use_id`;
- `user`: `tool_result` blocks (`tool_use_id`, `is_error`);
- `system/api_retry`: `attempt`, `error`;
- `system/compact_boundary`: `compact_metadata.pre_tokens`;
- `result`: `subtype` (`success`, `error_max_turns`, `error_during_execution`,
  `error_max_budget_usd`, …), `num_turns`, `total_cost_usd`, `usage`,
  `modelUsage` (per model: tokens, `costUSD`, `provider`), `permission_denials[]`,
  `duration_ms`, `duration_api_ms`.

Rules:

- a turn is one unique main-loop `message.id` (parallel tool calls share it);
  messages with `parent_tool_use_id` are a subagent's and count under that
  tool call;
- a tool call's duration = its `tool_result`'s arrival − its `tool_use`'s;
  `failed` = `is_error`;
- `ended` from the result `subtype`; a stream with no `result` line = `killed`;
- tokens: prompt and cache per turn from the deduplicated assistant messages,
  output from the result; whole-tree totals from `modelUsage`;
- cost = `total_cost_usd` as **estimated** (the SDK says it is a client-side
  figure), so `reports_usage` is implied by `trace: claude-code` and
  `.eval-usage.json` is not needed;
- `deployment_ref` from `modelUsage[].provider` / `apiKeySource` when present
  (`anthropic/<model>`, `subscription/<model>`), never "openrouter" by default.
  This fixes the label noted in agb-flow-gaps.

Wrapper change: `--output-format stream-json --verbose`, stdout teed to
`.eval-trace.jsonl`; the wrapper takes the result text from the last line.
agb-step.mjs's planning steps use `--output-format json` today, so the $320
run's planning traces cannot be recovered; only new runs get them. Its code
step leaves `.ab/events.jsonl` in the work dir (collected as output); a third
reader for it is not planned.

## A killed command keeps what it wrote

On timeout agenteval kills the process tree and today reads nothing. Both
trace files are append-only or written early, so after the kill it still reads
`.eval-usage.json` and the trace if present: turns so far, prompt tokens so
far, `ended: killed`. Output tokens and cost of a killed Claude Code run are
not recoverable (the result line never came) and stay unobserved. This closes
the "timeouts lose token usage" item from agb-flow-gaps.

## GAPS and the report

`write.ts` stops printing the fixed three lines. Per step:

- every trial carried a trace → `tool_calls`, `turns`: observed (traces/);
- some → observed for candidates A, B; not for C (no `trace` declared);
- none → the current wording.
`checkpoint` and `human_intervention` stay not observed in v1: neither format
says whether the agent resumed from a checkpoint or waited on a person
(Claude Code's `permission_denials` is the nearest thing and is reported as
denials, not intervention).

Report and dashboard (one model, `report-model.ts`): an "Agent activity"
block per candidate — median turns, median tool calls, the top tools, retries,
denials, how runs ended — and a link from each trial to its trace file. Nothing
in selection reads these yet; they are evidence first.

## Harbor import (comparison doc, option 1)

`agenteval import-harbor <job-dir> --into tasks/<name>`. A Harbor job dir
holds one trial dir per (task, trial) with `result.json` and
`agent/trajectory.json`. The command writes a **task** (a generated
`spec.yaml` naming the agents seen as command candidates, the tasks as inputs,
`harbor-reward` as the check) and one **run** under it, so `agenteval report`
and the dashboard work unchanged:

- candidate = `config.agent.name` + `config.agent.model_name`;
  input = `task_name`; trial = order within (candidate, input);
- `completion_state` from `exception_info` (`AgentTimeoutError`,
  `NonZeroAgentExitCodeError` are the candidate's; anything else is infra);
- `harbor-reward` from `verifier_result.rewards` with the threshold, a missing
  reward = `evaluator_error`, never the candidate's failure (same rule as
  `checks/reward.mjs` in the spike);
- cost from `agent_result.cost_usd` as estimated, else unobserved;
- `isolation` from `config.environment.type`;
- the trace from `agent/trajectory.json` through the ATIF reader.

Operating mode and gates come from flags (`--mode`, default
`highest-assurance`), written into the generated spec so the pick is
reproducible. Nothing is re-run.

The spike's `harbor-run.sh` also changes to copy `agent/trajectory.json` to
`.eval-trace.json`, so the live path and the import path share the reader.

## Not built

- No agent loop, no change to model-api candidates, no parsing of arbitrary
  stdout. Tools in model-api candidates wait for the white-box work.
- No `.ab/events.jsonl` reader.
- `checkpoint` / `human_intervention` stay unobserved.

## Verification

1. Fixtures: one real ATIF file (Harbor spike, terminus on `fix-git`, $0.07,
   Docker; `tests/fixtures/agent-traces/`). **Done.** The Claude Code sample
   for step 2 is regenerated under `--bare` with an API key when that step
   starts: a sample taken from a logged-in session carries the user's hooks,
   plugins and MCP servers in `system/init`.
2. Reuse: declare `trace` on the spike's candidates and run `--reuse`; every
   trial must hit. **Done** (2026-10-27).
3. `import-harbor` on the spike's job dir, then `agenteval report`.
4. agb's test-design step with one Claude candidate on one input through
   stream-json (about $1), to see turns and tool calls on a real agb run.
   The code-step rerun stays a separate, paid job.

## Order

1. Internal model, ATIF reader, `cli.trace`, row + traces/ files, GAPS,
   report block, hash test, killed-command reading.
2. Claude Code reader, agb-step.mjs on stream-json, deployment label.
3. `import-harbor`.

Each is its own PR and is verifiable on its own.
