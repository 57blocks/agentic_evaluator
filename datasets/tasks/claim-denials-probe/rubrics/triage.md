# Claim denial triage (probe)

Root cause, correctability, next action and deadline are graded by
checks/triage-check.mjs. Judge only `action_note`.

## sound-action

Does the note give the step the payer's rules actually call for, citing the
fact and the manual section that decide it (a 277CA, a coverage end date, an
authorization window), and avoid anything those rules forbid, such as billing
the member for provider-liability days?
