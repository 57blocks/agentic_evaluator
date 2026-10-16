# agb-e2e

Which model config gets agb from a task breakdown to a **working app**,
unattended. `agb-breakdown` and `agb-models` measure one step each; this task
chains them and grades only what comes out the end.

| | |
|---|---|
| Input | an agb project with PRD, design and contracts in place, before its task plan (`fixture/`) |
| One trial | `stage-detail` (`claude -p`) → `stage-qa` (`claude -p`) → `agb run`, every task; nobody steps in |
| Candidate | a model config: `agents/agb-e2e.mjs <plan-model> [<code-model>]` |
| Right | every planned task done; the app installs, builds and typechecks; its whole test suite passes under `agb smoke`; no hard finding (`checks/final-gates.mjs`) |
| Better | Gemini 3.1 Pro scores each delivery 1-5 per rubric dimension, and compares pairs once there are two configs. It reads the plan, test plan, UI contract, README, source and tests (`judge.show`, about 88 KB on demo-todo), and is reported beside the pick, which the check decides |

Each stage's cost, time and exit status are written to `AGB_EVAL_RESULT.json`,
and their output (the last 256 KB) to `AGB_EVAL_LOG.txt`, both in the trial dir.
When a stage fails the chain stops, the wrapper still exits 0, and the check
fails the trial with the stage it stopped at in its evidence. A non-zero exit
would mark the trial malformed and skip the check.

## Before the first run

`agb run` writes the shell rules a task was denied into
`.claude/settings.local.json`, and claude only honours them in a directory it
trusts. Trials run in one fixed sandbox (`AGB_E2E_SANDBOX`, default
`~/.agb-e2e/work`), which is emptied before each trial; trust it once:

```sh
cd ~/.agb-e2e/work && claude   # accept the trust prompt, then exit
```

(A dry run creates the sandbox if it is missing.)

Without trust the wrapper exits 2 before calling any model. One trial at a
time: a lock in the sandbox refuses a second.

## The reference

`references/demo-todo-detail/` is the end state demo-todo adopted (`bb90b34`)
with two test fixes. As agb left it, the client's suite fails when run whole
(18 of 25 cases): the tests pass one at a time, but nothing cleans up between
tests (no `cleanup()`, mocks never cleared), and one case uses `findByTestId`
on a list. agb ran each task's tests on their own and never the suite
together. The fixes are `client/src/test/setup.ts` and one line of
`MembersPage.test.tsx`; the check fails the unfixed state and passes this one.
`AGB_EVAL_STATE.json` is agb's run state (`.ab/run/state.json`, which agb
projects gitignore).

## Cost

agb's own estimate for demo-todo's 8 tasks is $61 (its built-in baseline,
the most expensive project it has measured); demo-todo actually cost $19.70 in
`agb run`, plus about $5 for the breakdown. Caps per trial: detail $15, qa
$10, `agb run` $80 (`AGB_E2E_MAX_RUN_COST`). The spec starts with one config
on one input to measure a real trial before adding the others.

`--max-cost` is the real spend cap. If the wrapper's own time limit stops
`agb run`, agb does not forward the signal, so its claude sessions may keep
running: check with `pgrep -fl claude` after a timed-out trial.

## Files

- `agents/agb-e2e.mjs`: the chain. `AGB_EVAL_DRY=1` lays the fixture and the
  reference plan down and runs `agb run --dry-run`, without calling a model.
- `checks/final-gates.mjs`: the required check. It grades a temp copy outside
  this repo, because vitest would otherwise pick up this repo's
  `vite.config.ts`.
- `rubrics/e2e.md`: the judge's rubric (plan, tests, code, contract,
  handover).
