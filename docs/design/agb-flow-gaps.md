# What agenteval lacks to test agb's whole flow

`tasks/agb-flow/spec.yaml` is the spec we want to write: agb's three steps
(task breakdown, test design, code), nine models, each step evaluated on its
own inputs, then the chain validated end to end. Every item below is
something that spec needs and agenteval does not do, found while building the
single-step agb tasks (`agb-breakdown`, `agb-models`, `agb-e2e`), where each
was worked around in a task script instead. The goal is to move them into
agenteval, so the next multi-step agent workflow needs no such scripts.

Status: **todo** unless marked.

## A. Must have: the flow cannot run without these

**A1. Hand a step's work dir to the next step** (`handoff: workdir`). **Done.**
Today a chained step's input is the previous step's files rendered as text
(`handoffPayload`, src/e2e-control.ts). agb's next stage needs the project
itself: `.ab/`, contracts, code, git history. With `handoff: workdir` the
next step's work dir starts as a copy of the previous one's (installs and
build output excluded), and the input text is only the instruction.
*Worked around by:* splitting the flow into separate tasks.

**A2. Inputs that are directories** (`test_set.fixture_dir`). **Done**
(plus `references/<step>/<input>`, and `EVAL_STEP`/`EVAL_INPUT`/`EVAL_CHAINED` for the command).
A step's input is a project at a moment in time. Today every agb wrapper
copies `fixture/<name>/` into its work dir itself, read from a header in the
input text. agenteval should lay `<fixture_dir>/<input>/` into the work dir
before the command starts. The check reads the same fixture (`task-tests`
restores the task's own tests from it), so the check's context needs its path.
*Worked around by:* `cpSync(fixture)` in every wrapper.

**A3. Validate the chain on chosen inputs** (`workflow.e2e.inputs`). **Done.**
The end-to-end arms run on every input of the first step. For agb that
includes invoice: a day and $150+ per arm. The spec should name the root
inputs the chain runs on.

**A4. A final check for the chain** (`workflow.e2e.final_checks`). **Done**
(one check, like a step).
In the chain, the last step's own check does not apply: `code` is evaluated
per task, but the chain builds every task, and what matters is the
delivered app. The arms should grade the end product with checks the spec
names; intermediate steps keep their own checks.

**A5. Run trials and checks outside the repo.** **Done.**
Work dirs live under `tasks/<task>/runs/`, inside this repo. A workspace
with no vite config of its own then runs this repo's `vite.config.ts`
(found: demo-todo's server tests ran the dashboard's). Trial and check work
dirs belong in a temp dir; only the evidence is copied back under `runs/`.
*Worked around by:* final-gates copying itself to a temp dir.

**A6. Keep the answer key out of reach while candidates run.** **Done.**
`references/`, `checks/` and `rubrics/` sit in the task dir, readable by any
command candidate on the host (`check-task` warns, nothing prevents it). With
A5's temp work dirs, the run itself should make them unreadable for the
duration (or run candidates where the task dir is not visible).
*Worked around by:* a shell script that moves `references/` out and back.

**A7. Kill the whole process tree on timeout.** **Done.**
`execFile`'s timeout kills the command, not what it started: a timed-out
`agb run` leaves its claude sessions running, and billing. Spawn each
candidate in its own process group and kill the group.

**A8. Don't kill a candidate for printing a lot.** **Done.**
`maxBuffer` is 2 MB; hours of `agb run` output exceed it, and execFile then
kills the command mid-run. Keep the tail of stdout/stderr instead. Likewise
cap what is read back from the work dir (`collectFiles` reads every file in
full: a 20 MB log becomes the "answer").
*Worked around by:* the wrapper logging to a file and trimming it.

**A9. YAML merge keys and free `x-` keys.** **Done.** `<<: *anchor` was
silently ignored (the parser's merge option was off), and a top-level
`x-providers` block for anchors was rejected.

## B. Needed for a fair comparison across providers

**B1. Price tokens in agenteval** (`model` on agent-cli candidates,
`reports_usage: tokens`). claude prices every model it does not know at Opus
rates (measured: kimi-k3 reported $0.41, really $0.07). The command should
report tokens (input, cache read, cache write, output); agenteval prices them
with the candidate's `model`, from the OpenRouter catalog it already reads,
plus a local table for direct providers (DeepSeek).
*Worked around by:* `providers.mjs` with its own price table.

**B2. A per-trial spend cap handed to the command**
(`max_cost_per_trial_usd` → `{{max_cost_usd}}`, and `{{model}}`). Each
wrapper hard-codes its caps today. Once agenteval prices tokens (B1), it
should also hand the command the cap in the units the command's own budget
flag uses (for claude, its Opus-rate figure), since claude enforces against
its own estimate.
*Worked around by:* `claudeBudgetFor` in providers.mjs.

**B3. `${VAR}` in `cli.env`.** Provider keys come from the environment or
`.env.local`; the spec should reference them, never contain them.

**B4. The budget covers candidates.** `budget_usd` only bounds the judge's
OpenRouter calls. With B1 agenteval knows each trial's cost: it should count
it, and stop scheduling new trials once the budget is spent.

## C. Make the flow practical

**C1. Per-step judge** (`steps[].judge`, `workflow.e2e.judge`). One judge
block serves every step; only `rubric_file` can vary. A plan, a test plan and
a delivered app need different rubrics, files (`show`) and methods.
*Partly done:* `evaluators.judge.show` (on this branch).

**C2. Per-step concurrency** (`steps[].concurrency`). Planning steps run
nine at a time; the code step builds and serves an app, three at most.

**C3. `--concurrency` on the command line overrides the spec.** Known bug.

**C4. Grade what a failed agent left.** A non-zero exit marks the trial
malformed and skips the check. For an agent that stopped half way (budget,
timeout), what it left is the evidence: run the check anyway and record both.
*Worked around by:* agb-e2e's wrapper always exiting 0.

**C5. Resume a long run.** A multi-hour run that dies at trial 50 of 81
starts over today. Skip trials that already have rows (`--reuse` exists for
generation reuse; check whether it covers this).

## D. Open questions (agb or the host, not agenteval)

**D1. Claude's workspace trust. Settled 2026-10-14: no trusted dir needed.**
Measured with claude 2.1.296, `claude -p --permission-mode acceptEdits` in a
temp dir with no trusted ancestor, asked to run `node -e …`: without a rule
it is denied; with `{"permissions":{"allow":["Bash(node:*)"]}}` in
`.claude/settings.local.json` it runs. So in `-p` mode claude honours the
allow list without trust. What does stall is agb: on a denial, `agb run`
refuses to write the rule unless the dir is trusted (permissions.ts,
`isWorkspaceTrusted`, exact path), a premise that this measurement
contradicts. For the eval: pre-seed one generous allow list, the same for
every candidate, in the fixture (`.claude/settings.local.json`), so agb
rarely needs to write one; per-trial temp dirs (A5) are fine. For agb: its
trust check is worth revisiting (agb's issue, not agenteval's).

**D2. The test-design step has no inputs yet.** Harvest the moment before
`.ab/test-plan.json` was written in each project, and its adopted test plan
as the reference.

## Order

A1–A8 first (the flow cannot run), then B1–B4 (otherwise costs across
providers are wrong), then C. D1 is settled: work dirs may live anywhere.
