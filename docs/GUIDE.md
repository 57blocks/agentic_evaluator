# agenteval user guide

How to install the tool, run the samples, write your own task, and read what a
run produced. For how the harness is built, see [DEVELOPMENT.md](DEVELOPMENT.md).

- [Install](#install)
- [Five minutes with the samples](#five-minutes-with-the-samples)
- [Concepts](#concepts)
- [Commands](#commands)
- [Writing a task](#writing-a-task)
- [Reading a run](#reading-a-run)
- [Controlling cost](#controlling-cost)
- [Isolation](#isolation)
- [Troubleshooting](#troubleshooting)

## Install

Requirements: Node 22 or newer, pnpm, and — only for tasks that call models —
an [OpenRouter](https://openrouter.ai) API key. Docker is optional (see
[Isolation](#isolation)).

```bash
git clone <this repo> agentic_evaluator
cd agentic_evaluator
pnpm install
npm link            # puts `agenteval` on your PATH
agenteval --version
```

`npm link` points the global command at this checkout, so pulling new commits
updates the tool without reinstalling. The link belongs to the Node version
that made it: after switching versions with nvm, run `npm link` again. Without
linking, `pnpm run agenteval <command>` works from inside the checkout.

The key goes in a `.env.local` file:

```bash
echo 'OPENROUTER_API_KEY=sk-or-...' > .env.local
```

`.env.local` is read from the directory you run in first, then from the
checkout; a variable already set in your environment wins over both. It is
git-ignored.

## Five minutes with the samples

`examples/` is a workspace with six tasks. The first two are offline and
free; the rest call real models or agents.

| task | what it shows | cost |
|---|---|---|
| `custom-check` | grading a deliverable with your own check script; wrapping any agent as a command | free |
| `chain-offline` | a two-step chained workflow and its end-to-end validation | free |
| `compare-models` | two real models on one task, a deterministic gate plus a pairwise judge | billed, capped at $0.50 |
| `compare-agents` | Claude Code, OpenCode and pi build a reactive-signals library with the same model, graded by ten behavioural tests | billed by the agents (not seen by the harness); judge capped at $1 |
| `compare-agent-models` | one agent (OpenCode) with three models on the same task — the model's effect, with the agent held fixed | billed by OpenRouter (not seen by the harness); judge capped at $1 |
| `compare-setups` | concrete agent + model combinations head to head — for choosing a setup, not for attributing why it won | billed by the agents (not seen by the harness); judge capped at $1 |

```bash
agenteval ls --workspace examples

# 1. A check you wrote decides who passed.
agenteval run examples/tasks/custom-check --yes --html

# 2. Two steps chained; the run also compares the chain against one model.
agenteval run examples/tasks/chain-offline --yes --html

# 3. Real models. Look before you spend:
agenteval models examples/tasks/compare-models --catalog-only   # ids and prices, free
agenteval plan   examples/tasks/compare-models                  # call counts, free
caffeinate -i agenteval run examples/tasks/compare-models --yes --html

# 4. Coding agents head to head. Read the warnings in its spec.yaml first:
#    the agents run unsandboxed and their spend is invisible to the budget.
agenteval plan examples/tasks/compare-agents
agenteval plan examples/tasks/compare-agent-models   # same agent, three models
agenteval plan examples/tasks/compare-setups         # mixed agent + model setups

# See everything in the browser.
agenteval dash --workspace examples
```

Each run prints where it wrote its evidence, e.g.
`examples/tasks/custom-check/runs/custom-check-<timestamp>/`. With `--html`
that directory has a `report.html` to open; without it, use the dashboard, or
`agenteval report <runId>` to write the page afterwards.

To start your own task, copy the sample closest to what you want, or:

```bash
agenteval init my-task      # creates tasks/my-task/, runnable offline as-is
```

## Concepts

- **Workspace** — any directory with a `tasks/` folder. It matters only when
  you name a task by its bare name, and for `ls` and `dash`, which show one
  workspace's tasks. Commands find it by walking up from where you stand;
  `--workspace DIR` names one explicitly. Pointing at a task by its path needs
  neither.
- **Task** — `tasks/<name>/`, self-contained: `spec.yaml` plus the inputs,
  prompts, rubrics, agents, checks and scaffold it refers to, and its own
  `runs/`. Copy the directory anywhere and it still runs.
- **Step** — one thing being evaluated, e.g. "write a PRD". A task has one or
  more, and each is evaluated on its own `test_set`. `input_from` additionally
  chains steps into a workflow for end-to-end validation (see
  [Chaining](#writing-a-task)).
- **Candidate** — what competes on a step: a model (`model: vendor/name`) or a
  command (`adapter: agent-cli`) such as `claude -p` or your own script.
- **Input** — a test case, `inputs/<id>.txt`. Every candidate runs every input,
  `trials_per_case` times.
- **Required check** — a deterministic gate: `tsc` over produced TypeScript,
  or any program you write (`kind: command`). This is what turns an outcome
  into a measured success or failure.
- **Judge** — a model that compares candidates' outputs pairwise (both orders)
  and/or scores them 1–5 against a rubric. Optional, and billed.
- **Recommendation** — per step: which candidates passed the eligibility gates,
  and which one the declared `operating_mode` chooses among them.

## Commands

Every command takes `--help`. Exit codes: `0` done · `1` failed · `2` usage
error · `3` completed but partial (the budget stopped it early, or the host was
suspended and durations are unreliable).

| command | does | needs a key? |
|---|---|---|
| `agenteval init <name>` | create a runnable offline task to edit | no |
| `agenteval ls` | list tasks, their runs, and what the runs spent | no |
| `agenteval plan <task>` | say what a run would do: generations, judge calls, budget | no |
| `agenteval models <task>` | are the task's models reachable, and at what price | yes (`--catalog-only`: no) |
| `agenteval run <task> --yes` | execute | if the task calls models |
| `agenteval report <run>` | re-render a run's `report.html`; no number changes | no |
| `agenteval dash` | serve the dashboard on http://127.0.0.1:4173 | only to start runs from it |

`<task>` is how you point at a task:

- **a path** — `agenteval run examples/tasks/custom-check`, or
  `agenteval run ./my-task`, or a path to a `spec.yaml`. Works from anywhere;
  the run is written into that task's own `runs/`. This is the one to use.
- **a bare name** — `agenteval run my-task` looks for `tasks/my-task/` in the
  current workspace (below). Handy once you keep your tasks in one place.

A bare name that is not found says where it looked, and names the sample's
path when a sample has that name.

### `run`

```bash
agenteval run my-task               # without --yes: prints the plan, runs nothing
agenteval run my-task --yes         # execute
agenteval run my-task --yes --html  # also write report.html
agenteval run my-task --yes --json  # one JSON event per line, for scripts
agenteval run my-task --yes --reuse # reuse identical prior generations (same trial hash)
agenteval run my-task --yes --concurrency 4
```

On an interactive terminal, `run --yes` shows a live progress block —
generations, judging and scoring against their planned totals, failures, and
generation spend — below the permanent lines (plans, warnings, failures,
per-step summaries). Piped, redirected, or with `--plain`, it prints one line
per event instead. `--json` is always one event per line.

### `plan`

```bash
agenteval plan my-task
agenteval plan my-task --json
```

Reads the spec and counts. It makes no call and needs no key. Per step it
prints:

```
▶ <suite> / <step> [<producer>] — <candidates> candidates × <inputs> inputs × <trials> trials
  generations N · pairwise P pairs (2P judge calls, up to 3 attempts each) · absolute S calls
  judge <model> · concurrency C · budget $B
  benchmark <mode> · cache <mode> · directional yes|no
```

`pairwise off` and `absolute off` mean no judge call will be made. `plan`
counts calls; it does not price them — `models` gives the per-token prices, and
`budget_usd` is the ceiling.

### `models`

```bash
agenteval models my-task --catalog-only   # is each id listed, and its price — free
agenteval models my-task                  # also send each model one tiny request (billed, a fraction of a cent)
```

Run it after editing candidate ids: a typo'd model id is cheaper to find here
than halfway through a run.

## Writing a task

A minimal single-step task, commented. `agenteval init` writes one like this.

```yaml
protocol_version: "0.4"
run_name: my-task
budget_usd: 1                    # hard ceiling for the whole run

workflow:
  control_candidate: sonnet-5    # the single-model baseline for chained workflows
  steps:
    - id: notes
      version: "1"               # bump when you change the step's meaning
      producer: prompt           # prompt: send prompt_file to a model
      prompt_file: prompts/notes.md      # {{input}} is replaced by the test case
      rubric_file: rubrics/notes.md      # what the judge grades against
      test_set:
        id: changelog-v1
        inputs: [changelog]      # inputs/changelog.txt
      candidate_ids: [sonnet-5, deepseek-v4-pro]
      required_checks: [release-notes]
      judged_dimensions: [faithfulness, grouping, clarity]
      success_criteria:
        mandatory_checks: all    # success = every required check passed
      operating_mode: lowest-cost        # fastest-within-cost-ceiling | highest-assurance | judge-preference
      eligibility:               # candidates below these are gated out, with the reason
        minimum_reliability: 1.0
        minimum_required_check_pass_rate: 1.0
      maximum_completion_time_seconds: 120

candidates:
  - id: sonnet-5
    model: anthropic/claude-sonnet-5
    provider_route: openrouter
    generation_settings: { temperature: 0.3 }
  - id: my-agent                 # any command
    adapter: agent-cli
    cli:
      argv: [node, agents/run.mjs, "{{input}}"]

evaluators:
  required_checks:
    release-notes:
      kind: command
      argv: [node, checks/release-notes.mjs]
      version_files: [checks/release-notes.mjs]
      timeout_seconds: 30
  judge:
    model: google/gemini-3.1-pro-preview
    provider_route: openrouter
    rubric_file: rubrics/notes.md
    methods: [pairwise-swap]     # [] = no judge at all; absent = both methods

execution:
  trials_per_case: 1
  concurrency: 2

x-harness:                       # still required this milestone
  producer: prompt
  prompt_file: prompts/notes.md
```

The full schema is `src/spec/schema.ts`; loading validates the spec and
rejects unknown or contradictory fields with a message naming them.

**Candidates.** A model candidate is called through OpenRouter. An `agent-cli`
candidate runs its `argv` in a fresh, empty work dir: `{{input}}` in argv is
replaced by the test case, which is also written to `.eval-input.txt`, and
`{{workdir}}` by the work dir's path. The files it leaves behind are its
deliverable; if it leaves none, its stdout is. Relative paths in argv resolve
against the task directory, so a task can carry its own agent in `agents/`.

**Required checks.** One per step.

- `kind: tsc` compiles the produced `.ts` files against `scaffold_dir`'s
  `tsconfig.json`.
- `kind: command` runs your program in the trial's work dir, which holds the
  candidate's files plus `output.txt` (the deliverable), `input.txt` (the test
  case) and `meta.json` (`{step, candidate, input, trial}`). Exit 0 passes,
  exit 1 fails the candidate, and anything else — a crash, a timeout, a missing
  program — is recorded as an evaluator error, never blamed on the candidate.
  Print `{"evidence": "...", "reason": "..."}` to stdout and it is kept with the
  trial. See `examples/tasks/custom-check/checks/release-notes.mjs`.

**Chaining.** Each step is first evaluated independently, on its own
`test_set` — a step's per-step results never depend on another step's output.
Adding `input_from: <earlier step id>` declares the workflow and turns on
end-to-end validation: after the steps, the run executes the whole chain,
feeding each step's output to the next, once with `control_candidate` on every
step and once with each step's recommended candidate, and reports whether the
combination beats the single model (`adopt-combination`, `keep-control`, or
`not-validated`). See `examples/tasks/chain-offline`.

**Judging.** `methods: [pairwise-swap]` compares every pair of candidates on
every input, in both orders to cancel position bias. `absolute-1-5` scores each
output alone. A method left out is not run and not billed, and the run's
`GAPS.md` records that as a choice. With one input and one trial every result
is **directional** — useful to see the evidence, not to make a decision. Add
inputs and trials before trusting a ranking.

## Reading a run

A run writes `tasks/<task>/runs/<runId>/`:

| file | holds |
|---|---|
| `report.html` | the page to read first: standings, evidence, what was not observed (written with `--html`, or later by `agenteval report`) |
| `recommendation.json` | eligibility gates and the choice, with reasons |
| `summary.json` | per-candidate rates, with numerators and denominators |
| `scores.jsonl` | one row per trial: state, outcome, check result and evidence, judge, cost |
| `ledger.json` | cost by component: generation, judging, scoring, retries |
| `GAPS.md` | what this run could not observe — recorded as unknown, never defaulted |
| `trace.jsonl` | one event per model call, without prompt text |
| `raw/` | each candidate's deliverable, one file per trial |

A multi-step run has one such directory per step plus `workflow.json` and, when
chained, `e2e-validation.json` at the root.

`agenteval dash` shows every task and run in the workspace, follows a run in
progress, and can start one.

## Controlling cost

- `plan` first. `run` without `--yes` is the same preview, so a typo cannot
  bill you.
- `budget_usd` is enforced: once spend reaches it the run stops starting new
  work, records what it skipped, and exits `3`.
- `methods: []` and command-only candidates make a task free. `plan` shows
  `pairwise off · absolute off` for such a step.
- The key in the checkout's `.env.local` is picked up wherever you run, so a
  task that declares a judge **will** call it. Check `plan` rather than
  assuming a task is offline.
- On macOS run billed tasks under `caffeinate -i`. A sleeping laptop leaves
  gaps that make every duration meaningless; the run detects them, says so in
  `GAPS.md`, and exits `3`.

## Isolation

By default an `agent-cli` candidate runs **on this machine as you**: your
files, your network, your credentials. For a real coding agent that is a real
risk. Add an image to run it in a container instead:

```yaml
  - id: cc-sonnet
    adapter: agent-cli
    cli:
      image: your-registry/claude-code:latest   # must contain the CLI
      network: bridge                           # default is none
      env: { ANTHROPIC_API_KEY: "" }            # "" = pass the host's value through
      argv: [claude, -p, --model, claude-sonnet-5, --permission-mode, acceptEdits, "{{input}}"]
```

Only the work dir is mounted (at `/work`), the network is off unless you ask
for it, and only the variables you name are passed in. Every trial records
`isolation: docker` or `none`, so a report shows which happened.

**What the budget cannot see.** An `agent-cli` trial's cost is recorded as
unobserved (`cost_source: none`): the agent bills its own provider, the ledger
shows $0 for it, and `budget_usd` cannot stop it. Only judge and scorer calls,
and model candidates, count against the budget.

Model candidates never execute code on this machine. Required checks (`tsc`
and your `command` checks) always run on the host — declare only checks you
would run yourself.

## Troubleshooting

| symptom | cause |
|---|---|
| `agenteval: command not found` | not linked for the current Node version — run `npm link` in the checkout |
| `OPENROUTER_API_KEY is not set` | put it in `.env.local` or export it; or use `--catalog-only` / `plan` |
| `which task? (try agenteval ls)` | no task name given, or you are outside a workspace — pass `--workspace` |
| `unknown flag --...` | flags are strict on purpose; see `agenteval <command> --help` |
| a candidate shows `evaluator_error` | your check crashed or exited with something other than 0/1 — that is the check's fault, not the candidate's |
| exit code `3` | the run finished but is partial: read its `GAPS.md` |
| a model id fails mid-run | run `agenteval models <task>` after every candidate edit |
