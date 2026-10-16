# Beneficial owner answers

The owners, their basis and the fallback are already graded by
checks/ubo-check.mjs. Judge only the `reasoning` field.

## correct-basis

Does the reasoning apply the stated rules for the right reason?

- Exactly 25% is said to be not enough; exactly 50% is said to be not control.
- An owner through a company is justified by control (more than 50%) of a
  company holding more than 25%, not by a multiplied percentage.
- A multiplied percentage above 25% without control is said not to count.
- When the fallback applies, it says nobody qualified before naming the
  managing directors.

## reasoning-clarity

Could a compliance reviewer check the answer from the reasoning alone? It
names each person who qualifies and each near miss, with the figure that
decides it. Shorter is better when nothing is missing.
