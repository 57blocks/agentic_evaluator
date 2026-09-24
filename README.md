# agenteval

[![npm](https://img.shields.io/npm/v/57b-agenteval)](https://www.npmjs.com/package/57b-agenteval)

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

Published on npm as [`57b-agenteval`](https://www.npmjs.com/package/57b-agenteval).
Requires Node.js 22 or newer.

```bash
npm install -g 57b-agenteval        # installs the `agenteval` command
agenteval --version
```

Or without installing: `npx 57b-agenteval <command>`. To update, run the
install again; to remove it, `npm uninstall -g 57b-agenteval`.

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

The generated task compares two local stand-in commands and grades them with
a TypeScript compile, so it costs nothing. The run prints where it wrote its
evidence — open `report.html` there, or use the dashboard.

### A real one (about a cent)

```bash
export OPENROUTER_API_KEY=sk-or-...
agenteval init real --models        # two cheap models, a tsc gate, a judge
agenteval run real --yes --html
```

Two models from different vendors write the same small function; `tsc` gates
what they wrote and a judge from a third vendor compares the ones that compile.
The recommendation comes from the gates and the operating mode (here: lowest
cost); the judge's preference is reported beside it, and the report says when
the two disagree. Budget is capped at $0.05.

From here, edit `tasks/<name>/spec.yaml`: swap the models or use your own
agent, add inputs, and raise the trials. See [Writing a task](#writing-a-task).

## Tutorial: compare two models on your own prompt

This builds a task from scratch: two models summarise two short texts, a check
script you write rejects summaries that are too long, and a judge compares the
rest. One run costs well under a cent. Every file below is complete — copy
them as they are, then change them.

```
my-evals/
  tasks/summary/
    spec.yaml            what to run and how to decide
    prompts/summary.md   the prompt; {{input}} is replaced by each input
    inputs/release.txt   test case 1
    inputs/incident.txt  test case 2
    rubrics/summary.md   what the judge compares
    checks/length.mjs    the pass/fail gate
```

`prompts/summary.md`:

```
Summarise the text below for a busy reader in at most three sentences.
Keep every number that matters. Reply with the summary only.

{{input}}
```

`inputs/release.txt` and `inputs/incident.txt` hold one text each — paste in
any paragraph you like. Each input is one test case, and every candidate
answers every input.

`rubrics/summary.md` — one numbered item per dimension the judge compares; the
bold names must match `judged_dimensions` in the spec:

```markdown
# summary rubric

Judge two summaries of the same text.

1. **faithfulness** — says nothing the text does not; numbers are right.
2. **coverage** — keeps what a busy reader needs: the main change or event,
   its impact, and the key numbers.
3. **concision** — no filler; shorter wins when both are equally faithful
   and complete.
```

`checks/length.mjs` — runs in each trial's working directory, where
`output.txt` is the candidate's answer. Exit 0 passes, exit 1 fails the
candidate; the JSON it prints is kept as evidence:

```js
import fs from "node:fs";

const text = fs.readFileSync("output.txt", "utf8").trim();
const words = text.split(/\s+/).filter(Boolean).length;
const sentences = text.split(/[.!?](?:\s|$)/).filter((s) => s.trim()).length;
const ok = text.length > 0 && words <= 80 && sentences <= 3;

console.log(JSON.stringify({
  evidence: `${sentences} sentence(s), ${words} words`,
  ...(ok ? {} : { reason: "longer than three sentences or 80 words" }),
}));
process.exit(ok ? 0 : 1);
```

`spec.yaml`:

```yaml
protocol_version: "0.3"
run_name: summary
budget_usd: 0.05                  # hard ceiling for the whole run

workflow:
  control_candidate: deepseek-flash
  steps:
    - id: summarise
      version: "1"
      producer: prompt            # send prompt_file to each model
      prompt_file: prompts/summary.md
      rubric_file: rubrics/summary.md
      test_set:
        id: summaries-v1
        inputs: [release, incident]         # inputs/release.txt, inputs/incident.txt
      candidate_ids: [deepseek-flash, gpt-5-nano]
      required_checks: [length]
      judged_dimensions: [faithfulness, coverage, concision]
      success_criteria:
        mandatory_checks: all     # a trial succeeds when every required check passes
      operating_mode: lowest-cost # among those that pass the gates, pick the cheapest
      eligibility:                # gates: fall below one and you are out, with the reason
        minimum_reliability: 1.0
        minimum_required_check_pass_rate: 1.0
      maximum_completion_time_seconds: 120

candidates:
  - id: deepseek-flash
    model: deepseek/deepseek-v4-flash
    provider_route: openrouter
  - id: gpt-5-nano
    model: openai/gpt-5-nano
    provider_route: openrouter

evaluators:
  required_checks:
    length:
      kind: command
      argv: [node, checks/length.mjs]
      version_files: [checks/length.mjs]    # editing the check changes its version
      timeout_seconds: 30
  judge:
    model: google/gemini-2.5-flash          # must be a third vendor
    provider_route: openrouter
    rubric_file: rubrics/summary.md
    methods: [pairwise-swap]                # compare pairs, in both orders

execution:
  trials_per_case: 1
  concurrency: 2

x-harness:                                  # required; repeats the producer
  producer: prompt
  prompt_file: prompts/summary.md
```

Then, from `my-evals/`:

```bash
agenteval models summary --catalog-only   # are the model ids right? free
agenteval plan summary                    # 4 generations, 4 judge calls, $0.05 ceiling; free
agenteval run summary --yes --html        # billed: well under a cent
```

What you get: each model answers each input; `length` passes or fails each
answer; the judge compares the two models' answers on each input; the
recommendation is the cheapest model that passed every gate. The terminal ends
with a table like

```
  candidate       success  check  duels     cost    p50
  deepseek-flash      2/2    2/2    1/2  $0.0001   4.8s
  gpt-5-nano          2/2    2/2    0/2  $0.0010  12.6s
  → deepseek-flash (directional) · total $0.0052
```

— `success` is trials that passed the check, `duels` is pairwise wins,
`cost` is generation cost per success. Open `report.html` in the run directory
it prints, or `agenteval dash`. [Reading a run](#reading-a-run) explains the
words in it.

To let the judge alone decide, see [Judge-only grading](#judge-only-grading).
To put your own program in as a candidate, see
[Command candidates](#command-candidates).

## Samples

The package ships seven sample tasks. Copy one — or all of them — into your
workspace and run it by name:

```bash
mkdir -p tasks
cp -R "$(npm root -g)/57b-agenteval/examples/tasks/custom-check" tasks/   # one
cp -R "$(npm root -g)/57b-agenteval/examples/tasks/"* tasks/             # or all seven
agenteval ls                                                        # what you now have
agenteval run custom-check --yes --html
```

Copying keeps their runs in your workspace instead of in the global install.

| sample | shows | needs | cost |
|---|---|---|---|
| `custom-check` | grading with your own check script; wrapping any program as a candidate | nothing | free |
| `chain-offline` | a two-step workflow and its end-to-end validation | nothing | free |
| `docker-sandbox` | the same agent run in a Docker container and on the host; each trial records which | Docker running | free |
| `compare-models` | two real models, a deterministic gate plus a pairwise judge | `OPENROUTER_API_KEY` | capped at $0.50 |
| `compare-agents` | Claude Code, OpenCode and pi on the same coding job, graded by behavioural tests | the three agents and their keys; `OPENROUTER_API_KEY` for the judge | agents bill their own providers; judge capped at $1 |
| `compare-agent-models` | one agent (OpenCode) with three models — the model's effect, agent held fixed | OpenCode; `OPENROUTER_API_KEY` | billed by OpenRouter; judge capped at $1 |
| `compare-setups` | concrete agent + model combinations head to head | the three agents and their keys; `OPENROUTER_API_KEY` | agents bill their own providers; judge capped at $1 |

Before a billed sample, look first — both are free:

```bash
agenteval models compare-models --catalog-only   # every model id listed, and its price
agenteval plan compare-models                    # how many calls, and the budget ceiling
```

The agent samples run those agents **unsandboxed on your machine** — read the
warnings in their `spec.yaml` and see [Safety](#safety) first. What an agent
spends on its own provider is invisible to agenteval and its budget.

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
| `agenteval init <name>` | create a runnable offline task (`--models`: a small real one) | no |
| `agenteval ls` | list tasks, their runs, and what the runs spent | no |
| `agenteval plan <task>` | count what a run would do: generations, judge calls, budget | no |
| `agenteval models <task>` | check each model id is listed and reachable, and its price | yes (`--catalog-only`: no) |
| `agenteval run <task> --yes` | execute (without `--yes` it only prints the plan) | if the task calls models |
| `agenteval report <run>` | re-render a run's `report.html` (run id or path) | no |
| `agenteval dash` | serve the dashboard on http://127.0.0.1:4173 | only to start runs from it |

`<task>` is a task name in the workspace (`my-task`), a task directory
(`./somewhere/my-task`), or a path to a `spec.yaml`.

Useful `run` options: `--html` (write `report.html`), `--json` (one JSON event
per line, for scripts), `--reuse` (reuse identical earlier trials instead of
paying for them again — whole, including their check results, so do not use it
right after changing a check), `--concurrency N`. On an interactive terminal `run --yes` shows a live progress
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

The [tutorial](#tutorial-compare-two-models-on-your-own-prompt) has a complete
spec; this section is the reference. Run `agenteval plan <task>` after every
edit — it validates the spec and names the field it rejects.

**Rules `plan` enforces**

- `protocol_version`, `run_name`, `workflow`, `candidates`, `evaluators` and
  `execution` are required.
- `evaluators.judge` is required even when no judge runs: give it a model and
  `methods: []`.
- The judge's vendor (the part before `/` in the model id) must differ from
  every candidate's, so a judge cannot favour its own vendor's output.
- `x-harness.producer` is required, and must name the producer the steps use
  (see below); with `producer: prompt` it also needs `prompt_file`.
- A step's `required_checks` names checks declared under
  `evaluators.required_checks`, at most one per step.
- Candidate ids are yours to choose; every id in `candidate_ids` must be
  declared under `candidates`.

**Producers** — how a candidate's answer is made:

- `prompt` — each model gets `prompt_file` with `{{input}}` replaced by the
  input's text. Its answer is the deliverable (`output.txt` in the check's
  directory). Use it for models answering in text.
- `codegen` — for code: models are asked for files in ```` ```file:<name> ````
  blocks, which are parsed out and written to disk, so a `tsc` check can
  compile them. Command candidates (below) also use `codegen`: the files they
  leave behind are their deliverable. No `prompt_file` needed.

**Operating modes** — how the pick is made among candidates that passed every
gate: `lowest-cost` (cheapest per success), `fastest-within-cost-ceiling`
(fastest median time under `eligibility.cost_ceiling_per_success_usd`),
`highest-assurance` (highest success rate), `judge-preference` (the judge's
favourite).

**Eligibility gates** — `minimum_reliability` (share of trials that succeeded),
`minimum_required_check_pass_rate`, `maximum_p95_ms`. A candidate below any gate
is removed, and the report says which gate and by how much.

### Judge-only grading

With no check, no trial can succeed or fail — the outcome is *undetermined* —
so the `minimum_reliability` and `minimum_required_check_pass_rate` gates would
remove every candidate. To let the judge alone decide:

```yaml
      required_checks: []
      judged_dimensions: [faithfulness, coverage, concision]
      operating_mode: judge-preference   # no eligibility, no success_criteria
# ...
evaluators:
  required_checks: {}
  judge: { model: google/gemini-2.5-flash, provider_route: openrouter,
           rubric_file: rubrics/summary.md, methods: [pairwise-swap] }
```

The judge's favourite is recommended, and the `success` column reads `0/2`:
without a check nothing was measured as right or wrong. Such a verdict is at
most *directional*.

### Command candidates

Any program can compete:

```yaml
  - id: my-agent
    adapter: agent-cli
    cli:
      argv: [node, agents/run.mjs, "{{input}}"]
```

It runs in a fresh, empty work dir. `{{input}}` is replaced by the test case
(also written to `.eval-input.txt`) and `{{workdir}}` by the work dir's path.
The files it leaves behind are its deliverable; if it leaves none, its stdout
is. It must exit 0: a non-zero exit is recorded as a failed attempt (with the
exit code as the reason), even if it left files behind. Relative paths resolve
against the task directory. Use `x-harness: { producer: codegen }`. Add
`image:` to run it in Docker (see [Safety](#safety)); `agenteval init` and the
`custom-check` sample are working examples.

### Check scripts

A `kind: command` check runs in the trial's work dir: the candidate's files,
plus `output.txt` (the deliverable), `input.txt` (the test case) and
`meta.json` (`{step, candidate, input, trial}`). For a `prompt` model
`output.txt` is its answer as text; for code and command candidates it holds
the files as ```` ```file: ```` blocks, so read the files themselves.

Exit `0` passes, exit `1` fails the candidate; anything else — a crash, a
timeout — is recorded as an evaluator error, never blamed on the candidate.
Print `{"evidence": "...", "reason": "..."}` and both are kept with the trial.
`version_files` hashes the script into the check's version, so editing it
shows up in the evidence. `kind: tsc` with `scaffold_dir: scaffold` instead
compiles the produced TypeScript against `scaffold/tsconfig.json`.

### Workflows

A task can have several steps, each evaluated on its own inputs. Add
`input_from: <earlier step id>` to chain them: the run then also executes the
whole chain twice — once with `control_candidate` on every step, once with each
step's recommended candidate — and reports whether the combination beats the
single model. The `chain-offline` sample shows this.

### How much to trust a result

Every verdict carries a confidence:

- **firm** — at least 10 inputs *and* `execution.minimum_meaningful_difference`
  declared (the smallest gap you consider real), and not `judge-preference`.
- **directional** — otherwise: enough to look at the evidence, not to decide.
  Most small runs are directional, and `judge-preference` always is; the report
  lists why.
- **needs review** — no candidate passed the gates, so nothing was recommended.

Raise `trials_per_case` to see how stable a candidate is; add inputs to see how
general.

## Reading a run

Every run prints the directory it wrote, `tasks/<task>/runs/<runId>/`. Open
`report.html` there, or find the run in `agenteval dash`. Read it top down:

1. **The verdict** — the recommended candidate, the operating mode that picked
   it, and its confidence (firm / directional / needs review; see
   [How much to trust a result](#how-much-to-trust-a-result)).
2. **Selection** — each eligibility gate in order: who it removed, with the
   number that removed them, and who was left. *Gated* means removed by a gate.
3. **Candidates** — per candidate: trials that succeeded, checks passed,
   pairwise record, cost per success, median time.
4. **Judge** — what the judge preferred, per dimension, with its reasons. It is
   reported beside the recommendation, not inside it: unless the mode is
   `judge-preference`, the judge does not choose, and the report says when it
   disagrees with the pick.
5. **Evidence** — every trial's answer exactly as the judge saw it, and the
   check's evidence and reason.
6. **Not observed** — what this run could not measure, recorded as unknown
   rather than guessed (`GAPS.md`).

Words you will meet:

- **success / failure / undetermined** (a trial) — succeeded means every
  required check passed; with no check it is undetermined. A candidate that
  exits non-zero, times out or returns nothing failed to *complete*
  (`malformed`, `timeout`, `refusal`, `provider_error`), which is also a failure.
- **evaluator error** — a check or the judge itself broke; never counted
  against the candidate.
- **control candidate** — `control_candidate`: the baseline. In a single step
  it breaks ties; in a chained workflow it is the single-model arm.
- **pairwise, both orders** — the judge compares A with B, then B with A. If
  the two disagree on a dimension, that dimension is a tie. "Output A/B" in the
  judge's text is the pair's first/second candidate, as the report labels them.
- **cost source** — `provider-reported` is what OpenRouter billed; `none` means
  not observed (command candidates, whose spending agenteval cannot see).

| file | holds |
|---|---|
| `report.html` | the page above; self-contained, opens without a server |
| `recommendation.json` | the gates, who each removed, the pick and its reasons |
| `summary.json` | per-candidate rates, with numerators and denominators |
| `scores.jsonl` | one row per trial: completion, outcome, check evidence and reason, cost |
| `evaluations.jsonl` | one row per check or judge call — the judge's per-dimension reasoning is here |
| `ledger.json` | cost by component: generation, judging, scoring, retries |
| `manifest.json` | exactly what ran: spec, prompt, rubric and check hashes, models, judge |
| `GAPS.md` | what this run could not observe |
| `trace.jsonl` | one event per model call, without prompt text |
| `raw/` | each candidate's deliverable, one file per trial |

A multi-step run has one such directory per step, plus `workflow.json` and,
when chained, `e2e-validation.json` at the root. `agenteval report <run>`
rebuilds `report.html` from these files (by run id or path); no number changes.

## Dashboard

`agenteval dash` serves the workspace at http://127.0.0.1:4173 (`--port` to
change it). The home page lists tasks, their latest verdicts and total spend;
a task's page shows its runs, its test plan read back from `spec.yaml`, and
its files; a run's page opens each step's report. From a task's page you can
also start a run: it first shows the plan and the budget, and runs only after
you confirm those numbers. Stop the dashboard with Ctrl+C.

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
| `x-harness.producer is required` | add `x-harness: { producer: prompt, prompt_file: ... }` (or `codegen`); see [Producers](#writing-a-task) |
| `must have required property 'judge'` | declare `evaluators.judge` even without a judge, with `methods: []` |
| `judge ... shares a vendor with candidate(s)` | pick a judge from a vendor none of the candidates use |
| every candidate gated: `required-check pass rate undefined (0/0)` | the step has no required check; add one, or use [judge-only grading](#judge-only-grading) |
| every trial `skip ... budget limit reached` | `budget_usd` is too low — it must be above 0, even for a free task |
| a candidate shows `evaluator_error` | your check crashed or exited with something other than 0/1 — the check's fault, not the candidate's |
| a candidate `malformed` with `exited with code N` | the command candidate exited non-zero; its files were not graded |
| exit code `3` | the run finished but is partial: read its `GAPS.md` |
| a model fails mid-run | run `agenteval models <task>` after editing candidate ids |

## Development

Working on agenteval itself — architecture, tests, the evidence format — is
covered in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 57blocks
