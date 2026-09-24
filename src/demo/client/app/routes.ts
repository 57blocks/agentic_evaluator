/**
 * The address bar is the state: reloads and the back button both land where
 * you were, and a task or run can be linked to. Parsing lives here so no
 * component builds a hash by hand.
 */

import { useEffect, useState } from "react";

export type Route =
  | { view: "home" }
  | { view: "task"; specPath: string }
  | { view: "run"; runId: string }
  /** `dir` is artifact-relative: a workflow root, or one step inside a run. */
  | { view: "report"; runId: string; dir: string };

const HOME: Route = { view: "home" };

export function parseRoute(hash: string): Route {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const specPath = params.get("spec");
  if (specPath) return { view: "task", specPath };
  const runId = params.get("run");
  const dir = params.get("report");
  if (runId && dir) return { view: "report", runId, dir };
  if (runId) return { view: "run", runId };
  return HOME;
}

export function hashFor(route: Route): string {
  switch (route.view) {
    case "task":
      return `#spec=${encodeURIComponent(route.specPath)}`;
    case "run":
      return `#run=${encodeURIComponent(route.runId)}`;
    case "report":
      return `#run=${encodeURIComponent(route.runId)}&report=${encodeURIComponent(route.dir)}`;
    case "home":
      return "#";
  }
}

export function navigate(route: Route): void {
  location.hash = hashFor(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
