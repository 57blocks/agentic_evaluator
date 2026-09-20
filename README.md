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

A multi-step spec writes each step under `runs/<runId>/<stepId>/` plus
`workflow.json` at the root. When steps declare `input_from`, the run also
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
pnpm run check-models -- specs/codegen-w38.yaml    # every model routable? prices?
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
Legacy `suites/*.json` still run; candidate id = model id.

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
src/report-v2.ts      canonical report page
src/demo/             local read-only UI (`pnpm run demo`)
tests/                node:test; parity uses tests/legacy-aggregate.ts (pristine oracle)
fixtures/             committed real runs used by the parity test
docs/                 protocol, implementation plan, harness-to-protocol map, runner design
```

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
