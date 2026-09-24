# agb-models

Which model agb should use for its **task breakdown** and **coding** steps: the
same agb, the same inputs, only the model changes (Opus 5 / Opus 5.5 /
Sonnet 5), and the question is who gets the step right.

| Step | Input (from the agb project's git history) | What the candidate runs | What counts as right |
|---|---|---|---|
| detail | just before `.ab/tasks.json` is written: PRD, design and contracts in place | `claude -p` + the stage-detail skill | the task table parses; zero findings from the coverage and structure gates (`page-coverage` / `contract-coverage` / `plan-domain-cycle`) |
| code | just before each `[T-xxx]` commit: earlier tasks done | `agb run`, with the plan trimmed to this one task | the acceptance tests the plan lists for this task, restored to their original form, all pass |

A project yields one coding input per task, so one project already gives a fair
number of samples; one coding run does one task (agb estimates $2.46), far
lighter than running the whole project.

## Adding a project

```sh
node scripts/harvest.mjs <agb project dir> --name=<short name>
```

It takes snapshots from the git history into `fixture/`, writes inputs to
`inputs/`, and finally prints the names to add to the two `inputs:` lists in
`spec.yaml`. Requirements: agb committed task by task (commit messages end in
`[T-xxx]`), and for a coding input to be gradable, the task must list its own
test files in the plan.

## Files

- `agents/agb.mjs <model>`: reads the input header (stage / fixture / task),
  lays down the snapshot, sets the model and runs the step. Spend cap $10 per
  run. `AGB_EVAL_DRY=1` sets up the environment without starting the executor.
- `checks/plan-gates.mjs`, `checks/task-tests.mjs`: the two required checks.
  The gates run from ab-gate in `AGB_HOME` (default `~/workspace/57b/agb`).
- `scripts/harvest.mjs`: collects inputs from an agb project.

## Reference

What agb actually produced on agb-demo-todo at the time: the task breakdown
passed `plan-gates` (heuristics recorded 11 `task-granularity` and 1
`ac-task-coverage` findings). Per-task coding results come with the next
calibration.

## Running

`pnpm agenteval plan agb-models` shows the plan first (3 detail runs + 24 code
runs); then add `--yes`. It spends real money and runs candidates on this
machine. detail is driven by `claude -p` and needs agb's skills (the agb-skills
plugin) installed in the local Claude Code.
