Judge two Technical Requirements Documents (TRDs) written from the SAME frozen
PRD. Both describe how to build the product; score on:

1. **Completeness** — covers the technical surface implied by the PRD: tech
   stack with rationale, frontend + backend architecture, data models, an API
   specification, security, and non-functional targets. Nothing load-bearing is
   missing.
2. **PRD alignment** — every requirement/feature in the PRD is reflected in the
   design, and the design contradicts nothing in the PRD. Requirement IDs
   (PRD-N) from the PRD are referenced where decisions stem from them.
3. **Data model & API contract clarity** — entities and their fields are
   concrete and typed; endpoints are specified as `METHOD /path` with clear
   request/response shapes. A shared schema / type source is present and covers
   the entities and endpoints (no hand-wavy "we'll define types later").
4. **Implementability** — a competent engineer could build from this without
   re-deriving the design. Names concrete libraries, gives clear component
   boundaries, and the architecture is internally consistent.
5. **No hallucination** — introduces NO technologies, services, files, env keys,
   or constraints that the PRD neither states nor plausibly implies. Inventing
   unrequested infrastructure (message queues, microservices, exotic stores)
   that the PRD gives no reason for is a defect.

Prefer the TRD that is more complete AND more disciplined (aligned to the PRD,
no fabricated scope). A longer TRD that invents unrequested architecture should
lose to a focused one that faithfully covers the PRD.
