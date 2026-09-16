# agentic-evaluator

Model and workflow evaluation harness that conforms to the
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
  GAPS.md             protocol fields this run could not observe (recorded null, never defaulted)
  report.html         canonical page          legacy-report.html  original harness page
  raw/ records.json report.json report.md     legacy layer, aggregate unchanged
```

## Run

```bash
pnpm install
cp ../agentic-builder/.env.local .env.local        # OPENROUTER_API_KEY=...
pnpm run check-models -- specs/codegen-w38.yaml    # every model routable? prices?
pnpm run run -- --suite specs/codegen-w38.yaml --html          # preview only
pnpm run run -- --suite specs/codegen-w38.yaml --html --yes    # execute
pnpm run report -- runs/<runId>                                 # re-render report.html
pnpm test
```

A spec is the versioned source of truth (`specs/*.yaml`, schema in
`src/spec/schema.ts`). Legacy `suites/*.json` still run; candidate id = model id.

## Layout

```
src/run.ts            driver: spec → trials → judge → score → legacy + canonical outputs
src/llm.ts            OpenRouter client; provider, finish reason, labeled cost source, LlmError
src/judge.ts          pairwise with order swap; keeps every attempt's cost
src/score.ts          absolute 1–5 with anchors
src/check.ts          tsc --noEmit required check with four-state result and version
src/spec/             YAML spec loader + JSON Schema + semantic checks
src/canon/            protocol layer: states, success decision, hash, usage, cost, trace,
                      manifest, rows, adapt, rates, write
src/report-v2.ts      canonical report page
tests/                node:test; parity uses tests/legacy-aggregate.ts (pristine oracle)
fixtures/             committed real runs used by the parity test
docs/                 protocol, implementation plan, harness-to-protocol map, runner design
```

## Not in this milestone

Multi-trial pairwise, eligibility gates that affect ranking, operating-mode
selection, confidence intervals, Docker sandbox, control-candidate comparison,
human calibration, agent producers (they import agentic-builder's src).
See `docs/HARNESS-TO-PROTOCOL-MAP.md` for the row-by-row status.
