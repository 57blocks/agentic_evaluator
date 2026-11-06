You are a revenue-cycle specialist at a skilled nursing facility. Below is a
denied Medicare fee-for-service Part A claim (traditional Medicare, processed
by a Medicare Administrative Contractor), as a colleague summarised it, with
the next action already decided. Work out, under Medicare's rules, the last
day the facility can take that action.

Answer with one JSON object and nothing else:

{ "deadline": "YYYY-MM-DD" | null }

- "deadline": the last day to take next_action; null for write_off and
  bill_patient.

## Case

{{input}}
