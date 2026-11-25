# review-mon-entreprise-v2

A Review Pack demo on a public repository. betagouv/mon-entreprise runs
Claude Code as a PR reviewer with an in-repo prompt. This task replays that
reviewer on its own history: PRs that shipped a bug a later commit fixed,
and size-matched PRs no fix traced a bug to. Three versions of the prompt
are compared (as it went live, before a correctness item was added, and
current master).

mon-entreprise is MIT-licensed (© beta.gouv.fr). `items.jsonl`, `mining/`
and `prompts/` hold excerpts of its code, commit messages and review prompt.

## What is here

| path | what |
|---|---|
| `spec.yaml` | the task: three candidates, `kind: findings-match`, `decision: scorecard` |
| `items.jsonl` | 32 items: 18 PRs holding 24 known defects, 14 clean PRs |
| `mining/` | what `agenteval code-review mine` and `pick-clean` wrote, and `label-review.json`, the review of each label |
| `agents/` | the reviewer under test (`claude -p`), and a `gh` stub that serves the PR from the fixture and records what is posted |
| `prompts/` | the three versions of the review prompt |
| `runs/` | one full round: 288 reviews, graded |

`fixtures/` is not committed: 281 MB of repo bundles. `build` writes it
again, byte for byte:

```
git clone https://github.com/betagouv/mon-entreprise ../mon-entreprise
agenteval code-review build ../mon-entreprise \
  --mined tasks/review-mon-entreprise-v2/mining \
  --clean tasks/review-mon-entreprise-v2/mining \
  --task tasks/review-mon-entreprise-v2 \
  --pin-files f9918f1a8 CLAUDE.md CONTRIBUTING.md site/ACCESSIBILITY.md adr
```

## Run it

```
agenteval check-task tasks/review-mon-entreprise-v2/spec.yaml     # free
agenteval run tasks/review-mon-entreprise-v2/spec.yaml --html     # about $42 of reviews
agenteval report tasks/review-mon-entreprise-v2/runs/<run>        # the committed round, no cost
```

The reviewer needs `CLAUDE_CODE_OAUTH_TOKEN`; the matcher's LLM needs
`OPENROUTER_API_KEY`.

## What the committed round shows, and what it does not

On the 18 defects a reviewer could have known, the reviewer caught 14, 12
and 9 of 54 chances with the three prompts (26%, 22%, 17%). No difference
between the prompts is shown on catches, defect claims or precision. The
one difference the set can show: the first prompt writes more comments per
review (2.63 against 1.53 and 1.71).

Do not quote these as the reviewer's catch rate:

- The matcher's LLM decides every catch and has not been calibrated against
  people. Grading the same 288 reviews twice changed 12 trials.
- The labels were confirmed by a model review, not by a person; six are
  flagged in `mining/label-review.json` for a human.
- The PRs predate the reviewer model's training cutoff, so it may have seen
  the fixes.
- 18 defect PRs and 14 clean ones can only show a difference of about 20
  points.
- The round was graded with `findings-match-3`. The matcher is now
  `findings-match-4`, so a `--reuse` run grades it again.
