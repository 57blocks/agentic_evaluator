---
name: agenteval-new-task
description: Build an agenteval task with the user — what decision it informs, realistic inputs, a check that can tell right from wrong, reference answers, candidates and gates — then prove it with `agenteval check-task` before anything is paid. Use when the user wants a new evaluation, says "/agenteval-new-task", "set up an eval for X", "compare models/agents on our Y", or has a task whose inputs or grading they don't trust yet.
---

# Build an agenteval task

You are helping the user build one agenteval task (`tasks/<name>/`) they will trust enough to choose a model, agent or setup from. A task is: **inputs** every candidate answers, a **required check** that decides pass/fail, optional **reference answers** that prove the check passes a correct answer, **candidates**, and the **gates and operating mode** that turn results into a pick.

The trust comes from two sign-offs: the user has **read the inputs** and said they are the cases that matter, and has **seen the check grade real answers** and agreed with it. Everything else is guidance. Both sign-offs are literal pauses — propose, ask, wait for a clear yes.

Ask decisions with `AskUserQuestion`, your recommendation first and labelled "(Recommended)", so a user who trusts your defaults clicks through. Keep chat short; put detail in files.

**Never run `agenteval run … --yes` without an explicit yes in this conversation** — it is the only command that bills. `init`, `check-task`, `plan` and `models --catalog-only` are free and need no key.

The spec reference is the agenteval README, installed beside this file as `reference.md`: "Tutorial" (a complete spec with a prompt, inputs, a check script and a judge rubric) and "Writing a task" (rules `plan` enforces, producers, operating modes, gates, command candidates, check scripts). Read those sections before writing `spec.yaml`; do not guess fields.

---

## Step 0 — The decision

Ask what choice this task informs, in one sentence: *"which model should draft our PRDs"*, *"is opencode as good as Claude Code on our refactors"*. One task, one decision. If they describe several unrelated decisions, build the one they need first. If the decision is about a pipeline — *"which model should run each stage of our flow"* — that is one decision over several steps: see **Multi-step workflows** below.

Then pin down:

- **What one input is.** A prompt text? A repo/fixture plus an instruction? A task name for an external harness? Each input becomes `inputs/<slug>.txt`; whatever else a candidate needs (fixtures, a scaffold) lives in the task directory.
- **What a candidate is.** A model through OpenRouter (`producer: prompt` or `codegen`), or a command (`adapter: agent-cli`: `claude -p`, opencode, a script, a wrapper around another harness).
- **What the deliverable is.** Text (`output.txt` in the check's dir) or files the candidate leaves behind (the end state). For agents, the end state is the answer — grade files, not narration.

Scaffold with `agenteval init <name>` (offline, command candidates) or `agenteval init <name> --models` (two models and a judge), then edit. Run `agenteval plan <name>` after every spec edit; it names the field it rejects.

## Multi-step workflows

Use this when the candidates run a pipeline — stages whose output the next stage consumes. Read the "Workflows" section of `reference.md` and the shipped `chain-offline` sample ("Samples" there says how to copy it in) before writing the spec.

**Two questions, ask which they need** (often both):

1. *Which candidate is best at each step?* — every step is evaluated on its own inputs.
2. *Does the per-step best combination beat one candidate end to end?* — chain the steps (`input_from`), set `workflow.control_candidate`, and the run also executes the whole chain twice: control on every step, then each step's pick.

**Break the pipeline into steps first.** List the stages with the user — per stage: what it starts from, what it leaves behind, what "right" means. Name each step for what it does (`task-breakdown`, not an internal stage name like `detail`), and give it a one-sentence `description`; reports show both. Show this as a short table and get a yes before writing inputs. Fewer steps is better: only make a stage its own step if they'd plausibly pick a different candidate for it.

**Then run Steps 1–3 below once per step.** Each step has its own inputs, its own required check, its own references, and **its own two sign-offs**. Do not batch the sign-offs across steps; a user who approves three steps' inputs at once has read none of them.

Per step, decide:

- **Starting state.** A step evaluated alone should start from a fixed state, not from whatever an upstream candidate produced — otherwise its result depends on who ran the step before. For agents that's `test_set.fixture_dir: fixture/<step>` with `fixture/<step>/<input>/` holding the project as it stood when that stage began (real snapshots beat hand-built ones). Steps may share input names, one fixture each.
- **Check.** Grade the step's own deliverable. Anything the check trusts (acceptance tests, the plan it grades against) comes from the fixture (`fixture` in `meta.json`), never from the candidate's work dir — a candidate must not grade itself.
- **References.** `references/<step>/<input>/` (wins over `references/<input>/`): the adopted state after that step.
- **Limits.** Stages differ: `maximum_completion_time_seconds`, `max_cost_per_trial_usd`, a step-level `judge` (rubric, `show`, `dimensions`) and `concurrency` are all per step.
- **One command for every step** is fine: a command candidate reads `EVAL_STEP`, `EVAL_INPUT` and `EVAL_CHAINED`.

**For the chain** (question 2), after every step is signed off:

- Hand-off: by default a chained step's input is the previous step's output as text. For agents whose next stage needs the project itself, add `handoff: workdir`: the work dir starts with the previous step's files.
- `workflow.e2e`: `inputs` (run the chain only on these root inputs — a chain costs far more than a step), `final_checks` (grades the end product; usually not the last step's own check), `steps.<step>` (raise a step's limits in the chain only), and optionally `judge` (compares the two arms' deliveries).
- `references/e2e/<input>/`: a delivered end product the final check must pass. This is a third sign-off: show the user the final check's evidence on it.
- Tell the user the chain's cost separately from the per-step cost before Step 4.

**Worked example — agb's flow** (one spec, three steps, ten models; *which model runs each stage, and does the combination beat opus throughout?*):

| step | starts from (`fixture/<step>/<input>/`) | candidate leaves | required check |
|---|---|---|---|
| `task-breakdown` | a real project with PRD, design and contracts in place (3 projects) | `.ab/tasks.json`, `UI_CONTRACT.md` | `plan-gates`: every page and endpoint claimed, no domain cycle |
| `test-design` | the adopted task plan in place (same 3 projects) | `.ab/test-plan.json` | `test-plan-gates`: every acceptance criterion covered |
| `implementation` | the project just before one task (inputs `demo-todo-T-001`, `demo-todo-T-006`: a from-scratch task and a feature on a working codebase) | the implemented task | `task-tests`: the task's acceptance tests — restored from the fixture, not the candidate's copy — all pass |

What it shows: each step starts from a real snapshot, so `test-design`'s result doesn't depend on who ran `task-breakdown`; one command (`agents/agb-step.mjs`) serves every step via `EVAL_STEP`; caps differ per step (task-breakdown $15/50 min, test-design $10/30 min, implementation $10/60 min, implementation at `concurrency: 3` because each trial builds an app); `task-breakdown` adds a step judge (`rubrics/breakdown.md`, `show: [".ab/tasks.json", UI_CONTRACT.md]`) for granularity and ordering a script can't see. The chain adds `input_from` + `handoff: workdir` on `test-design` and `implementation`, and `workflow.e2e` with `inputs: [demo-todo]` (the chain's implementation step builds every task) and `final_checks: [app-gates]` (installs, builds, the whole test suite passes) — a different check from `task-tests`, because one task passing and a delivered app working are different claims. `references/e2e/demo-todo/` is the delivered app.

## Step 1 — Inputs

Ask whether they already have cases, a grader, or a harness. **Reuse what exists**; build only what's missing.

Source inputs from the first of these that is available and that the user is comfortable keeping in the repo:

1. **Real traffic** — logs, transcripts, past tickets. Before pulling anything, ask about **retention and PII**. If either is a problem: store identifiers and fetch at run time, have the user anonymize a sample, or rewrite each case synthetically with the same shape and difficulty (show the rewrites).
2. **Things that went wrong** — bug reports, complaints. Often the most valuable cases.
3. **Hand-written by the user** — ask for five to ten. A seed, skewed toward what's salient.
4. **Synthesized by you** — lowest fidelity; say so. Never cold: first get three to five real examples and one sentence on what makes a case *hard*, then write variations of those.

**How many.** `check-task` prints the chance swing of a pass rate: about ±1/√(inputs × trials). One input × two trials swings ±71 points; ten × two ±22; twenty-five × two ±14. Fewer than 10 inputs and every result is labelled *directional*. Put that number next to the difference the user would act on, and size inputs and `trials_per_case` together.

Cover **both directions** where it applies — cases where the candidate should act and cases where it should not — so a degenerate always-act candidate cannot score perfectly.

### Sign-off 1: the inputs

Write them to `tasks/<name>/inputs/<slug>.txt` (slugs short and descriptive), then show the user **every input**, not a summary — a simple HTML page or the files themselves, whichever they'll actually read. Observations are quantitative (counts, named cases). Ask:

> Here are the N inputs. Are these the cases this decision depends on? Anything missing, or anything here that doesn't matter?

Do not continue until they say yes. If it's "mostly, but…", fix the "but" and show them again.

## Step 2 — How a trial is judged right or wrong

Every step needs a **required check** unless its mode is `judge-preference`; without one every trial is undetermined and nobody can qualify. Pick the cheapest grader that really measures the property:

- **`kind: tsc`** — the deliverable is TypeScript that must compile.
- **`kind: command`** — a script you write, run in the trial's work dir: the candidate's files, plus `output.txt` (deliverable text), `input.txt` (this case) and `meta.json`. **Exit 0 = pass, 1 = the candidate failed, anything else = evaluator error** (never blamed on the candidate). Print `{"evidence": "...", "reason": "..."}` to stdout. Grade outcomes, not the path taken; for agents, read the files they left (tests pass, expected file exists, nothing off-limits touched). Exit 1 — not 2 — when the deliverable is missing: a candidate that produced nothing has failed.
- **Judge** (`evaluators.judge`, `methods: [pairwise-swap]` and/or `absolute-1-5`) — for qualities a script can't see. The rubric is numbered items with **bold** names that match `judged_dimensions`; write each as a checkable claim ("cites at least one source from the input"), not a vibe ("helpful"). The judge's vendor must differ from every candidate's. It complements a check; with `judge-preference` it is the pick.

Show your work: list the criteria you included and the ones you left out, with a line on why.

### Reference answers

For each input you can, write a correct answer the check must pass — `references/<input>/` holding the files a good candidate would leave (and `output.txt` if the deliverable is text), or `references/<input>.txt`. **References must come from the user or be human-verified** — never from a model that is a candidate, or the check learns to reward imitating it.

### Sign-off 2: the grading

Run `agenteval check-task <name>`. It is free: it feeds the check an **empty answer** (must fail) and each **reference** (must pass), and lints the candidates. Show the user the findings, then the check's evidence on two or three references and on one deliberately wrong-but-plausible answer you wrote. Ask:

> Would you have graded any of these differently? Is it measuring something you don't care about, or missing something you do?

If yes for even one case, the check isn't ready: fix it, re-run `check-task`, show again, and get an explicit yes on the final version.

## Step 3 — Candidates, gates, mode

- **Candidates**: model ids (`agenteval models <name> --catalog-only` checks they exist, free), or commands. Recommend `cli.image` for any command candidate — on the host it can read `checks/`, `rubrics/` and `references/`, which `check-task` warns about. A command that knows its spend can report it via `.eval-usage.json` with `cli.reports_usage: true` (`reference.md`, "Command candidates"); otherwise its cost is *unobserved* and `lowest-cost` cannot rank it.
- **Control** (`control_candidate`): what they use today, or the obvious default.
- **Operating mode**: `lowest-cost`, `fastest-within-cost-ceiling` (needs `eligibility.cost_ceiling_per_success_usd`), `highest-assurance`, or `judge-preference`. Ask which tradeoff they actually care about.
- **Gates**: `minimum_reliability` and `minimum_required_check_pass_rate` default to 1.0 when a check exists — say so; lower them only if the user accepts candidates that sometimes fail. A gate is firm only when the chosen candidate's 95% interval clears it, which a gate of 1.0 never does; a perfect record clears 0.95 from 73 inputs and 0.9 from 35. `check-task` reports `eligibility.unreachable` when the set is too small for the gate — show the user that trade-off rather than picking for them.
- **`budget_usd`**: a hard ceiling for the run.

## Make the set tell the candidates apart

A task whose candidates all score 100% answers only "the cheapest is enough". That can be the right answer, but find out cheaply, before the user pays for a large run or you build a generator.

**Probe first.** Once the check works, write 5–8 items, one hard case each, and run every candidate on them (usually well under $1; still ask before running). If every candidate passes every item, more items of the same kind will not change that: change what the items test, and say so to the user. If they split, you know which kinds of case to multiply.

**What separates candidates, and what doesn't** (from building the datasets in the agenteval repository's `datasets/`):

- **Rules the candidate must bring, not rules you hand it.** Stating the rules in the prompt turns the task into reading: every model scored 30/30 on beneficial owners with the rules spelled out, and 21–26/30 when the prompt named only the law. Ask the user whether the decision is "can it apply rules we give it" or "does it know the domain's rules"; for the second, keep the rules out of the prompt.
- **Extraction where the answer is in the text rarely separates strong models.** Longer documents, scan noise, amendments filed out of order and distractor clauses all left four models at 100% on contract terms. That is a finding to report, not a set to keep inflating.
- **Boundaries and computed answers do separate them:** a threshold met by one euro, a deadline counted from the right date, a stake held through two companies that must be added rather than multiplied.

**Every answer must follow from the input plus rules you can cite.** If the key needs a date, a threshold or a policy, it is in the input or in a written rule with its source. When rules decide the answer, write them to `RULES.md` with a quote and a source for each, and leave out cases the sources leave open: an item that rests on a contested reading grades the reading, not the candidate.

**When you generate items** (a seeded script under `gen/`): build a structure, compute the answer from it in code that follows `RULES.md`, then render the text, so the key is right by construction. Keep about a third of the items ordinary, so a candidate is not rewarded only for rare cases. Tag each item by kind (`checks/manifest.json`: `{"<input>": {"tags": [...], "split": "dev" | "holdout"}}`) and hold out about 40%. Any noise or distraction you add must never alter a graded value; assert that in the generator.

**After the first full run, read the failures before the scores.** An item every candidate fails is a suspect label until you have checked it against the rules. Misses that share one shape (every wrong deadline off by exactly five days) point to one rule, and that is the most useful thing to tell the user.

## Step 4 — Ready to run

0. Make the report say what it tests: a top-level `description` (the decision and what the inputs are, in a few sentences), a `description` on the required check (what a pass means), and `test_set.labels_file: checks/manifest.json` when items are tagged, so the report breaks results down by tag (`reference.md`, "Saying what a task evaluates").
1. `agenteval check-task <name>` reports **0 blocking**. Read the remaining warnings out to the user in one line each and let them decide.
2. `agenteval plan <name>` — show the counts (generations, judge calls, budget).
3. Ask for consent in one line: *"N candidates × M inputs × T trials, judge on/off, budget $B — run it?"* For a workflow, give it per step plus the chain: *"task-breakdown 10×3, test-design 10×3, implementation 10×2, chain 2 arms on demo-todo, budget $600 — run it?"* Only on a yes: `agenteval run <name> --yes --html`, then point them at `runs/<run>/report.html` and `GAPS.md`.

Hand over: where the task lives, what `check-task` said, and that every edit to inputs or the check should be followed by `check-task` again. Suggest committing `tasks/<name>/` (runs are gitignored).

## Failure modes to avoid

- **Skipping a sign-off.** Forty plausible inputs and a sensible check the user never read produce a number nobody trusts.
- **Running before a yes**, including "just one" paid trial.
- **References from a candidate model**, or a check that passes an empty answer (`check-task` blocks it — don't work around it).
- **A check that exits 2 on a missing deliverable** — that turns "did nothing" into undetermined.
- **A grand unified task.** One decision per task. A pipeline is one decision over several steps; unrelated decisions are separate tasks.
- **Steps that start from upstream output when evaluated alone.** Give each step a fixed starting state (`fixture_dir`); chaining is for the e2e arms.
- **Reusing a step's check as the chain's final check** without asking whether "this step's deliverable is right" and "the end product works" are the same claim.
- **Scaling before a probe.** Thirty generated items that every candidate passes cost as much as six that show the same thing.
- **Putting the rules in the prompt when the question is whether the candidate knows them.**
- **An answer key the input cannot support**: a deadline whose rule or start date is not in the case, a policy nobody wrote down.
