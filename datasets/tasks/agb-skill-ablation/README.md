# agb-skill-ablation

Does agb's Claude Code skill pack make Claude better at each agb stage? The
same model and the same starting tree run every stage agb has before
delivery (spec, architecture, task breakdown, test design, code), once with
the agb-skills plugin (`/agb-skills:agb-<stage>`) and once with no plugin at
all. Read the result as within-model deltas: opus with vs without, sonnet
with vs without.

| Arm | What runs |
|---|---|
| `*-skill` | `claude -p "/agb-skills:agb-<stage> --accept-recommended"` with the plugin (build e849b1563289, agb 0a8c4ee7). Planning stages converge with agb's CLI. Code starts `agb run` and supervises it, at most 3 sessions. |
| `*-none` | `claude -p "<what this stage must produce>"`, no plugin, no agb CLI. A planning prompt carries a deliverable contract (`agents/contracts/<step>.md`): paths, JSON shapes and ID rules the grader reads, not agb's method. |

Each step starts from agb's adopted output of the stages before it (the
agb-flow-v3 fixtures), so this measures each stage alone, not a chain.

## Grading

- Planning: the check passes when the deliverables exist and parse; agb's
  required gates are its score. A pairwise judge (openai/gpt-6.1-sol, both
  orders) compares substance and is told not to reward agb's conventions. It
  still sees `.ab/*.json`, so it is not blind to the arm.
- Code: held-out acceptance tests neither arm saw
  (`references/build/_heldout/`). Invoice is scored on the API suite only:
  the UI suite follows the reference's request pattern, which the PRD does
  not fix.
- Every check first runs `checks/arm-check.mjs` on the trace. A trial that is
  not the arm it is labelled is void (an evaluator error), not a loss.

## Results (2026-11-17/18, one trial per input: directional)

| Step | Gates / held-out | Judge, skill vs none on the same model (skill wins-none wins-ties) | Cost, skill vs none |
|---|---|---|---|
| spec (2 inputs) | all 3/3 | opus 1-0-1, sonnet 2-0-0 | opus $10.75 vs $4.63; sonnet $2.60 vs $0.96 |
| architecture (3) | skill 2/2 everywhere; none missed one gate twice | opus 0-2-1, sonnet 1-0-2 | opus $10.56 vs $5.19; sonnet $3.91 vs $1.45 |
| task-breakdown (3) | all 3/3 | opus 2-0-1, sonnet 2-0-1 | opus $14.98 vs $4.09; sonnet $2.82 vs $0.72 |
| test-design (3) | all 2/2 | opus 3-0-0, sonnet 3-0-0 | opus $9.15 vs $1.73; sonnet $1.49 vs $0.38 |
| code (2) | demo-todo 23-24/24 everywhere; invoice API 29/29 everywhere* | opus 2-0-0, sonnet 2-0-0 | opus $72.5 vs ~$20; sonnet $20.6 vs ~$4.8 |

Costs are token-priced estimates (the runs used a Claude subscription).

In short: the skill pack does not change whether the work is right (gates and
held-out tests barely separate the arms), the judge prefers its output in
18 of 26 same-model pairs (2 for no-skill, both opus on architecture; 6 ties), and it costs 2-5x on planning and 4-13x the time on code.

\* opus-5-5-skill on invoice is an evaluator error in the run: its trace file
was deleted mid-trial, so the arm could not be confirmed. Graded by hand on
its kept tree it scores API 29/29, UI 2/15, the same as the others. The
report therefore gates opus-5-5-skill on the code step.

## Known issues in the published run

- Code step, no-skill arms: the cost column undercounts (opus invoice shows
  $0, real ~$18; sonnet invoice ~$4.1). A session whose background work ends
  after its reply prints several `result` events and only the last was read.
  Fixed in `agents/claude-arm.mjs` (sums every result).
- The first code run (not published) was void: Claude Code drops
  `CLAUDE_CODE_OAUTH_TOKEN` from its Bash tool's environment, so the
  executors `agb run` started were not logged in; and a dev server one trial
  left on port 5173 failed every later build's grade. Fixed: the agb shims
  restore the token from a file outside the workspace, the agent stops every
  process left in its tree, and `checks/build-tests.mjs` voids a grade on
  either cause. The code step was then re-run in full.

The published run is `runs/agb-skill-ablation-combined-*`: planning from the
full run, code from the re-run (`combined-from.json` in each step).

## Running it

From the workspace root (where `.env.local` holds `CLAUDE_CODE_OAUTH_TOKEN`
and `OPENROUTER_API_KEY`), with agb checked out at `AGB_HOME`:

```sh
agenteval run tasks/agb-skill-ablation/spec.yaml --yes --html
agenteval run tasks/agb-skill-ablation/smoke.yaml --yes   # test-design, demo-todo, opus only
```

`checks/heldout-runner/` needs `npm ci` before the code step.
