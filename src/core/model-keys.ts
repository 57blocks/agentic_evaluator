/**
 * The API keys a step's model calls need, and which of them this environment
 * lacks.
 *
 * A call without its key fails inside the run, where nobody can tell it from
 * a model's own bad answer: it was recorded as malformed, once per trial, and
 * the run went on to the end. A missing key is the run's mistake, not a
 * candidate's, so `run` refuses to start without one (src/core/execute.ts)
 * and `check-task` says so beforehand (src/core/preflight.ts).
 *
 * Only calls the step will make count: a candidate that runs a CLI agent
 * brings its own environment (`cli.env`, checked separately), and the judge
 * is called only when the step declares a judging method.
 */

import { adapterIdOf } from "../adapters/types.js";
import { apiKeyEnvOf, endpointOf, type ModelEndpoint } from "../providers/index.js";
import type { Suite } from "../types.js";
import { methodsOf } from "./plan.js";

export interface MissingKey {
  /** Who would make the call: a candidate id, or `judge <model>`. */
  who: string;
  route: ModelEndpoint["route"];
  env: string;
}

export function missingModelKeys(suite: Suite): MissingKey[] {
  const out: MissingKey[] = [];
  const check = (who: string, endpoint: ModelEndpoint): void => {
    const env = apiKeyEnvOf(endpoint);
    // Empty counts as unset: the call rejects an empty key just the same.
    if (env && !process.env[env]) out.push({ who, route: endpoint.route, env });
  };
  for (const id of suite.candidates) {
    const def = suite.candidateDefs?.[id];
    if (!def || adapterIdOf(def, suite.producer ?? "prompt") === "agent-cli") continue;
    check(id, endpointOf(def));
  }
  const { pairwise, absolute } = methodsOf(suite);
  if ((pairwise || absolute) && suite.judgeEndpoint) check(`judge ${suite.judge}`, suite.judgeEndpoint);
  return out;
}

export function describeMissingKey(k: MissingKey): string {
  return `${k.who}: provider_route ${k.route} needs ${k.env}, which is not set (export it, or put it in .env.local)`;
}
