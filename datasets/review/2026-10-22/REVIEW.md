# Answer-key review, 2026-10-22

Domain reviewers checked every answer key in claim-denials-snf-v2 (then v2.2)
and kyc-ubo-v2 (then v2.1): not what the models answered, whether the key
itself is right. The workbook was built on 2026-10-22 by
[`../build/build_review.py`](../build/build_review.py) from the 2026-10-20
runs, and filled in on 2026-10-26 and 27. Three reviewers took 100
claim-denials items each; six took 50 kyc items each. This copy is the
workbook as they left it, with the reviewer-name column removed.

## Files

- `dataset-review-2026-10-22.xlsx`: the filled workbook. 说明 is the
  instruction page the reviewers got, 数据集介绍 explains each set, 汇总
  counts the verdicts (formulas; they carry the values the original file had,
  and Excel recomputes them on open), `claim-denials` and `kyc-ubo-v2` hold
  one row per item, and the two 规则 sheets quote the rules behind each key.
- `claim-denials.csv`, `kyc-ubo-v2.csv`: one row per item (the workbook's two
  示例 rows left out), with the cells the reviewers filled and, for each strong
  model that was graded wrong, whether the reviewer said the grading stands.
  The inputs, keys and model outputs are not repeated here; they are in
  `../../tasks/<set>/` and its `runs/`.

The reviewers' vocabulary, kept as written:

| column | values |
|---|---|
| `verdict` (结论) | 正确 key is right · 答案有误 key is wrong · 答案不完整 key is incomplete · 题目信息不足 the input lacks a fact needed for a unique answer · 题目有歧义 two answers are defensible · 不确定 unsure |
| `*_ok` (每个字段 对吗) | 对 right · 错 wrong, for each field of the key |
| `*_grading_stands` (判分成立吗) | 模型确实错 the model was wrong · 模型也对（判分太严） the model was also right, the check is too strict · 模型对，标准答案错 the model was right and the key wrong · —（答对） not graded wrong |

## Result

| set | reviewed | 正确 | 答案有误 | 题目信息不足 | 题目有歧义 | agreement |
|---|---|---|---|---|---|---|
| claim-denials-snf-v2 | 300 | 246 | 34 | 20 | 0 | 82.0% |
| kyc-ubo-v2 | 300 | 299 | 0 | 0 | 1 | 99.7% |

The workbook set 95% as the bar for a set to be trusted. claim-denials missed
it on two rule-level disputes, not on scattered mistakes: every one of its 54
disagreements is one of the two items below.
Each dispute is one reviewer's reading applied to their whole share, which
the CSVs can no longer show without the name column: the 34 flagged
filing-through-date items are every item of that type in one reviewer's 100,
while the other two reviewers passed the 16 they had; the 20 flagged
benefit-exhausted items are likewise one reviewer's entire share, and the
other two passed the 20 they had. So 82% measures two rule readings, not a
spread of key errors.

**R1, timely filing: 34 `filing-through-date` items, 答案有误 (14 holdout).**
The key said a wrongful timely-filing denial is appealed, with a deadline 125
days after the remittance. The reviewer: a timely-filing determination is not
an initial determination and carries no appeal rights (42 CFR 405.926(n)); the
remedy is a reopening, which may be requested within one year of the
determination (405.980(c)(1)). Each row's `should_be` carries the reviewer's
own answer. opus-5.5 had answered `corrected_claim` on 20 of these and was
marked 模型对，标准答案错. Accepted:
[#25](https://github.com/57blocks/agentic_evaluator/pull/25) (v2.3,
2026-10-28) added `reopening` to `next_action`, regenerated the 50
filing-through-date keys and rewrote
[RULES.md R1](../../tasks/claim-denials-snf-v2/RULES.md); the set was rerun on
2026-10-30.

**R5, benefit exhausted: 20 `benefit-exhausted` items, 题目信息不足 (5
holdout).** The reviewer: whether the uncovered days are billed to the patient
or written off depends on whether the facility issued an SNFABN, and the input
does not say. Not accepted: #25 kept the key, because the notice-and-knowledge
regime of 42 CFR part 411 subpart K reaches only custodial care and services
not reasonable and necessary (411.400(a)), not a benefit limit;
[RULES.md R5](../../tasks/claim-denials-snf-v2/RULES.md) now says so with the
quote. The 20 verdicts stand in the workbook as the reviewer gave them.

**kyc-ubo-v2 `ubo2-175`, 题目有歧义.** One partner's stake, split in two to
exercise R2, printed as two byte-identical Kommanditist lines, which read as a
duplicate. The key was right. Fixed as an input-rendering change in
[#28](https://github.com/57blocks/agentic_evaluator/pull/28) (v2.2,
2026-10-29): a repeated partner's entries are numbered; 11 inputs changed in
wording, no key did.

Of the strong models' wrong answers, the reviewers upheld the grading on every
one except the 20 opus-5.5 answers above:

| set · model | 模型确实错 | 模型也对（判分太严） | 模型对，标准答案错 |
|---|---|---|---|
| claim-denials · gpt-5.6-sol | 24 | 0 | 0 |
| claim-denials · opus-5.5 | 10 | 0 | 20 |
| claim-denials · kimi-k3 | 28 | 0 | 0 |
| kyc-ubo-v2 · gpt-5.6-sol | 10 | 0 | 0 |
| kyc-ubo-v2 · opus-5.5 | 10 | 0 | 0 |

## Why this is in the repository

The 说明 sheet asks reviewers to keep the workbook internal because it holds
every key, holdout included. Every key is already in this public repository
under `tasks/<set>/references/`, so the workbook adds no answer that is not
public; the reviewers' names were the one private thing in it, and that column
is removed. Workbooks freshly written by `../build/` stay ignored
(`../.gitignore`); a finished review goes in a dated folder like this one.
