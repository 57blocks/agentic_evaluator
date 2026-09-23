/**
 * What the process says on its way out.
 *
 * Distinct codes for distinct things, for the same reason the report
 * distinguishes "checked, found nothing" from "never checked": a script that
 * sees one number for "the run failed" and "the run stopped early on budget"
 * cannot tell an outage from a spending cap.
 */
export const EXIT = {
  /** The command did what it was asked. */
  ok: 0,
  /** It could not: a missing file, an unreachable provider, a thrown error. */
  failed: 1,
  /** The command line itself was wrong — unknown command, missing argument. */
  usage: 2,
  /**
   * It ran, and the evidence is incomplete: the budget stopped it early, or
   * the trace shows wall-clock gaps that make every duration in it unreliable.
   * The outputs are real and worth keeping; they are not a whole run.
   */
  partial: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
