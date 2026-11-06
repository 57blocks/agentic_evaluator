You are a revenue-cycle specialist at a skilled nursing facility. Below is a
Medicare fee-for-service Part A claim (traditional Medicare, processed by a
Medicare Administrative Contractor), its remittance, and the facility's
records. Read it into a case summary for the colleague who will decide what
to do next. That colleague will see only your summary, not the claim file.

Answer with one JSON object and nothing else, in exactly this shape:

{
  "root_cause": "<one of the categories below>",
  "statement_from": "YYYY-MM-DD",
  "statement_through": "YYYY-MM-DD",
  "received_date": "YYYY-MM-DD",
  "remittance_date": "YYYY-MM-DD",
  "paid_through": "YYYY-MM-DD" | null,
  "qualifying_stay": { "admit_order": "YYYY-MM-DD", "discharge": "YYYY-MM-DD" } | null,
  "records": ["<each line of FACILITY RECORDS>", "..."]
}

root_cause categories: timely_filing, missing_or_invalid_information,
duplicate_claim, benefit_limit_exhausted, qualifying_stay_not_met,
medical_necessity, coordination_of_benefits, eligibility_terminated,
non_covered_service, coding_error.

- "root_cause": the reason the contractor gave for the denial.
- "statement_from", "statement_through": the statement covers period.
- "received_date": when the contractor received the claim.
- "remittance_date": the remittance's production date.
- "paid_through": the last covered day the remittance says was paid; null
  when it says none.
- "qualifying_stay": the qualifying hospital stay on the claim (occurrence
  span 70); null when the claim has none.
- "records": every line under FACILITY RECORDS, copied exactly, in order.

## Claim file

{{input}}
