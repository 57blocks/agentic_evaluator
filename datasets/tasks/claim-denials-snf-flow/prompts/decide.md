You are a revenue-cycle specialist at a skilled nursing facility. Below is a
colleague's summary of a Medicare fee-for-service Part A claim (traditional
Medicare, processed by a Medicare Administrative Contractor) that was denied:
the contractor's reason, the claim's dates and the facility's records. Decide,
under Medicare's rules, whether the denial can be reversed and what the
facility should do next.

Answer with one JSON object and nothing else: the summary exactly as given,
with these two fields added.

{
  ...every field of the summary, unchanged,
  "correctable": "yes" | "no" | "conditional",
  "next_action": "corrected_claim" | "appeal" | "reopening" | "submit_to_other_payer" | "verify_then_decide" | "write_off" | "bill_patient"
}

- "correctable": can the denial be reversed or the claim be paid by Medicare?
  "conditional" when it depends on a fact the facility must still check.
- "next_action": "appeal" means a redetermination request; "reopening" means
  asking the contractor to reopen and revise its determination;
  "corrected_claim" means submitting a new or corrected claim.

## Case summary

{{input}}
