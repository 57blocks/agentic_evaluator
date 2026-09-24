# Developing agenteval

How the harness is built, and how to work on it from a checkout. For using the
tool, see the [README](README.md).

Model and workflow evaluation harness that records Agent Evaluation Protocol
evidence and a reproducible operating-mode recommendation. The protocol itself
is published at [agent-eval-protocol.vercel.app](https://agent-eval-protocol.vercel.app/).
Started from the `agentic-builder/eval` model-eval harness (imported verbatim in
the first commit) and reshaped so every run leaves protocol-shaped evidence.

## What a run produces

```
runs/<runId>/
  manifest.json       what was tested: spec/rubric/template hashes, models, judge, modes
  trace.jsonl         one event per LLM call (generation, judge, scorer), no prompt text
  scores.jsonl        one row per trial: completion_state × task_outcome, checks, judge, cost
  evaluations.jsonl   one row per evaluator invocation, incl. evaluator_error / not_evaluated
  ledger.json         cost by component: generation, judging, scoring, retries, total
  summary.json        per-candidate rates with numerators and denominators; directionality
  recommendation.json eligibility filters + operating-mode choice
  GAPS.md             protocol fields this run could not observe (recorded null, never defaulted)
  report.html         the page: standings, evidence, what was not observed
  raw/                each candidate's deliverable, one file per trial
```

A multi-step spec writes each step under `runs/<runId>/<stepId>/` plus, at the
root, `workflow.json` (per-step recommendations, the whole-workflow ledger and
the validation verdict), a workflow `GAPS.md` collected from the steps, and
`report.html` — the workflow page, the only view of the §8 verdict, both arms
and what was not compared. When steps declare `input_from`, the run also
validates the workflow end to end (protocol §8):

```
runs/<runId>/
  e2e-control/  e2e-control.json    single-model control arm: one candidate, whole chain
  e2e-proposed/ e2e-proposed.json   the combination each step's recommendation proposes
  e2e-validation.json               adopt-combination / keep-control / not-validated,
                                    with the metric delta, paired case counts and the
                                    comparisons this run did not make (not_compared)
```

## Run

**New here? Read the [README](README.md)** — install, the samples,
writing a task, reading a run, cost control. `examples/` holds seven sample
tasks to start from ([examples/README.md](examples/README.md)); the offline ones are free.

From a checkout of this repository:

```bash
pnpm install
npm link                    # or: pnpm run agenteval <command>
echo 'OPENROUTER_API_KEY=sk-or-...' > .env.local   # only for tasks that call models

agenteval run examples/tasks/custom-check --yes --html   # free sample

agenteval init my-task      # a runnable, offline task to edit
agenteval ls                # what this workspace holds, and what it spent
agenteval plan my-task      # what a run would cost — no key, no call
agenteval run my-task --yes # execute
agenteval dash              # the dashboard, over this workspace
```

On an interactive terminal `run --yes` draws a live progress block (Ink);
piped, redirected, `--plain` or `--json`, it prints one line or one JSON object
per event.

A **workspace** is any directory holding `tasks/`, found by walking up from
where you are standing; `--workspace DIR` names one explicitly. The harness
itself is a workspace, which is why running inside this checkout needs no
flags. A task is self-contained — spec, inputs, rubric, agents, checks,
scaffold and its own `runs/` — so copying the directory somewhere else and
running it there is the supported thing to do, not a trick.

```bash
agenteval models my-task              # reachable from here? at what price?
agenteval models my-task --catalog-only   # no key, nothing billed
agenteval report <runId>              # re-render report.html; no number moves
agenteval run my-task --yes --json    # one JSON event per line, for a script
```

Exit codes: `0` done · `1` failed · `2` usage · `3` completed but partial —
the budget stopped it early, or the trace shows gaps that make its durations
unreliable. The third is why they are separate: a script that cannot tell a
spending cap from an outage will treat a half-run as a whole one.

Run paid tasks under `caffeinate -i` (macOS). A suspended host leaves regular
multi-minute gaps between trace events and every timeout and duration in that
run becomes meaningless; `summary.json.integrity` counts such gaps, GAPS.md
warns, and `agenteval run` exits 3.

`tasks/smoke-local` is the free full-pipeline smoke: local command candidates
and no declared judging method, so it exercises spec load, adapter dispatch,
the required check, the ledger and the recommendation without a single network
call. It is what gates every refactor here.

A spec is the versioned source of truth (`tasks/<name>/spec.yaml`, schema in
`src/spec/schema.ts`). A spec may list several **independent** steps; each
gets its own recommendation. Add `input_from` to chain a step onto the previous
one; that also turns on the end-to-end validation pass.

`evaluators.judge.methods` is honoured exactly: absent means both methods run
(what every spec written before the key existed meant), an empty list means
neither. A step with no method declared is a check-only step — the manifest
records the declaration and GAPS.md states the missing scores are a choice.

The old `suites/*.json` format is gone; loading one fails with a pointer to
`tasks/<name>/spec.yaml`. Runs it wrote under the workspace's top-level
`runs/` are still listed and viewable.

Still its own script, because it compares two sets of runs rather than producing one:

```bash
pnpm run parity       # capture/compare: did a change move the numbers?
pnpm test
```

## Layout

```
bin/agenteval.mjs     the installed entry point
src/cli/              argv -> core, and the only place a run is formatted for a human
  index.ts            dispatch, --help, --version, exit codes
  commands/           run plan ls init models report dash
  print.ts            events -> terminal lines        json.ts  events -> NDJSON
  progress.ts         events -> live-view state (pure)  live.tsx  the Ink view
src/core/             the kernel: no terminal, no cwd, no process.exit
  workspace.ts        where the user's tasks and runs live
  plan.ts             what a run would do, before it does any of it (pure)
  events.ts           what a run emits while it happens
  generate.ts         candidate × input × trial through an adapter
  evaluate.ts         judge and scorer      scorecard.ts  the frozen legacy aggregate
  e2e-arms.ts         the two end-to-end arms and the §8 verdict
  execute.ts          one step, then the run around it
src/paths.ts          the installation: its own tsc, version, built assets, fixtures
src/adapters/         candidate adapters: model-api, codegen, agent-cli (protocol §5)
src/llm.ts            OpenRouter client; provider, finish reason, labeled cost source, LlmError
src/judge.ts          pairwise with order swap; keeps every attempt's cost
src/score.ts          absolute 1–5 with anchors
src/check.ts          tsc --noEmit required check with four-state result and version
src/spec/             YAML spec loader + JSON Schema + semantic checks
src/canon/            protocol layer: states, success decision, hash, usage, cost, trace,
                      manifest, rows, adapt, rates, write
src/html.ts           escapeHtml, shared by the two report pages
src/report-model.ts   what a report says: numbers and decided wording, read by both renderers
src/report-format.ts  formatters and fixed wording, browser-safe
src/report-copy.ts    the report's sentences, rebuilt from gates and rates — never the selector's raw reasons
src/test-plan.ts      a spec (or a run's manifest) read aloud: inputs, candidates, checks, gates, pick, scale
src/report-v2.ts      the step report page (+ report-charts, report-evidence)
src/report-workflow.ts the workflow page: verdict, arms, per-step links, ledger
src/server/           run control (plan gate, SSE, cancel) and the cross-run overview
src/demo/             the dashboard server and its React client
  server.ts           JSON API + artifact routes    catalog.ts  tasks, runs, samples
  client/app/         shell, hash routing, workspace fetch, OS theme
  client/pages/       one file per view: home (task list), task, run, report
  client/features/    task-list, run-control, evidence, task-files, test-plan, report (+ HTML export)
  client/lib/         api, format, tone, shared wording — no JSX, unit-testable
  client/components/ui/  shadcn, stock theme, unmodified
tests/                node:test; parity uses tests/legacy-aggregate.ts (pristine oracle)
examples/             a workspace of sample tasks for new users; the free ones are tested
fixtures/             committed real runs used by the parity test
```

## Judging methods

```yaml
evaluators:
  judge:
    methods: [pairwise-swap]        # absolute-1-5 omitted → not run
```

`methods` is now honoured (it used to be parsed and ignored). A method left
out is not run, not planned, and not billed; the manifest records what was
declared and GAPS.md states that the missing scores are a declaration rather
than a failure, so an old run and a deliberately narrowed one can be told
apart. Absolute scoring is off in `specs/prd-chain-trial.yaml`: with no
per-dimension thresholds the grader returned 5 for everything, once graded
the same prototype-key defect 3 and once 5, and cost a third of the run.

## Run guards

- **Transport retry.** Network faults, 408/409/425/429 and 5xx are retried
  twice with exponential backoff and are not candidate attempts (protocol §7).
  A 403 is retried only when OpenRouter's body shows endpoint routing or geo
  gating — that pool flaps, and one run recorded a candidate as failed on
  every step because of it; a plain 403 is an access problem and is not
  retried. A timeout is never retried: the candidate had its declared budget.
  What the abandoned attempts were billed lands in the ledger's `retries`,
  not in `generation`.
- **`budget_usd` is enforced**, not just printed. The guard is consulted
  before each generation, judged pair and scored output; once spend reaches
  the ceiling the run stops starting work, counts what it skipped by kind into
  `summary.json.budget`, and GAPS.md says the run is partial. One spec, one
  ceiling — the steps of a multi-step run share it.
- **Wall-clock integrity** only accuses the host when a long quiet stretch had
  *nothing* in flight. A 600s timeout produces a ten-minute silence by design;
  those are counted separately as `in_flight_gaps`.

## Required checks

A step's required check is what turns a trial outcome from `undetermined` into
measured success or failure. Two kinds:

```yaml
evaluators:
  required_checks:
    tsc-noemit:
      kind: tsc                       # compile the produced files
      scaffold_dir: scaffold
    task-coverage:
      kind: command                   # run a program you declare
      argv: ["node", "checks/task-coverage.mjs"]
      version_files: [checks/task-coverage.mjs]   # hashed into the evaluator version
      timeout_seconds: 30
```

A command check runs with `cwd` set to the trial's work dir, which already
holds the candidate's parsed artifacts plus `output.txt` (the deliverable),
`input.txt` (the test case) and `meta.json` (`{step, candidate, input,
trial}`). Exit 0 passes, exit 1 fails the candidate, and **anything else — a
missing program, a timeout, any other exit code — is an evaluator error**,
never a candidate failure. stdout may be `{"evidence": "...", "reason": "..."}`
or plain text kept as the evidence.

`checks/task-coverage.mjs` is a worked example: it fails a task breakdown that
cites a requirement id the PRD never defines, or that leaves one uncovered.

One required check per step; declaring two is rejected at load time rather
than silently gating on one. The command runs on this host with your
privileges — the Docker sandbox is still deferred, so only declare checks you
would run yourself.

## One layer, and one permanent oracle

A run writes canonical files only: `manifest.json`, `trace.jsonl`,
`scores.jsonl`, `evaluations.jsonl`, `ledger.json`, `summary.json`,
`recommendation.json`, `GAPS.md`, `report.html`, and `raw/`. The legacy layer
the original harness wrote — `records.json`, `report.json`, `report.md`,
`legacy-report.html` — is gone, along with the renderer behind it
(`render.ts`, `report.ts`, `dashboard.ts`, `summarize.ts`, `i18n.ts`) and
`rescore.ts`, which only ever refreshed it.

Both retirement conditions were met before it went: the dashboard's cross-run
view covers what `dashboard.ts` uniquely showed, and parity holds on every
fixture.

**`tests/legacy-aggregate.ts` stays, permanently.** It is a pristine copy of
the original harness's aggregate, and `tests/parity.test.ts` feeds it the
canonical rows of each committed fixture and checks that it reproduces the
`report.json` that fixture shipped with. The fixtures keep their legacy files
forever — that is what makes them an oracle. The invariant it now guards is
the one worth guarding: **the canonical rows still carry everything the
original computation needed.** If a change to `canon/` quietly drops a field,
this fails, and it fails against numbers produced before any of this code was
written.

`scripts/parity.ts` answers the other question — whether a change moved the
numbers on a live task — by capturing runs before and after and diffing them.
It never spends: it reads runs you already produced.

## Two renderers, one model

A run's report is rendered twice, on purpose, and both renderers read one
model — `src/report-model.ts` computes every number and every sentence that
carries a decision; `src/report-format.ts` and `src/report-copy.ts` hold the
formatters and the sentences, with no Node imports so the browser
bundle can use them too. The selector's own reasons stay untouched in
`recommendation.json`; pages rebuild their sentences from the gates and rates.

- `report.html` is **evidence**. `report-v2.ts` (one step) and
  `report-workflow.ts` (a whole workflow) write it into the run directory at
  run time. It is self-contained, opens from a file path with no server, no
  network and no build, and pins nothing to a React version. It stays the
  durable record.
- The dashboard's **report page** (`src/demo/client/features/report/`) renders
  the same model as React, served by `/api/report/<kind>/<rel>`. Its **Export
  HTML** button saves exactly what is on screen — the DOM plus the page's own
  stylesheet — as one file with no framework and no network requests, so an
  exported page can never say something the dashboard did not.

What must not drift is the wording — "needs review" rather than a blank cell,
a gated candidate named with its reason, the judge's pick beside the
recommendation and never inside it. `tests/report-model.test.ts` holds the
model's numbers and sentences against what `report.html` prints.

## Not in this milestone

Multi-trial pairwise, confidence intervals, Docker sandbox, human calibration,
and the remaining §8 comparison arms (every single-configuration workflow, the
current production workflow — named in `e2e-validation.json.not_compared`).
Independent multi-step specs, `input_from` handoff, and the two-arm end-to-end
validation of a mixed assignment run today. In-process agentic-builder producers are not imported;
wrap an external agent with `adapter: agent-cli`. Eligibility gates and
operating-mode selection now write `recommendation.json`; the canonical report
uses that file. Pairwise win rate is still shown but does not choose.
