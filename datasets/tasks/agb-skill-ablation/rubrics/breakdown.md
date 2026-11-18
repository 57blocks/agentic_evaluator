# Task breakdown review

Two plans for the same project: its PRD, design and contracts. One may have been written with agb's skills and one without; you are not told which, and agb's own gates are scored separately. Do not reward agb's conventions as such (its file layout, id prefixes, section names): judge the substance. Prefer the plan you would rather hand to the agent that implements it.

1. **granularity**: each task is one coherent unit a single session can
   finish and verify. Nothing is a whole feature crammed in; nothing is a
   fragment that only makes sense next to its neighbours.
2. **ordering**: dependencies follow what is really needed (schema before
   the endpoints that use it, shared pieces first). There are no needless
   chains that serialise work which could run in parallel.
3. **clarity**: an implementer can start from the task alone. Its files,
   acceptance criteria and contract references are specific, not "update
   the relevant files".
4. **domains**: the domain split matches how the product is built and
   owned. A domain is a session boundary, not a label.

More tasks is not better. A smaller plan that is clear and correctly ordered
beats a larger one.
