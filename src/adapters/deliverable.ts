/**
 * What gets evaluated for a candidate: the thing it produced, not the thing it
 * said about what it produced.
 *
 * A model-api candidate answers in text, so the text IS the deliverable. A CLI
 * agent leaves files on disk and prints a summary ("Created utils.ts …") — judge
 * that summary and you are grading a claim, not the work. The codegen adapter is
 * untouched: it parses its artifacts out of the model text, which already
 * carries them.
 */

import { matchesShow } from "../canon/show.js";
import type { ArtifactFile, CandidateAdapterId } from "./types.js";

/** Renders artifacts the way the chained-workflow handoff does. */
export function renderArtifacts(artifacts: readonly ArtifactFile[]): string {
  return artifacts.map((f) => "```file:" + f.path + "\n" + f.content + "\n```").join("\n\n");
}

/**
 * `show` (`evaluators.judge.show`) narrows an agent's files to the ones worth
 * reading: a whole project carries lockfiles and logs that would crowd the
 * judge's context and say nothing about the work. The check still gets every
 * file; only this text, which the judge reads and the report shows, narrows.
 */
export function deliverableText(
  adapter: CandidateAdapterId,
  text: string,
  artifacts: readonly ArtifactFile[],
  show?: readonly string[],
): string {
  if (adapter !== "agent-cli" || artifacts.length === 0) return text;
  if (!show || show.length === 0) return renderArtifacts(artifacts);
  const shown = artifacts.filter((f) => matchesShow(f.path, show));
  return shown.length > 0 ? renderArtifacts(shown) : `(none of the ${artifacts.length} files left match judge.show: ${show.join(", ")})`;
}

/**
 * Parseable units for completion classification. An agent asked to leave files
 * behind that leaves none did not complete, whatever its exit code says — but
 * only a step that gates on a file check can make that claim.
 */
export function parsedUnitsFor(
  adapter: CandidateAdapterId,
  artifacts: readonly ArtifactFile[],
  stepChecksFiles: boolean,
): number | undefined {
  if (adapter === "codegen") return artifacts.length;
  if (adapter === "agent-cli" && stepChecksFiles) return artifacts.length;
  return undefined;
}
