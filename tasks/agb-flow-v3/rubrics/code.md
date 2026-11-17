# Implementation review

Two implementations of the same task in the same project, both starting from
the same code. You are shown only what each one added or changed. Both
already pass the task's acceptance tests. Judge what those tests cannot see.
Prefer the change you would rather merge and build on.

1. **correctness**: beyond the acceptance tests, the change handles what the
   task and contract imply: validation, errors at the edges, empty states,
   the persistence and status rules the API states.
2. **structure**: code sits where the project's layout says it belongs,
   follows its existing conventions, and keeps modules focused; no logic
   duplicated that already exists in the codebase.
3. **tests**: tests the change adds assert behaviour a user or client would
   see and would fail if it broke; the task's acceptance tests are not
   weakened, skipped or rewritten to pass.
4. **scope**: the change does the task and no more: no speculative
   features, no unrelated rewrites, no leftovers (debug output, dead code,
   commented-out blocks).

A smaller change that is correct and clear beats a larger one.
