# End-to-end delivery: control vs the per-step combination

Two apps agb built from the same PRD, design and contracts, with nobody
stepping in. Both already pass the check: every planned task is done, the app
installs, builds and typechecks, and its own test suite passes when run
whole. Judge what the check cannot see. You are shown the task plan, the test
plan, the UI contract, the README, the source and the tests; the PRD and
design are the same for both and are not shown.

1. **plan**: `.ab/tasks.json` cuts the work into coherent tasks a single
   session can finish, ordered by what each really needs. No task is a whole
   feature crammed in, none a fragment that only makes sense beside another.
2. **tests**: every acceptance criterion in `.ab/test-plan.json` has a test
   that would fail if the behaviour broke. Tests assert outcomes a user or a
   client would see, not the code's internals restated.
3. **code**: the source is what a maintainer would want to inherit: clear
   module boundaries, errors handled at the edges, no dead or duplicated
   code, nothing the contract does not ask for.
4. **contract**: what the code renders and serves matches `UI_CONTRACT.md`
   and the API contract: the same pages, states, anchors and endpoints, with
   no drift between what the tests query and what the code renders.
5. **handover**: the README says how to install, run and test the app, and
   it is true of the code shown.

Bigger is not better. A smaller delivery that is clear and correct beats a
larger one. Do not reward length, comments or confident claims in the README
that the code does not bear out.
