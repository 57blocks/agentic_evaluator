You are a revenue-cycle specialist at a skilled nursing facility. Below is a
Medicare fee-for-service Part A claim (traditional Medicare, processed by a
Medicare Administrative Contractor), its remittance, and the facility's
records. Work out why the claim was denied and what the facility should do
next under Medicare's rules.

Answer with one JSON object and nothing else, in exactly this shape:

{
  "root_cause": "<one of the categories below>",
  "correctable": "yes" | "no" | "conditional",
  "next_action": "corrected_claim" | "appeal" | "reopening" | "submit_to_other_payer" | "verify_then_decide" | "write_off" | "bill_patient",
  "deadline": "YYYY-MM-DD" | null,
  "action_note": "<one or two sentences: what to do and why>"
}

root_cause categories: timely_filing, missing_or_invalid_information,
duplicate_claim, benefit_limit_exhausted, qualifying_stay_not_met,
medical_necessity, coordination_of_benefits, eligibility_terminated,
non_covered_service, coding_error.

- "root_cause": the reason the contractor gave for the denial.
- "correctable": can the denial be reversed or the claim be paid by Medicare?
  "conditional" when it depends on a fact the facility must still check.
- "next_action": "appeal" means a redetermination request; "reopening" means
  asking the contractor to reopen and revise its determination;
  "corrected_claim" means submitting a new or corrected claim.
- "deadline": the last day to take next_action; null for write_off and
  bill_patient.

## Claim file

{{input}}
