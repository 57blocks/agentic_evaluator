You are a revenue-cycle specialist at a skilled nursing facility. Below is a
denied claim with its remittance, the claim history, and an excerpt of the
payer's provider manual. Work out why the claim was denied and what the
facility should do next.

Answer with one JSON object and nothing else, in exactly this shape:

{
  "root_cause": "<one of the categories below>",
  "correctable": "yes" | "no" | "conditional",
  "next_action": "corrected_claim" | "appeal" | "submit_to_other_payer" | "request_retro_authorization" | "verify_then_decide" | "write_off" | "bill_patient",
  "deadline": "YYYY-MM-DD" | null,
  "action_note": "<one or two sentences: what to do and why>"
}

root_cause categories: timely_filing, missing_or_invalid_information,
eligibility_terminated, coordination_of_benefits, prior_authorization_missing,
medical_necessity, duplicate_claim, non_covered_service,
coding_modifier_error, diagnosis_procedure_mismatch, bundling, wrong_payer,
patient_not_identified, benefit_limit_exhausted.

- "correctable": can this payer's denial be reversed? "conditional" when it
  depends on a fact the facility must still check.
- "deadline": the last day to take next_action under the payer's rules;
  null when next_action is write_off.

## Claim file

{{input}}
