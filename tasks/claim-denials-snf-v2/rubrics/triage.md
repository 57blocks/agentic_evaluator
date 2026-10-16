# Medicare SNF claim denial triage

Root cause, correctability, next action and deadline are graded by
checks/triage-check.mjs. Judge only `action_note`.

## sound-action

Does the note give the step Medicare's rules call for and the fact that
decides it: the Through date for timely filing, the presumed receipt date
behind a redetermination deadline, no appeal rights for an unprocessable
claim, the gap that starts a new benefit period, inpatient days counted from
the admission order?
