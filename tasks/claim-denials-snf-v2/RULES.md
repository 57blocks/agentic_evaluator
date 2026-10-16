# The rules behind the claim-denials-snf-v2 answer key

Every claim is a Medicare fee-for-service Part A skilled nursing facility
claim (bill type 0211) processed by a Medicare Administrative Contractor.
`gen/rules.mjs` applies the rules below; each is quoted from its source. The
candidate is not shown this file or any payer manual: the prompt names only
Medicare fee-for-service, and the remittance shows raw reason and remark
codes, as an 835 does. The set tests whether a model knows these rules.

Sources:
- **CFR** — Title 42 of the Code of Federal Regulations (text via Cornell LII, law.cornell.edu/cfr/text/42/…)
- **CPM** — CMS, Medicare Claims Processing Manual (Pub. 100-04), Ch. 1 §70.1
- **BPM** — CMS, Medicare Benefit Policy Manual (Pub. 100-02), Ch. 8 §20.1
- **X12** — X12 Remittance Advice Remark Codes list (x12.org/codes/remittance-advice-remark-codes)

## R1 · Timely filing: one calendar year after the Through date

> the claim must be filed no later than the close of the period ending 1 calendar
> year after the date of service. — CFR 424.44(a)(1)

> For institutional claims … that include span dates of service (i.e., a "From" and
> "Through" date span on the claim), the "Through" date on the claim is used for
> determining the date of service for claims filing timeliness. — CPM Ch. 1 §70.1

A claim filed on or before the anniversary of its Through date is timely. A
timely-filing denial (reason 29) of a claim filed within that limit is a
contractor error and is appealed. Exceptions to the limit (administrative
error, retroactive entitlement) are out of scope; no item raises one.

## R2 · Redetermination: 120 days from receipt, receipt presumed 5 days after the notice

> any request for redetermination must be filed within 120 calendar days from the
> date a party receives the notice of the initial determination … the date of
> receipt of the initial determination will be presumed to be 5 calendar days after
> the date of the notice of initial determination, unless there is evidence to the
> contrary. — CFR 405.942(a)

The deadline for `appeal` is the remittance date plus 125 days.

## R3 · An unprocessable claim (MA130) has no appeal rights: submit a new claim

> Your claim contains incomplete and/or invalid information, and no appeal rights
> are afforded because the claim is unprocessable. Please submit a new claim with
> the complete/correct information. — X12, remark code MA130

The new claim is still bound by R1, so the deadline for `corrected_claim` is
the anniversary of the Through date.

## R4 · Qualifying hospital stay: three inpatient days; observation does not count

> at least 3 consecutive calendar days, not counting the date of discharge … admitted
> to the facility … within 30 calendar days after the date of discharge from a
> hospital — CFR 409.30

> Time spent in observation or in the emergency room prior to (or in lieu of) an
> inpatient admission to the hospital does not count toward the 3-day qualifying
> inpatient hospital stay … the day of admission, but not the day of discharge, is
> counted as a hospital inpatient day. — BPM Ch. 8 §20.1

Every qualifying-stay item in this set is one where the stay **was** met when
counted from the inpatient admission order, so the denial is appealed.

## R5 · Benefit periods and the 100-day limit

> A benefit period ends once a beneficiary has not been an inpatient for at least 60
> consecutive days — CFR 409.60 (paraphrase of the LII text)

> Up to 100 days are available in each benefit period after discharge from a
> hospital or CAH. — CFR 409.61(b)

A benefit-limit denial (reason 119) of days in a new benefit period is a
contractor error and is appealed. Days genuinely past day 100 of one benefit
period are not covered; with no other coverage on file they are billed to the
beneficiary. Gaps in this set are either at least 75 days or at most 40 days,
never near the 60-day boundary.

## R6 · Duplicate of a paid claim

A claim denied as an exact duplicate (reason 18) of a claim already paid needs
no further action and the duplicate balance is written off.

## Left out on purpose

- Liability when the qualifying stay was **not** met. Whether the beneficiary
  can be billed then turns on notice rules that secondary sources describe
  differently; an item that rested on it would grade a reading, not a rule.
- Timely-filing exceptions, Medicare Advantage plans, Medicare Secondary Payer
  recovery, and any state Medicaid rule.
