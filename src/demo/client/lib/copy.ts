/**
 * Wording the UI repeats in more than one place.
 *
 * A step with no recommendation and a task that was never run are the two
 * phrases this dashboard must never get wrong — both are absences, and an
 * absence rendered as an empty cell reads as "fine". They live here so every
 * surface says the same thing about them.
 */

/** A step that ran and could not choose anybody; and one that declared a scorecard, which picks nobody by design. */
export { NO_PICK as NEEDS_REVIEW, SCORECARD_PICK, SELF_CHECK } from "../../../report-format.js";
import { NO_PICK, SCORECARD_PICK } from "../../../report-format.js";

/** What a step shows for its pick: the candidate, the scorecard's "no pick", or the absence that needs review. */
export function stepPick(s: { chosen: string | null; firmness: string }): string {
  return s.chosen ?? (s.firmness === "scorecard" ? SCORECARD_PICK : NO_PICK);
}

/** A task that is defined but has never been run. */
export const NEVER_RAN = "never run";
