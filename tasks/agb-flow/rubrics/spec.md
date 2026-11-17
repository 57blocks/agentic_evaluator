# Spec review

Two normalizations of the same external document (under `docs/prd-source/`).
Both already pass agb's spec gates: the machine layer exists, every route has a
`PAGE-*` and every endpoint an `API-*`, and nothing is hard-blocked. Judge what
those gates cannot see. Prefer the one you would rather build from.

1. **faithful**: the client's text survives. `docs/PRD.md` adds ids, routes and
   states around the original; it does not rewrite, polish or drop sentences.
   Nothing is invented: a workflow, field or rule absent from the source is a
   defect even when it looks sensible. An empty field beats a made-up one.
2. **machine**: `.ab/prd.json` is complete and true to the PRD: every page,
   its states and interactive components, every acceptance criterion, each
   anchored to the text it came from.
3. **questions**: what the source leaves open is raised, not guessed. Each
   question in `.ab/questions.json` is real, cites where it came from, says what
   a wrong guess costs, and blocks the right stages. Recommended answers taken
   unattended are marked provisional.
4. **buildable**: a downstream architect can start from it. Contradictions in
   the source are surfaced, not silently resolved one way.

Length is not quality. A shorter PRD that keeps the source intact beats a
longer one that reads better.
