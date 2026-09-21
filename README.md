# agentic-evaluator

Model and workflow evaluation harness that records protocol v0.4 evidence
and a reproducible operating-mode recommendation. See the
[Agent Evaluation Protocol v0.4](docs/AGENT-EVALUATION-PROTOCOL%20(1).md).
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
  report.html         canonical page          legacy-report.html  original harness page
  raw/ records.json report.json report.md     legacy layer, aggregate unchanged
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

```bash
pnpm install
cp ../agentic-builder/.env.local .env.local        # OPENROUTER_API_KEY=...
pnpm run check-models specs/codegen-w38.yaml       # reachable from here? prices?
pnpm run run -- --suite specs/codegen-w38.yaml --html          # preview only
caffeinate -i pnpm run run -- --suite specs/codegen-w38.yaml --html --yes    # execute
pnpm run report runs/<runId>                                    # re-render report.html
pnpm run demo                                                   # local UI at http://127.0.0.1:4173
pnpm test
```

The demo UI is read-only: it lists `specs/*.yaml`, completed `runs/`, and
committed fixtures as samples. It does not start paid evals. Open a spec to
see each independent step’s candidates; open a run to see the per-step
recommendation and the canonical `report.html`.

Run paid specs under `caffeinate -i` (macOS). A suspended host leaves regular
multi-minute gaps between trace events and every timeout and duration in that
run becomes meaningless; `summary.json.integrity` counts such gaps and GAPS.md
warns when any exist. `pnpm run rescore` refreshes the legacy layer only
(report.json, legacy-report.html); canonical rows are not re-derived.

A spec is the versioned source of truth (`specs/*.yaml`, schema in
`src/spec/schema.ts`). A spec may list several **independent** steps; each
gets its own recommendation. Add `input_from` to chain a step onto the previous
one; that also turns on the end-to-end validation pass.
Legacy `suites/*.json` still run (candidate id = model id), but that path is
**deprecated**: it predates the candidate-as-object contract and every new
step belongs in a spec.

## Layout

```
src/run.ts            driver: spec → trials → judge → score → legacy + canonical outputs
src/adapters/         candidate adapters: model-api, codegen, agent-cli (protocol §5)
src/llm.ts            OpenRouter client; provider, finish reason, labeled cost source, LlmError
src/judge.ts          pairwise with order swap; keeps every attempt's cost
src/score.ts          absolute 1–5 with anchors
src/check.ts          tsc --noEmit required check with four-state result and version
src/spec/             YAML spec loader + JSON Schema + semantic checks
src/canon/            protocol layer: states, success decision, hash, usage, cost, trace,
                      manifest, rows, adapt, rates, write
src/html.ts           escapeHtml — the only thing both report layers share
src/report-v2.ts      canonical step report page (+ report-charts, report-evidence)
src/report-workflow.ts canonical workflow page: verdict, arms, per-step links, ledger
src/render.ts         legacy renderer for report.ts + dashboard.ts (frozen)
src/demo/             local read-only UI (`pnpm run demo`)
tests/                node:test; parity uses tests/legacy-aggregate.ts (pristine oracle)
fixtures/             committed real runs used by the parity test
docs/                 protocol, implementation plan, harness-to-protocol map, runner design
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

## The two report layers

Every run writes both a **canonical** set (`manifest.json`, `scores.jsonl`,
`evaluations.jsonl`, `ledger.json`, `summary.json`, `recommendation.json`,
`report.html`) and the **legacy** set the original harness wrote
(`records.json`, `report.json`, `report.md`, `legacy-report.html`). This is a
deliberate transition state, not drift. Three things hide under "legacy" and
they have different fates:

1. `tests/legacy-aggregate.ts` — a pristine copy of the original aggregate,
   used by `parity.test.ts` as the oracle. **Permanent.** It is frozen by
   design and is not part of any merge.
2. Legacy run outputs (`records.json`, `report.json`, `raw/`). Retire once the
   canonical files reconstruct every field they carry and nothing reads them.
3. The legacy renderer (`render.ts`, `report.ts`, `dashboard.ts`,
   `summarize.ts`, `i18n.ts`). **Frozen — no new features go here.** It still
   does one thing the canonical pages cannot: `dashboard.ts` merges several
   steps into one cross-step view, while `report-v2.ts` renders a single step
   and the workflow level has no page at all.

**Retirement gate.** Delete the legacy renderer and stop writing the legacy
outputs when (a) a canonical page covers what `dashboard.ts` shows, and (b)
parity holds on every fixture. `report-workflow.ts` closes half of (a): it
renders the steps of **one** run. `dashboard.ts` does something else — it scans
the whole results directory and keeps the newest run per step, a cross-*run*
view that no canonical page has yet. Until then both are written.
`summarize.ts` writes an LLM-authored verdict; it is commentary, never a
recommendation, and must not enter the canonical report.

The canonical pages must not import from `render.ts` — shared HTML helpers live
in `src/html.ts` so the legacy layer can be deleted in one piece.

## Not in this milestone

Multi-trial pairwise, confidence intervals, Docker sandbox, human calibration,
and the remaining §8 comparison arms (every single-configuration workflow, the
current production workflow — named in `e2e-validation.json.not_compared`).
Independent multi-step specs, `input_from` handoff, and the two-arm end-to-end
validation of a mixed assignment run today. In-process agentic-builder producers are not imported;
wrap an external agent with `adapter: agent-cli`. Eligibility gates and
operating-mode selection now write `recommendation.json`; the canonical report
uses that file. Pairwise win rate is still shown but does not choose.
See `docs/HARNESS-TO-PROTOCOL-MAP.md` for the row-by-row status.
