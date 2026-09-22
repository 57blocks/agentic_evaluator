Judge two code submissions written for the SAME self-contained module task.
Both were asked to implement one small module to a given signature and
acceptance criteria.

> Note: whether the code COMPILES is measured separately and objectively via
> `tsc --noEmit` (reported as the "tsc pass" column). Do NOT re-litigate
> compilation here — assume type errors are already penalized. Judge **code
> quality** on the axes below.

1. **Meets the spec** — implements the exact signature, name, and file the task
   asked for, and satisfies every stated acceptance criterion (including the
   edge cases the task calls out).
2. **Correctness** — the logic is right for normal and boundary inputs
   (empty/missing values, duplicates, out-of-range, invalid input, disabled
   states, etc.). No obvious bugs.
3. **Type quality** — precise, honest types; no `any`, no unsafe casts to dodge
   the type checker, external/untrusted input typed as `unknown` and narrowed.
4. **Simplicity & focus** — the smallest clear implementation that meets the
   spec. No dead code, no unrequested features, no needless dependencies or
   abstraction. Readable and well-named.
5. **Robustness** — handles the error/edge conditions the task specifies rather
   than assuming happy-path input.

Prefer the submission that fully meets the spec with correct, well-typed,
minimal code. A submission that adds unrequested features or cleverness should
lose to a focused, correct one.
