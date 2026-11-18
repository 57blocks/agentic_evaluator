# agb-flow

Which model should run each step of agb's flow? One spec, five of agb's six
stages, five models. agb at `beb56b90` (2026-11-09); not comparable with the
October run, whose agb had other stages and whose code step left later
tasks' tests in the tree.

| Step | Input (a real agb project, at the moment the step started) | Candidate runs | Right |
|---|---|---|---|
| spec | the client's documents in `docs/prd-source/` (`fixture/spec/`: chessicle, invoice) | `claude -p /agb-skills:agb-spec` | PRD, `.ab/prd.json` and source snapshot; no hard finding at the stage; `prd-id`, `prd-quality` clean (`checks/spec-gates.mjs`) |
| architecture | the adopted PRD (`fixture/architecture/`: demo-todo, chessicle, invoice) | `claude -p /agb-skills:agb-arch` | API contract and `docs/DESIGN.md`; no hard finding; `design-closure` clean (`checks/arch-gates.mjs`) |
| task-breakdown | PRD, design and contracts (`fixture/task-breakdown/`, 3 projects) | `claude -p /agb-skills:agb-tasks` | every page and endpoint claimed, no domain cycle (`checks/plan-gates.mjs`) |
| test-design | the adopted task plan (`fixture/test-design/`, 3 projects) | `claude -p /agb-skills:agb-test-plan` | every acceptance criterion covered (`checks/test-plan-gates.mjs`) |
| implementation | demo-todo just before T-004, T-005, T-006 (`fixture/implementation/`) | `agb run`, that one task | the task's own acceptance tests, restored from the fixture, all pass (`checks/task-tests.mjs`) |

Delivery (agb's sixth stage) and the end-to-end chain are not in this round.

## How a step runs

`agents/agb-step.mjs` sets every model slot agb has (`models`, `verifier`,
`securityReview`) to the candidate, commits the tree, and runs the stage:

- The four planning stages are agb's own slash commands, run unattended with
  `--accept-recommended` and a system note saying no one is there: questions
  with a recommendation take it, the rest are left open in the ledger. The
  commands converge with `./.ab/bin/agb check`, which the wrapper provides.
- The code step is `agb run` with the mutation pass, verifier, security
  review and contract audit off: what is measured is the candidate writing
  code. `AB_USAGE_WAIT_MAX_H=0`: a subscription's usage limit fails the trial
  instead of waiting out the window.

## Checks

Calibrated on the adopted projects (`references/<step>/<input>/`): every
check fails an untouched start and passes the references
(`agenteval check-task agb-flow`, free). A gate the references trip is
counted in the evidence, never gated on: `prd-content-preserved` (invoice's
adopted PRD drops 158 source lines) and `arch-closure` (demo-todo's design
predates `.ab/arch.json`; invoice's has a component cycle).

## Fixtures

- spec: chessicle's PRD and TRD; invoice's original PRD and prototype
  (`invoice_b`). demo-todo has no external document (its PRD was generated).
- architecture: the task-breakdown fixture minus `_contracts/`,
  `docs/DESIGN.md`, `.ab/design.json`, `.ab/arch.json`.
- implementation: `git archive` of agb-demo-todo at the commit before each
  `[T-xxx]`, minus test files only later tasks own and the cross-page
  `client/src/App.test.tsx`. References: the `[T-xxx]` commit itself.
- Every `.abrc.json` says `"lang": "zh"`: the sources are Chinese, and
  without it agb's commands write English and translate the source line by line.

## Candidates

`argv` names the model as the tool knows it; `model` is the OpenRouter id
agenteval prices the reported tokens with. DeepSeek is reached directly
(`DEEPSEEK_API_KEY`), Kimi and GLM through OpenRouter (`OPENROUTER_API_KEY`),
both through claude's Anthropic-compatible endpoint. OpenRouter only
guarantees tool use for Anthropic's own models: a failure there may be the
bridge's, not the model's. Claude models sign in with `CLAUDE_CODE_OAUTH_TOKEN`.

## Cost

`smoke.yaml` first (opus-5.5 and deepseek-flash, one input per step,
`budget_usd: 40`), then `spec.yaml` (`budget_usd: 300`). Per-trial caps
(claude's `--max-budget-usd`): spec, architecture and task-breakdown $15;
test-design $10. `agb run` has had no cost cap since agb #109, so the code
step is bounded only by its time limit (3600 s).
