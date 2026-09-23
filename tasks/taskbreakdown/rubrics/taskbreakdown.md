Judge two coding task breakdowns produced from the SAME frozen PRD. Each is a
JSON array of tasks; a competent engineering team should be able to pick up the
list and build the product. Score on:

> Note: raw REQUIREMENT COVERAGE (does every FR-*/AC-* id appear in some task's
> `coversRequirementIds`?) is measured separately and objectively via the
> task-coverage gate — reported as the "coverage" / objective-pass column. Do
> NOT re-count coverage here; assume missed requirements are already penalized.
> Judge the **quality of the decomposition** on the axes below.

1. **Granularity** — tasks are the right size: each is a coherent, independently
   reviewable unit of work. Not so coarse that one task hides a whole subsystem,
   not so fine that trivial edits are split into their own tasks. Thin work is
   merged; genuinely separable work (distinct pages / APIs / services) is split.
2. **Dependencies & ordering** — the task graph is buildable: foundation work
   (data models, shared types, app shell) comes before the work that depends on
   it, dependencies are declared where real, and there are no cycles or
   impossible orderings.
3. **Verifiability** — every task has concrete, testable acceptance criteria and
   a credible TDD plan (tests named, with a real test command), so "done" is
   objectively checkable rather than a vague description.
4. **Faithfulness / no invented scope** — the breakdown covers what the PRD
   actually asks for and introduces NO features, files, services, or
   infrastructure the PRD neither states nor plausibly implies. Inventing
   unrequested scope (extra pages, speculative services) is a defect.
5. **Actionability** — descriptions and sub-steps say HOW: they name the real
   files to CREATE vs MODIFY and the concrete symbols/components to reuse, so an
   engineer (or coding agent) can execute without re-deriving the design.

Prefer the breakdown that is well-sized, correctly ordered, verifiable, and
faithful to the PRD. A longer breakdown that invents unrequested scope or splits
work into noise should lose to a focused, correctly-grained one.
