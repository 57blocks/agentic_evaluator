# Human review: a blind review page for a run's deliverables

Status: approved; v1 in progress. Decisions on the open questions: pooling
across runs waits for v1.1; failed-check pairs are hidden by default behind a
toggle; the reviewer is `--reviewer`, then `git config user.name`, then the OS
user name.

## Why

A required check decides right from wrong, but it cannot say which of two
right answers is better. In `tasks/agb-breakdown`, all three candidates pass
`plan-gates` on demo-todo. After that the check has nothing left to separate
them, and only cost and time do. For work like task breakdowns, PRDs and
designs, a person who knows the domain is the ruler of last resort.

Two gaps from the eval-health audit (`/claude-api build-eval`'s checklist)
close with the same feature:

- **There is no human grading at all.** A judge is the only qualitative
  signal, and nothing calibrates it.
- **The judge reads a command candidate's stdout, not the files it left.**
  For agents, the end state is the answer.

## What it is

- A run can be reviewed by a person, blind, in the dashboard.
- The person compares candidates **pairwise**, per dimension, on the
  **files each candidate left**.
- Verdicts are stored in the run directory as evidence, with the reviewer and
  the rubric version.
- The report shows them next to the judge's verdicts. When both exist, it
  shows how often the judge agrees with the human.

In v1 the reviews **inform and do not decide**. The recommendation stays a
pure function of checks, gates and the declared operating mode.

## Spec

A new optional block, next to `judge`:

```yaml
evaluators:
  human:
    rubric_file: rubrics/breakdown.md   # numbered **dimension** items, like the judge's
    method: pairwise                    # v1: pairwise only
    show: [".ab/tasks.json", "UI_CONTRACT.md"]   # globs, relative to the trial's work dir
```

- `show` matters because a trial's work dir also holds the fixture it started
  from (the PRD, the contracts). Without it the reviewer reads the inputs, not
  the answers. When it is omitted, the page shows `output.txt` (the
  deliverable text).
- `dimensions` (optional) defaults to the step's `judged_dimensions`, which is
  where the judge's come from too. If the step also has a judge, sharing the
  rubric and dimensions is what makes the agreement number mean something.
- **Config comes from the task's current spec, not the run's manifest.** A run
  finished before the `human` block existed (every run so far) has nothing in
  its manifest to read. Review reads `<task>/spec.yaml` (the run dir is
  `<task>/runs/<run>/`), and pins what it used by writing the rubric's hash
  into every verdict's `version`.
- `plan` and `check-task` validate the block, and `check-task` warns when
  `show` matches nothing in a reference answer.

## Command and page

```
agenteval review <run> [--reviewer NAME] [--workspace DIR]
```

This starts the dashboard, if it is not already running, and opens
`/review/<run>`. `--reviewer` defaults to `git config user.name`.

**The queue** is every pair of candidates per input, using the first trial of
each that completed. That is the same pairing the judge uses, so the two are
comparable. Pairs where either side failed its required check are dropped by
default: there is nothing to prefer between a plan and a non-plan. A toggle
brings them back.

**One pair per screen:**

- The input on top (the input text, plus a link to the fixture files), then
  the two answers side by side as **A** and **B**.
- No candidate ids, no model names, no cost, no time, no check result.
- Which candidate is A is randomised per pair and per reviewer, with a fixed
  seed stored with the verdict. The same reviewer sees the same layout on
  resume.
- Files from `show` are rendered by type: JSON as a collapsible tree (large
  plans stay readable), Markdown rendered, anything else as text. A "diff"
  toggle compares the two answers' versions of the same file.
- For each dimension: **A / B / tie / both bad**, plus an optional note. An
  overall verdict is required and the dimensions are optional, so a reviewer
  can be quick.
- Progress (`7 / 18`), skip, back, and resume. Every verdict is saved as it is
  given.

**Unblinding** is a separate action at the end ("reveal"). It is recorded, and
after it, verdicts for that run are read-only for that reviewer.

## Storage

The run directory is evidence and its existing files are never rewritten. The
reviews go in a new subdirectory:

```
runs/<run>/reviews/<reviewer>.jsonl
```

One line per verdict, in the existing `EvaluationRow` shape so the report
model and the dashboard read it without a new type:

```json
{"run":"…","step":"detail","evaluator":"human-pairwise","version":"rubric-1a2b3c4d",
 "state":"pass","subject":{"kind":"pair","a":"agb-opus-5-5","b":"agb-sonnet-5","input":"chessicle-detail"},
 "dimensions":{"coverage":"a","granularity":"tie"},"overall":"a",
 "evidence":"note text","reviewer":"Xing Liu","shown_as":{"left":"agb-sonnet-5"},"seed":918273}
```

- `a` and `b` are stored **unblinded**, in canonical order. `shown_as` records
  what the reviewer actually saw, so position bias stays measurable.
- `version` is the rubric's hash. Changing the rubric makes earlier verdicts a
  different evaluator version, exactly as with checks and the judge.
- Append-only: re-judging a pair appends a new line, and the latest line wins.
  That keeps the history.

`EvaluationRow` gains two optional fields, `reviewer` and `shown_as` (or a
`meta` object). Nothing else in the canonical schema changes.

## In the report

`agenteval report <run>` and the dashboard read `reviews/` if it exists.

- **Candidates table:** a "human" column next to "judge", showing the win rate
  over reviewed pairs, with the counts (`5–1–2 over 8 pairs`).
- **Agreement (only when a judge also ran):**
  `judge agrees with <reviewer> on 6 of 8 pairs (75%)`, per dimension where
  both scored it. Below 90%, a line in GAPS.md says the judge is uncalibrated
  for this rubric. This is the number build-eval asks for before trusting a
  judge.
- **GAPS.md:** reviewed pairs out of the total, and that human verdicts did not
  enter the recommendation (v1).

The recommendation, `summary.json` and the ledger are not touched. Human rows
are loaded into their own field of the run bundle, never merged into
`evaluations`, so nothing that selects can read them by accident. GAPS lines
about reviews are derived at render time; GAPS.md on disk is not rewritten.

## Not in v1

- **Human verdicts in selection.** A `human-preference` operating mode, or a
  human tie-break in `highest-assurance` is the natural next step. It waits
  until a review exists to design it against.
- **Several reviewers** reconciled, and inter-rater agreement. The storage
  already keys by reviewer, so this is additive.
- **Absolute 1–5 human scoring.**
- **Feeding the judge the `show` files instead of stdout.** This is the same
  rendering, and it should follow right after, as its own change.
- **Reviewing across runs.** `agb-breakdown`'s invoice results live in a
  different run from the other inputs. v1 reviews one run, which may need a
  `--runs a,b` merge. That is an open question below.

## Open questions

1. **Across runs.** Should a review be able to pool the latest completed trial
   per (candidate, input) from several runs of the same task? That is useful
   when one input was rerun, as here. The proposed answer is yes in v1.1:
   pooling only when the spec, check and rubric hashes match, and naming the
   source run of every trial in the review.
2. **Failed-check pairs.** Is hiding them by default right, or should a
   reviewer be able to say "B is the better failure"?
3. **Where `--reviewer` comes from** when there is no git identity (e.g. in a
   shared dashboard).

## Work, in order

1. Spec block, `plan`/`check-task` validation, and rubric hash: small.
2. The `reviews/` reader and writer, and the report columns, agreement line
   and GAPS lines, with unit tests on the row shapes and the agreement
   arithmetic.
3. The server: `GET /api/review/<run>` (the queue, blinded, **with file
   contents embedded**: a `/artifact/.../checks/<candidate>__...` URL would
   name the candidate) and `POST` (a verdict, un-blinded server-side, so the
   client never needs candidate ids; reviewer name sanitised before it
   becomes a file name).
4. The page: pair view, file rendering, keyboard shortcuts (`a`/`b`/`t`/`x`,
   `j`/`k`), resume, reveal.
5. `agenteval review` command, and README.
6. First real use: `tasks/agb-breakdown`, by Xing.
