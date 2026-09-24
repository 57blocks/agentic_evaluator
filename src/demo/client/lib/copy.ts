/**
 * Wording the UI repeats in more than one place.
 *
 * A step with no recommendation and a task that was never run are the two
 * phrases this dashboard must never get wrong — both are absences, and an
 * absence rendered as an empty cell reads as "fine". They live here so every
 * surface says the same thing about them.
 */

/** A step that ran and could not choose anybody. */
export { NO_PICK as NEEDS_REVIEW, SELF_CHECK } from "../../../report-format.js";

/** A task that is defined but has never been run. */
export const NEVER_RAN = "未跑过";
