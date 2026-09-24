/**
 * The two documents every view reads: what the workspace contains, and what
 * it has concluded. Fetched together because a page that had one and not the
 * other could only render half an answer.
 */

import { useCallback, useEffect, useState } from "react";
import type { RunView, TaskView } from "../../catalog.js";
import type { Overview } from "../../../server/overview.js";
import { getJson } from "@/lib/api";

export interface Catalog {
  tasks: TaskView[];
  unfiled: RunView[];
}

export interface Workspace {
  catalog: Catalog | null;
  overview: Overview | null;
  error: string | null;
  /** Re-read after a run finishes, so its directory shows up without a refresh. */
  reload: () => void;
}

export function useWorkspace(): Workspace {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([getJson<Catalog>("/api/catalog"), getJson<Overview>("/api/overview")])
      .then(([c, o]) => {
        if (!live) return;
        setCatalog(c);
        setOverview(o);
        setError(null);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [generation]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);
  return { catalog, overview, error, reload };
}

/** Every run in the workspace, whether or not it belongs to a task. */
export function allRuns(catalog: Catalog): RunView[] {
  return [...catalog.tasks.flatMap((t) => t.runs), ...catalog.unfiled];
}
