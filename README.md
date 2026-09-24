# agenteval

Pick the right model — or agent, or combination of both — for each step of
your AI workflow, with evidence you can check.

You give agenteval a task: some test inputs, the candidates to compare, and how
to judge them. It runs every candidate on every input, grades the results with
deterministic checks and (optionally) a judge model, and tells you which
candidate to use, why, what it cost, and what it could not observe.

- **Compare** models on one prompt, coding agents on one job, or one agent
  across several models.
- **Grade** with a check you write (any program that exits 0 or 1), a
  TypeScript compile, and/or a judge model from a different vendor.
- **Decide** by explicit gates and an operating mode (`lowest-cost`,
  `highest-assurance`, …), not by eyeballing a leaderboard.
- **Validate workflows**: chain steps, then test the per-step picks end to end
  against a single-model baseline.
- **Keep the evidence**: every run writes its scores, costs, gaps and a
  self-contained `report.html` beside the task. A local dashboard browses them.

## Install

Requires Node.js 22 or newer.

```bash
npm install -g agenteval
agenteval --version
```

Or without installing: `npx agenteval <command>`.

### API key

Models are called through [OpenRouter](https://openrouter.ai), with one key:
`OPENROUTER_API_KEY`. You only need it for tasks that call models; `plan`,
`init` and offline tasks never do.

```bash
export OPENROUTER_API_KEY=sk-or-...                   # this shell
echo 'export OPENROUTER_API_KEY=sk-or-...' >> ~/.zshrc  # every new shell
echo 'OPENROUTER_API_KEY=sk-or-...' > .env.local       # this directory only
```

A variable already set in your environment wins over `.env.local`, which is
read from the directory you run in. Keep `.env.local` out of git
(`echo .env.local >> .gitignore`). To check the key works:
`agenteval models <task>` sends each model one tiny request (a fraction of a
cent); `--catalog-only` checks the ids and prices without a key.

An agent candidate's own key (e.g. `ANTHROPIC_API_KEY` for Claude Code) is read
by the agent, not by agenteval. On the host it inherits your environment; in a
container, name it in the spec: `env: { ANTHROPIC_API_KEY: "" }` (`""` passes
the host's value through).

## Quick start (free, offline)

```bash
mkdir my-evals && cd my-evals

agenteval init my-task              # creates tasks/my-task/, runnable as-is
agenteval plan my-task              # what a run would do — no key, no calls
agenteval run my-task --yes --html  # run it
agenteval dash                      # browse tasks and runs at http://127.0.0.1:4173
```

The generated task compares two local commands and grades them with a
TypeScript compile, so it costs nothing. The run prints where it wrote its
evidence — open `report.html` there, or use the dashboard.

From here, edit `tasks/my-task/spec.yaml`: swap the candidates for models or
your own agent, add inputs, and turn on a judge. See
[Writing a task](#writing-a-task).

## Samples

The package ships seven sample tasks. Copy one into your workspace to run it:

```bash
mkdir -p tasks
cp -R "$(npm root -g)/agenteval/examples/tasks/custom-check" tasks/
agenteval run custom-check --yes --html
```

| sample | shows | cost |
|---|---|---|
| `custom-check` | grading with your own check script; wrapping any program as a candidate | free |
| `chain-offline` | a two-step workflow and its end-to-end validation | free |
| `docker-sandbox` | the same agent run in a Docker container and on the host; each trial records which | free (needs Docker) |
| `compare-models` | two real models, a deterministic gate plus a pairwise judge | billed, capped at $0.50 |
| `compare-agents` | Claude Code, OpenCode and pi on the same coding job, graded by behavioural tests | billed by the agents; judge capped at $1 |
| `compare-agent-models` | one agent (OpenCode) with three models — the model's effect, agent held fixed | billed by OpenRouter; judge capped at $1 |
| `compare-setups` | concrete agent + model combinations head to head | billed by the agents; judge capped at $1 |

The agent samples need those agents installed, and run them **unsandboxed on
your machine** — read the warnings in their `spec.yaml` and see
[Safety](#safety) first.

## Concepts

- **Workspace** — a directory with a `tasks/` folder. Commands find it by
  walking up from where you stand; with none found, the current directory is
  the workspace. `--workspace DIR` names one explicitly.
- **Task** — `tasks/<name>/`, self-contained: `spec.yaml` plus the inputs,
  prompts, rubrics, agents and checks it refers to, and its own `runs/`. Copy
  the directory anywhere and it still runs.
- **Step** — one thing being evaluated, e.g. "write release notes". A task has
  one or more.
- **Candidate** — what competes on a step: a model (`model: vendor/name`) or a
  command (`adapter: agent-cli`), such as `claude -p` or your own script.
- **Input** — a test case, `inputs/<id>.txt`. Every candidate runs every input,
  `trials_per_case` times.
- **Required check** — the deterministic gate that decides success or failure:
  a `tsc` compile, or any program you write.
- **Judge** — an optional model that compares outputs pairwise (in both orders)
  and/or scores them 1–5 against a rubric.
- **Recommendation** — per step: which candidates passed the eligibility gates,
  and which one the step's `operating_mode` picks among them.

## Commands

Every command takes `--help`.

| command | does | needs a key? |
|---|---|---|
| `agenteval init <name>` | create a runnable offline task | no |
| `agenteval ls` | list tasks, their runs, and what the runs spent | no |
| `agenteval plan <task>` | count what a run would do: generations, judge calls, budget | no |
| `agenteval models <task>` | check each model id is listed and reachable, and its price | yes (`--catalog-only`: no) |
| `agenteval run <task> --yes` | execute (without `--yes` it only prints the plan) | if the task calls models |
| `agenteval report <run>` | re-render a run's `report.html` | no |
| `agenteval dash` | serve the dashboard on http://127.0.0.1:4173 | only to start runs from it |

`<task>` is a task name in the workspace (`my-task`), a task directory
(`./somewhere/my-task`), or a path to a `spec.yaml`.

Useful `run` options: `--html` (write `report.html`), `--json` (one JSON event
per line, for scripts), `--reuse` (reuse identical earlier generations),
`--concurrency N`. On an interactive terminal `run --yes` shows a live progress
block; piped, redirected or with `--plain` it prints one line per event.

`plan` reads the spec and counts; it makes no call and needs no key. Per step:

```
▶ <task> / <step> [<producer>] — <candidates> candidates × <inputs> inputs × <trials> trials
  generations N · pairwise P pairs (2P judge calls, up to 3 attempts each) · absolute S calls
  judge <model> · concurrency C · budget $B
  benchmark <mode> · cache <mode> · directional yes|no
```

`pairwise off` and `absolute off` mean no judge call will be made. `plan`
counts calls; `models` gives per-token prices, and `budget_usd` is the ceiling.

Exit codes: `0` done · `1` failed · `2` usage error · `3` finished but partial
(the budget stopped it, or the machine slept and durations are unreliable).

## Writing a task

A single step comparing two models, graded by a check script and a judge:

```yaml
protocol_version: "0.3"
run_name: notes
budget_usd: 1                      # hard ceiling for the whole run

workflow:
  control_candidate: sonnet        # the single-model baseline for chained workflows
  steps:
    - id: notes
      version: "1"                 # bump when you change what the step means
      producer: prompt
      prompt_file: prompts/notes.md      # {{input}} is replaced by the test case
      rubric_file: rubrics/notes.md      # what the judge grades against
      test_set:
        id: changelog-v1
        inputs: [changelog]        # inputs/changelog.txt
      candidate_ids: [sonnet, deepseek]
      required_checks: [release-notes]
      judged_dimensions: [faithfulness, clarity]
      success_criteria:
        mandatory_checks: all      # success = every required check passed
      operating_mode: lowest-cost  # or fastest-within-cost-ceiling | highest-assurance | judge-preference
      eligibility:                 # candidates below these are gated out, with the reason
        minimum_reliability: 1.0
        minimum_required_check_pass_rate: 1.0
      maximum_completion_time_seconds: 120

candidates:
  - id: sonnet
    model: anthropic/claude-sonnet-5
    provider_route: openrouter
  - id: deepseek
    model: deepseek/deepseek-v4-pro
    provider_route: openrouter

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
    methods: [pairwise-swap]       # [] = no judge; add absolute-1-5 for 1–5 scores

execution:
  trials_per_case: 1
  concurrency: 2

x-harness:
  producer: prompt
  prompt_file: prompts/notes.md
```

Run `agenteval plan <task>` after every edit: it validates the spec and names
any unknown or contradictory field.

**Command candidates.** Any program can compete:

```yaml
  - id: my-agent
    adapter: agent-cli
    cli:
      argv: [node, agents/run.mjs, "{{input}}"]
```

It runs in a fresh, empty work dir. `{{input}}` is replaced by the test case
(also written to `.eval-input.txt`) and `{{workdir}}` by the work dir's path.
The files it leaves behind are its deliverable; if it leaves none, its stdout
is. Relative paths resolve against the task directory.

**Check scripts.** A `kind: command` check runs in the trial's work dir, next
to the candidate's files, `output.txt` (the deliverable), `input.txt` (the test
case) and `meta.json`. Exit `0` passes, exit `1` fails the candidate; anything
else — a crash, a timeout — is recorded as an evaluator error, never blamed on
the candidate. Print `{"evidence": "...", "reason": "..."}` to keep evidence
with the trial. `kind: tsc` with `scaffold_dir: scaffold` instead compiles the
produced TypeScript against `scaffold/tsconfig.json`.

**Workflows.** A task can have several steps, each evaluated on its own inputs.
Add `input_from: <earlier step id>` to chain them: the run then also executes
the whole chain twice — once with `control_candidate` on every step, once with
each step's recommended candidate — and reports whether the combination beats
the single model. The `chain-offline` sample shows this.

**How much to trust a result.** With one input and one trial every result is
marked *directional*: enough to look at the evidence, not to decide. Add inputs
and trials before trusting a ranking.

## Reading a run

Each run writes `tasks/<task>/runs/<runId>/`:

| file | holds |
|---|---|
| `report.html` | the page to read first — standings, evidence, what was not observed |
| `recommendation.json` | the eligibility gates and the pick, with reasons |
| `summary.json` | per-candidate rates, with numerators and denominators |
| `scores.jsonl` | one row per trial: outcome, check result and evidence, judge, cost |
| `ledger.json` | cost by component: generation, judging, scoring, retries |
| `GAPS.md` | what this run could not observe — recorded as unknown, never guessed |
| `trace.jsonl` | one event per model call, without prompt text |
| `raw/` | each candidate's deliverable, one file per trial |

A multi-step run has one such directory per step, plus `workflow.json` and,
when chained, `e2e-validation.json` at the root.

## Controlling cost

- Run `plan` first. `run` without `--yes` is the same preview, so a typo cannot
  bill you.
- `budget_usd` is enforced: once spend reaches it, the run stops starting new
  work, records what it skipped, and exits `3`.
- `methods: []` plus command-only candidates make a task free.
- `agenteval models <task> --catalog-only` catches a mistyped model id for free.
- On macOS, run billed tasks under `caffeinate -i`. If the machine sleeps, the
  run detects the gaps, says so in `GAPS.md`, and exits `3`.

## Safety

- A command (`agent-cli`) candidate runs **on your machine as you** — your
  files, network and credentials. To run it in a Docker container instead, add
  `image:` to its `cli:` block. Only the work dir is writable; a script the task
  ships (`agents/...`) is mounted read-only, and `checks/` is not mounted. The
  network is off unless you set `network:`, and only the variables you list in
  `env:` are passed in. Every trial records whether it was isolated. The
  `docker-sandbox` sample shows both ways side by side.
- Check scripts and `tsc` always run on your machine. Declare only checks you
  would run yourself.
- An agent's own spending is invisible to agenteval: it shows as unobserved,
  and `budget_usd` cannot stop it. Only model candidates and the judge count
  against the budget.
- The dashboard listens on 127.0.0.1 only and has no authentication.

## Troubleshooting

| symptom | what to do |
|---|---|
| `OPENROUTER_API_KEY is not set` | export it or put it in `./.env.local`; `plan` and `models --catalog-only` need no key |
| `no spec found for "..."` | you are outside the workspace holding it — `cd` there, pass `--workspace`, or give the task's path |
| `unknown flag --...` | flags are strict; see `agenteval <command> --help` |
| a candidate shows `evaluator_error` | your check crashed or exited with something other than 0/1 — the check's fault, not the candidate's |
| exit code `3` | the run finished but is partial: read its `GAPS.md` |
| a model fails mid-run | run `agenteval models <task>` after editing candidate ids |

## Development

Working on agenteval itself — architecture, tests, the evidence format — is
covered in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 57blocks
