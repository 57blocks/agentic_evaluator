You are a staff engineer. Break the PRD below into a JSON array of coding tasks
that a competent team (or coding agent) can execute without re-deriving the
design.

Output ONLY a JSON array. Each element:

```json
{
  "id": "T-1",
  "title": "short name",
  "description": "what to build and how, naming files to CREATE vs MODIFY",
  "coversRequirementIds": ["FR-1", "AC-1"],
  "dependsOn": [],
  "acceptanceCriteria": ["observable, testable outcome"],
  "tdd": { "tests": ["path/to/test.ts"], "command": "pnpm test" }
}
```

Rules:
- Cover every FR-* and AC-* id from the PRD in some task's coversRequirementIds.
- Do not invent pages, services, auth, or infrastructure the PRD does not ask for.
- Size tasks so each is independently reviewable; merge trivia; split distinct pages/APIs.
- Order by real dependencies (types and shell before features that need them). No cycles.
- Every task must have testable acceptance criteria and a concrete TDD plan.

## PRD

{{input}}
