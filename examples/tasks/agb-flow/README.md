# agb-flow

Which model should run each step of agb's flow, and does the per-step best
combination beat one model end to end? One spec, three steps, nine models.

| Step | Input (a real agb project, at the moment the step started) | Candidate runs | Right |
|---|---|---|---|
| detail | PRD, design and contracts in place (`fixture/detail/`, 3 projects) | `claude -p` + stage-detail | a task plan, with every page and endpoint claimed and no domain cycle (`checks/plan-gates.mjs`) |
| qa | the adopted task plan in place (`fixture/qa/`, 3 projects) | `claude -p` + stage-qa | a test plan covering every acceptance criterion (`checks/test-plan-gates.mjs`) |
| code | demo-todo just before each task (`fixture/code/`, 8 tasks) | `agb run`, that one task | the task's own acceptance tests, restored from the fixture, all pass (`checks/task-tests.mjs`) |

Then the chain runs end to end on demo-todo, twice: opus-5.5 on every step,
and each step's pick. Each step starts from the previous step's work dir
(`handoff: workdir`); the code step builds every task. The delivered app is
graded by `checks/app-gates.mjs` (installs, builds, its whole test suite
passes under `agb smoke`), and a judge compares the two deliveries.

## What agenteval does for this task

Everything a wrapper used to do around agenteval, agenteval now does
(docs/design/agb-flow-gaps.md): lays each input's fixture in, hands a step's
work dir to the next, runs every trial and check outside this repo, hides
`references/` while candidates run, stops a timed-out agent's whole process
tree, prices the tokens a command reports, and resumes a run that died
(`--reuse`). So `agents/agb-step.mjs` only sets the model, commits, and runs
the step.

## Candidates

`argv` names the model as the tool knows it; `model` is the OpenRouter id
agenteval prices the reported tokens with. DeepSeek is reached directly
(`DEEPSEEK_API_KEY`), the other non-Claude models through OpenRouter
(`OPENROUTER_API_KEY`), both through claude's Anthropic-compatible endpoint.
OpenRouter only guarantees tool use for Anthropic's own models: a failure
there may be the bridge's, not the model's.

## References

`references/<step>/<input>/` is each project's adopted state after that step:
- detail: the adopted plans (invoice's corrected one, 2c2281d).
- qa: the adopted test plans. chessicle's anchors 32 tests to criteria its
  PRD numbers differently; the check records that, never gates on it.
- code: the commit of each `[T-xxx]`.
- e2e: demo-todo's end state (bb90b34) with two test fixes: as delivered,
  its client suite fails when run whole (no cleanup between tests, one
  `findByTestId` on a list), which agb never ran.

`agenteval check-task agb-flow` (free, a few minutes: it installs and runs
the reference app) confirms every check fails an untouched start and passes
its references.

## Cost

Per trial, capped by `max_cost_per_trial_usd`: detail $15, qa $10, code $10.
Fable 5.1 is $10/$50 per million tokens, 2.5× opus-5.5; it may hit the
detail cap on invoice. The chain's code step builds all of demo-todo (8
tasks; agb run cost $19.70 on it originally). `budget_usd` stops new trials
once reported spend passes it.
