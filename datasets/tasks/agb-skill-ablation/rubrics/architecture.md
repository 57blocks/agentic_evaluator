# Architecture review

Two architectures for the same project: its PRD (`docs/PRD.md`,
`.ab/prd.json`). One may have been written with agb's skills and one without; you are not told which, and agb's own gates are scored separately. Do not reward agb's conventions as such (its file layout, id prefixes, section names): judge the substance. Prefer the one you would
rather hand to the sessions that build each domain.

1. **decisions**: the cross-cutting choices are made once, in `docs/DESIGN.md`
   with a `DEC-*` each: auth model, tenancy, transactions, idempotency,
   caching, failure of external integrations, deployment. Each says what was
   chosen, why, and what was rejected. Nothing a domain session would have to
   decide on its own is left out.
2. **contract**: `_contracts/` covers every endpoint the PRD needs, no more,
   with request, response, errors and auth specific enough to code and test
   against. The data schema matches it.
3. **components**: `.ab/arch.json` splits the system into components that own
   clear endpoints and tables, with dependencies that do not loop.
4. **constraints**: non-functional targets are concrete and verifiable
   ("p95 under 300 ms on GET /api/tasks"), each with where it lands.

More is not better. A smaller design whose decisions are right and complete
beats a larger one full of generic boilerplate.
