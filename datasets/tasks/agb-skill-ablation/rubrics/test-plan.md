# Test plan review

Two test plans (`.ab/test-plan.json`) for the same project: its PRD, design,
contracts and adopted task plan. One may have been written with agb's skills and one without; you are not told which, and agb's own gates are scored separately. Do not reward agb's conventions as such (its file layout, id prefixes, section names): judge the substance. Prefer the plan whose tests you would rather have guarding
the implementation.

1. **coverage**: each acceptance criterion is tested in its substance, not
   only named: its edge cases, empty and error states, and the rules it states
   (limits, transitions, uniqueness), not just its happy path.
2. **falsifiable**: each test states an observable outcome a wrong
   implementation would fail ("the column count drops by one"), not one that
   restates the code or passes whatever it does ("the page renders").
3. **levels**: each behaviour is tested at the level that can see it (API
   rules at the server, interaction at the UI, a flow across pages end to
   end), without the same assertion repeated at every level.
4. **traceable**: tests carry their `covers` anchors and map cleanly onto the
   tasks that will implement them; none floats free of a criterion.

More tests is not better. A smaller plan whose every test could catch a real
bug beats a larger one padded with tests that cannot fail.
