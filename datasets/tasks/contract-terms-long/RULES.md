# The rules behind the contract-terms-long answer key

Every answer in `references/` is computed by `gen/solve.mjs` from these rules,
and each reference's `why` says which of them decided it. The candidate sees
only the prompt (`prompts/extract.md`): extract the terms "as they stand on
the packet's status date", null when the agreement does not state a term. The
rules are the ordinary reading of the packet's own text, quoted below from the
clause library (`gen/library.mjs`) and the documents themselves.

## R1 · The status date decides what is in force

Every packet opens with `PACKET STATUS DATE: October 1, 2026`. The terms are
those binding on that date. A document that binds later changes nothing yet.

## R2 · An amendment binds only when both parties signed it

> This Agreement may be amended only by a written instrument signed by
> authorized representatives of both parties. — Entire Agreement and Amendment

So three kinds of amendment change nothing, whatever they say:

- a **draft** (headed `DRAFT — FOR DISCUSSION ONLY — NOT FOR SIGNATURE`, no
  signatures);
- an amendment **one party signed and the other did not** (one `/s/` line and
  one blank line), even though it is "dated and effective" like any other;
- an amendment signed by both that **takes effect after the status date**
  ("takes effect on January 1, 2027. Until then, the Agreement continues
  unchanged.").

## R3 · Binding amendments apply in order of effective date, not filing order

Packets list their documents "in the order filed"; amendments are sometimes
filed newest first or shuffled. Two amendments to the same section are
applied by effective date: the later one is the term in force. An amendment
replacing a clause carries the whole clause (`Section N.2 is deleted and
replaced with: …`), so the earlier value is gone, not merged.

## R4 · An amended and restated agreement supersedes everything before it

> From the Restatement Date, this Agreement supersedes the Original Agreement
> and every amendment to it, which are of no further effect.

The restated agreement states every term afresh; an amendment executed before
the Restatement Date is of no effect even where the restatement states a
different value for the same term. Amendments "to the Amended and Restated
Agreement" dated after it apply to it under R2 and R3.

> The "Effective Date" remains <original date>, and the Initial Term continues
> to run from it.

So `effective_date` and `initial_term_months` are the original agreement's.

## R5 · A statement of work never overrides the agreement

> If an SOW conflicts with this Agreement, this Agreement controls, unless the
> SOW expressly identifies by section number the provision of this Agreement
> that it overrides. — Statements of Work

Every SOW states its own term, cap and governing law ("TERM OF THIS SOW",
"LIABILITY UNDER THIS SOW", "GOVERNING LAW FOR THIS SOW"); none cites a
section number. They govern that SOW only and are never the answer.

## R6 · A clause the agreement does not have is null

Some agreements have no governing-law section, no general liability cap, or
no fixed term. Then:

- `governing_law` is null. The Venue section ("the state and federal courts
  located in … County, <State>") chooses a forum, not a governing law, and the
  parties' states of incorporation and the SOWs' laws are not the agreement's.
- `liability_cap` is null. In those agreements the Limitation of Liability
  section excludes consequential damages and says direct damages are "as
  provided by applicable law"; the carve-out cap for indemnification and
  confidentiality (present only beside a general cap) is not a general cap.
- `initial_term_months` is null when the agreement "continues until terminated
  by either party"; such an agreement does not renew, so `auto_renewal` is
  false and the renewal fields are null.

Filling any of these in is the failure the items test for.

## R7 · The effective date is the one the agreement defines

Three styles, all graded the same way: "entered into as of <date> (the
'Effective Date')"; "entered into as of the Effective Date" with `"Effective
Date" means <date>` in Definitions; or "takes effect on the date on which it
has been signed by both parties", where the later of the two signature-block
dates is the answer. The date of an amendment or restatement is never the
effective date.

## R8 · The initial term is whole months, however it is written

"thirty-six (36) months from the Effective Date" is 36. "begins on the
Effective Date and ends on <date>" is the number of whole months from the
effective date to the day after that end date (`gen/words.mjs termEnd`). An
amendment that "extends" the term by replacing Section N.1 or restating its
end date sets a new total, not an increment to add.

## R9 · Renewal fields describe automatic renewal only

`auto_renewal` is true only when the agreement "renews automatically";
`renewal_term_months` and `non_renewal_notice_days` are then the renewal
period and the notice to stop it. Where those are defined terms ("Renewal
Term", "Non-Renewal Notice Period"), the Definitions section holds the
values, and an amendment to the Definitions changes them. A renewal "by
mutual written agreement" or none at all gives false and two nulls; the "days
before the end of the term" in a mutual-renewal clause is not a notice period.
An executed amendment can replace Section N.2 to remove automatic renewal, add
it, or change its period.

## R10 · The liability cap is the general cap, by type

Four shapes: a fixed amount; the fees paid or payable in the N months before
the claim (`fees_paid`); the greater of an amount and those fees
(`greater_of`); those fees "provided, however, that in no event shall such
aggregate liability exceed" an amount (`lesser_of`). The carve-out cap for
indemnification and confidentiality, the insurance amounts, and every SOW's
own cap are not it.

## R11 · Scan noise never changes a graded value

Character damage (l→1, O→0, dropped letters) is applied only outside the
strings that carry graded values; line wraps, hyphenation and page headers may
split one across lines or pages, and `gen/generate.mjs` asserts every graded
string is still readable once those are undone.
