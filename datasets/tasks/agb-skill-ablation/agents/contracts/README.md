# Deliverable contracts for the no-skill arm (planning steps)

The no-skill arm has no agb plugin and no agb CLI, so it does not know where
agb's next stage looks or what shapes agb's gates parse. Each file here is
appended to that arm's prompt: the file paths, the JSON field shapes and the
ID conventions the step's grader reads. Derived from what the REQUIRED tier of
each check reads (checks/*-gates.mjs, agb 0a8c4ee7's gate sources and
ab-core types) and the field names in the adopted references. They state
the format and the acceptance rules, not agb's method (no PRD template, no
decomposition or test-design guidance): that is what the skill arm brings.
The skill arm never sees these files; its starting tree is agb-flow-v3's.
