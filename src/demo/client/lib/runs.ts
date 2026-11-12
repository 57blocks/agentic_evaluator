/**
 * Which run a run is compared with by default: the one before it.
 *
 * One definition, used by the run page's "compare with previous run" link
 * and by the export, which records exactly these pairs — so a link in an
 * exported page always has its comparison recorded.
 */

import type { RunView } from "../../catalog.js";

const stepIds = (r: RunView): Set<string> => new Set(r.steps.map((s) => s.id));

/** The latest earlier run of the same task that shares a step with `run`; null when there is none. */
export function previousRun(runs: readonly RunView[], run: RunView): RunView | null {
  if (run.task === null || run.startedAt === null) return null;
  const mine = stepIds(run);
  const earlier = runs.filter(
    (r) => r.id !== run.id && r.task === run.task && r.startedAt !== null && r.startedAt < run.startedAt! && [...stepIds(r)].some((s) => mine.has(s)),
  );
  return earlier.sort((x, y) => (y.startedAt! < x.startedAt! ? -1 : 1))[0] ?? null;
}
