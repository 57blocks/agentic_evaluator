/**
 * Protocol states mapped onto the dashboard's meaning colours.
 *
 * The mapping lives in one file so the same state never reads as two
 * different things on two pages. `bad` is reserved for outcomes that are
 * genuinely a failure of the candidate; an evaluator that errored is the
 * harness's problem, not the candidate's, so it is a warning, never red.
 */

import type { TagTone } from "@/components/tag";

export type Tone = TagTone;

/** Protocol §5 task_outcome. */
export function outcomeTone(outcome: string): Tone {
  if (outcome === "success") return "ok";
  if (outcome === "failure") return "bad";
  return "warn";
}

/** Protocol §5 evaluation state — never blamed on the candidate. */
export function evaluationTone(state: string): Tone {
  if (state === "pass") return "ok";
  if (state === "fail") return "bad";
  if (state === "evaluator_error") return "warn";
  return "neutral";
}

/** How firmly a step's recommendation is held. */
export function firmnessTone(firmness: string): Tone {
  if (firmness === "firm") return "ok";
  if (firmness === "needs-review") return "bad";
  return "warn";
}
