# Code review support (Review Pack, PRD §§1–4)

Shared contract for two parallel branches, both stacked on `feat/check-measures`:

- `feat/code-review-datasets` — dataset builders: `agenteval code-review mine`,
  `pick-clean`, `build` (PRD "three dataset builders": escaped-defect miner and
  clean-PR picker now; the seeder later).
- `feat/code-review-matcher` — the finding format and a built-in deterministic
  matcher check, `kind: findings-match` (PRD §4).

`agenteval review` already exists (blind human review of a run), so the new
command group is `agenteval code-review`.

The first user is the mon-entreprise demo (main checkout,
`tasks/review-mon-entreprise/`): its task-local Python (`mining/szz_lite.py`,
`mining/prescreen.py`, `mining/select_clean.py`, `scripts/build-fixtures.py`)
and its LLM-only check (`checks/caught.mjs`) are what these generalize. Read
them; they encode lessons (non-ASCII paths need `core.quotepath=false`;
rebase-merge PR ranges; gh lists at most 100 commits; fixtures from git
objects, never a working tree; a reviewer must not be able to reach the fix).

## Finding (what a reviewer under test produces)

A candidate leaves `findings.json` in its work dir: an array, or
`{"findings": [...]}`. Each finding:

```json
{"file": "src/a.ts", "start_line": 40, "end_line": 42,
 "category": "calculation", "severity": "high",
 "message": "…", "blocking": true, "producer": "security-reviewer"}
```

- `message` required. `file` absent = a PR-level (global) finding.
- `start_line`/`end_line` are line numbers in the PR head version of `file`;
  `end_line` defaults to `start_line`.
- `category` from the defect taxonomy below, or free text; `severity` one of
  critical|high|medium|low; `blocking` boolean; `producer` free text (which
  reviewer agent, for the per-agent view).

## Item (what a dataset entry expects) — items.jsonl `expected`

Defect item (escaped, seeded):

```json
{"kind": "defect", "source": "escaped" | "seeded",
 "defects": [{"file": "…", "start_line": 10, "end_line": 12,
              "category": "calculation", "severity": "high",
              "description": "…", "fix_commit": "abc1234", "fix_diff": "…",
              "knowable": true}]}
```

A defect is one fix. `build` writes one entry per file the fix touched, so
entries sharing a `fix_commit` are one defect with several places: the
matcher counts it once and catches it when any place is hit. Entries without
`fix_commit` are separate defects.

Clean item: `{"kind": "clean", "note": "…"}`.

Line numbers are in the PR head version of the file (what the reviewer sees).
Tags carry `escaped` / `seeded` / `clean` plus category and severity, for
filtering. An escaped item whose labels say so also carries `knowable`,
`not-knowable` or `partly-knowable`, and each defect its own `knowable`: a
real fix a reviewer could not have known to ask for (a business rule that
later changed its mind, a regulation outside the repo) is kept, and read
apart. The report's "per category and severity, never one blended score" is
read per defect, not from these tags (see "What the report leads with").

## What the report leads with

`findings-match` carries its own check report (`src/code-review/check-report.ts`,
the generic mechanism is `canon/headline.ts`): knowable defects caught,
defects caught, defect claims per clean item, precision on defect items,
findings per review; defects caught and defect claims by source.

The item's tags count every defect of an item under each tag, so category,
severity and knowability are read per defect instead: the matcher reports
each defect as a check part (`canon/parts.ts`), with those as its tags, and
`build` writes a label's `knowable` onto each defect. The report's "Every
known defect" section is the defect × candidate grid and the catch rate per
tag. The per-input table is split into defect items and clean items, each
under what a pass means there.

Not done yet: the noisiest false alarms. A clean item's claims are a count
(`defect_claims`); which findings they were is only in `findings-match.json`.

## Defect taxonomy (category)

calculation, logic, crash, state, data, security, privacy, accessibility,
concurrency, resource, ui, other.
