# Task: code-reactive

Task text: `inputs/code-reactive.txt`. Harder than the `code-*` tasks already in
`inputs/`: multi-file, an exact public API, and ten behaviours that are easy to
implement almost-right (glitch-free diamonds, dynamic dependencies, equality
short-circuit, batch nesting, cleanup ordering, cycle detection).

## What the harness checks today

Only `tsc --noEmit` over the artifacts the candidate leaves in its work dir.
Because the task requires `conformance.ts` verbatim, that check also catches a
wrong public API — but nothing here verifies behaviour: an implementation that
compiles and is completely wrong still passes the required check. The judge
sees the artifacts and the rubric, nothing else.

## Grading behaviour by hand

`spec.test.ts` is the behavioural grader — one test per numbered requirement.
It is not wired into the harness (there is no `kind: command` check yet), so run
it yourself against one candidate's artifacts:

```bash
mkdir -p /tmp/try && cp runs/<runId>/raw/<candidate>__code-reactive__t0/*.ts /tmp/try/
cp tasks/code-reactive/spec.test.ts /tmp/try/
node --import tsx --test /tmp/try/spec.test.ts
```

## reference/

`reference/signals.ts` is a correct implementation. It exists to prove the task
is solvable and that the grader is right, not to be shown to a candidate — the
agent only ever receives the task text in a clean work dir.

Re-verify both gates after editing the task or the grader:

```bash
cp tasks/code-reactive/spec.test.ts tasks/code-reactive/reference/
node --import tsx --test tasks/code-reactive/reference/spec.test.ts
rm tasks/code-reactive/reference/spec.test.ts
```

Last verified 2026-09-17: 10/10 tests pass, and `conformance.ts` + the reference
compile under the scaffold tsconfig with exit 0.
